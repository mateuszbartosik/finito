'use strict';

// Reads the pull requests you reviewed or commented on from GitHub's REST API, with a token
// you make in GitHub. Read access to pull requests is all it needs.

// scope says how far a refusal reaches: 'token' and 'limit' stop every request, 'org' one
// organization's repositories, 'repo' one repository.
class GitHubError extends Error {
  constructor(message, status, extra) {
    super(message);
    this.status = status || 0;
    Object.assign(this, extra);
  }
}

const sentence = (s) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const cut = t.length > 300 ? t.slice(0, 299) + '…' : t;
  return /[.!?…]$/.test(cut) ? cut : cut + '.';
};

// GitHub says why it refuses in the body's `message`. This turns the refusals people run into
// into what to do about them, and passes anything else on in GitHub's own words.
async function refusal(res, url) {
  let said = '';
  try { said = String((await res.json()).message || ''); } catch (_) { /* not JSON */ }
  const header = (k) => res.headers.get(k) || '';
  const status = res.status;
  const m = /\/repos\/([^/]+)\/([^/]+)/.exec(url.pathname);
  const repo = m ? `${m[1]}/${m[2]}` : '';
  const org = (/^The '([^']+)' organization/.exec(said) || [])[1] || (m ? m[1] : '');
  if (status === 401) return new GitHubError('GitHub turned the token down. Make a new one and connect again in Settings.', 401, { scope: 'token' });
  if (status === 403 || status === 429) {
    if (header('x-ratelimit-remaining') === '0') return new GitHubError("GitHub's hourly limit is used up. Review suggestions come back within the hour.", status, { scope: 'limit' });
    if (header('retry-after') || /secondary rate limit/i.test(said)) return new GitHubError('GitHub asked Finito to slow down. Review suggestions come back in a few minutes.', status, { scope: 'limit' });
    // An organization's rules for tokens: how long they may last, and single sign-on.
    const life = /lifetime is greater than (\d+) days/i.exec(said);
    if (life) {
      const link = (/https:\/\/github\.com\/settings\/personal-access-tokens\/\d+/.exec(said) || [])[0];
      return new GitHubError(`The ${org} organization accepts only tokens that expire within ${life[1]} days. Regenerate the token with an expiry date${link ? ' at ' + link : ' in GitHub'}, then connect the new one in Settings.`, status, { scope: 'org', owner: org });
    }
    const sso = /url=(\S+)/.exec(header('x-github-sso'));
    if (header('x-github-sso')) return new GitHubError(`The ${org} organization uses single sign-on. Authorize the token for it${sso ? ' at ' + sso[1] : ' in GitHub'}, then reload.`, status, { scope: 'org', owner: org });
    if (/not accessible by personal access token/i.test(said)) return new GitHubError(`The token can't read ${repo || 'this repository'}. In GitHub, give it that repository and read access to pull requests, then reload.`, status, { scope: 'repo', repo });
    const why = sentence(said || 'no reason given');
    return repo
      ? new GitHubError(`GitHub refused access to ${repo}: ${why}`, status, { scope: 'repo', repo })
      : new GitHubError(`GitHub refused the request: ${why}`, status);
  }
  if (status === 404) return new GitHubError(`GitHub has no such pull request in ${repo || 'that repository'}, or the token can't see it.`, 404, { scope: repo ? 'repo' : undefined, repo });
  return new GitHubError(`GitHub answered ${status}${said ? ': ' + sentence(said) : '.'}`, status);
}

function nextLink(header) {
  const m = /<([^>]+)>;\s*rel="next"/.exec(header || '');
  return m ? m[1] : null;
}

class GitHub {
  constructor({ token, api = 'https://api.github.com', timeoutMs = 20000 }) {
    this.token = token;
    this.api = String(api || 'https://api.github.com').replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async get(pathOrUrl, query) {
    const url = new URL(/^https?:/.test(pathOrUrl) ? pathOrUrl : this.api + pathOrUrl);
    // Pages come back as absolute links; the token only ever goes to the API it was made for.
    if (url.origin !== new URL(this.api).origin) throw new GitHubError('GitHub pointed to another address; stopped before sending the token there.');
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: 'Bearer ' + this.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Finito',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      const code = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      throw new GitHubError(timedOut ? 'GitHub took too long to answer.' : `Couldn't reach GitHub (${code}).`);
    }
    if (!res.ok) throw await refusal(res, url);
    return { json: await res.json(), next: nextLink(res.headers.get('link')) };
  }

  // Every page of a list, up to a few pages.
  async list(path, query, maxPages = 3) {
    const out = [];
    let r = await this.get(path, Object.assign({ per_page: 100 }, query));
    for (let page = 1; ; page++) {
      if (Array.isArray(r.json)) out.push(...r.json);
      if (!r.next || page >= maxPages) break;
      r = await this.get(r.next);
    }
    return out;
  }

  async user() {
    return (await this.get('/user')).json;
  }

  // Pull requests I reviewed or commented on that changed on or after a date: reviewed-by: finds
  // reviews, involves: comments (and my own pull requests). commenter: alone misses some.
  async involvedPulls(login, sinceDate) {
    const found = await Promise.all(['reviewed-by', 'involves'].map((how) =>
      this.get('/search/issues', { q: `type:pr ${how}:${login} updated:>=${sinceDate}`, per_page: 50, sort: 'updated' })));
    const pulls = new Map();
    for (const r of found) for (const i of (r.json && r.json.items) || []) pulls.set(i.repository_url + '#' + i.number, i);
    return [...pulls.values()];
  }

  reviews(repo, number) { return this.list(`/repos/${repo}/pulls/${number}/reviews`); }
  reviewComments(repo, number, since) { return this.list(`/repos/${repo}/pulls/${number}/comments`, { since }); }
  issueComments(repo, number, since) { return this.list(`/repos/${repo}/issues/${number}/comments`, { since }); }
  async pull(repo, number) { return (await this.get(`/repos/${repo}/pulls/${number}`)).json; }
}

const repoOf = (item) => {
  const m = /\/repos\/([^/]+\/[^/]+)$/.exec(item.repository_url || '');
  return m ? m[1] : '';
};

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

// An organization or a repository that refuses the token is skipped, not the whole week.
const localRefusal = (e) => e instanceof GitHubError && (e.scope === 'org' || e.scope === 'repo');

// What I did on each pull request I reviewed in [fromMs, toMs): reviews I submitted,
// review comments and conversation comments, each with its time. `problems` holds what
// GitHub refused, one line per organization or repository.
async function reviewActivity(gh, login, fromMs, toMs, sinceDate) {
  const me = String(login).toLowerCase();
  const mine = (x) => x && x.user && String(x.user.login).toLowerCase() === me;
  const inside = (t) => t >= fromMs && t < toMs;
  const since = new Date(fromMs).toISOString();
  const items = (await gh.involvedPulls(login, sinceDate)).filter((i) => i.pull_request && repoOf(i));
  const refused = new Map();
  const prs = await mapLimit(items, 4, async (item) => {
    const repo = repoOf(item);
    const owner = repo.split('/')[0];
    if (refused.has(owner) || refused.has(repo)) return null;
    let reviews, comments, talk;
    try {
      [reviews, comments, talk] = await Promise.all([
        gh.reviews(repo, item.number),
        gh.reviewComments(repo, item.number, since),
        gh.issueComments(repo, item.number, since),
      ]);
    } catch (e) {
      if (!localRefusal(e)) throw e;
      refused.set(e.scope === 'org' ? owner : repo, e.message);
      return null;
    }
    const events = [];
    // A comment added on its own still arrives wrapped in a review of its own, as does a reply on
    // my own pull request. Such a review is a moment in time, but not a review to count.
    const perReview = new Map();
    for (const c of comments) if (mine(c) && c.pull_request_review_id) perReview.set(c.pull_request_review_id, (perReview.get(c.pull_request_review_id) || 0) + 1);
    for (const r of reviews) {
      const t = Date.parse(r.submitted_at);
      const wrapper = r.state === 'COMMENTED' && !String(r.body || '').trim() && (perReview.get(r.id) || 0) <= 1;
      if (mine(r) && inside(t)) events.push(Object.assign({ at: t, kind: 'review', state: r.state, url: r.html_url }, wrapper ? { quiet: true } : {}));
    }
    for (const c of comments) {
      const t = Date.parse(c.created_at);
      if (mine(c) && inside(t)) events.push({ at: t, kind: 'review-comment', url: c.html_url });
    }
    for (const c of talk) {
      const t = Date.parse(c.created_at);
      if (mine(c) && inside(t)) events.push({ at: t, kind: 'comment', url: c.html_url });
    }
    events.sort((a, b) => a.at - b.at);
    return {
      repo,
      number: item.number,
      title: item.title || '',
      body: item.body || '',
      url: item.html_url,
      author: item.user ? item.user.login : '',
      own: !!item.user && String(item.user.login).toLowerCase() === me,
      events,
    };
  });
  return { pulls: prs.filter((p) => p && p.events.length), problems: [...new Set(refused.values())] };
}

// One review request in each repository I reviewed in lately (up to six), so that a token an
// organization refuses is caught when it's connected rather than later in the week.
async function checkReach(gh, login, sinceDate) {
  const items = (await gh.involvedPulls(login, sinceDate)).filter((i) => i.pull_request && repoOf(i));
  const repos = new Map();
  for (const i of items) if (!repos.has(repoOf(i))) repos.set(repoOf(i), i.number);
  const tried = [...repos].slice(0, 6);
  const orgs = new Map();
  const refused = [];
  for (const [repo, number] of tried) {
    const owner = repo.split('/')[0];
    if (orgs.has(owner)) { refused.push(orgs.get(owner)); continue; }
    try {
      await gh.get(`/repos/${repo}/pulls/${number}/reviews`, { per_page: 1 });
    } catch (e) {
      if (!localRefusal(e)) throw e;
      if (e.scope === 'org') orgs.set(owner, e.message);
      refused.push(e.message);
    }
  }
  return { tried: tried.length, refused: refused.length, problems: [...new Set(refused)] };
}

module.exports = { GitHub, GitHubError, reviewActivity, checkReach, mapLimit };
