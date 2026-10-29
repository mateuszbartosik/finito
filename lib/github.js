'use strict';

// Reads the pull requests you reviewed from GitHub's REST API, with a token you make in
// GitHub. Read access to pull requests is all it needs.

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 0;
  }
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
    if (res.status === 401) throw new GitHubError('GitHub turned the token down. Make a new one and connect again in Settings.', 401);
    if (res.status === 403 || res.status === 429) {
      if (res.headers.get('x-ratelimit-remaining') === '0') throw new GitHubError("GitHub's hourly limit is used up. Review suggestions come back within the hour.", res.status);
      throw new GitHubError(`GitHub refused a request (${res.status}). The token may not reach that repository.`, res.status);
    }
    if (res.status === 404) throw new GitHubError('GitHub has no such repository or pull request, or the token can’t see it.', 404);
    if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}.`, res.status);
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

  // Pull requests I reviewed that changed on or after a date.
  async reviewedPulls(login, sinceDate) {
    const r = await this.get('/search/issues', { q: `type:pr reviewed-by:${login} updated:>=${sinceDate}`, per_page: 50, sort: 'updated' });
    return (r.json && r.json.items) || [];
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

// What I did on each pull request I reviewed in [fromMs, toMs): reviews I submitted,
// review comments and conversation comments, each with its time.
async function reviewActivity(gh, login, fromMs, toMs, sinceDate) {
  const me = String(login).toLowerCase();
  const mine = (x) => x && x.user && String(x.user.login).toLowerCase() === me;
  const inside = (t) => t >= fromMs && t < toMs;
  const since = new Date(fromMs).toISOString();
  const items = (await gh.reviewedPulls(login, sinceDate)).filter((i) => i.pull_request && repoOf(i));
  const prs = await mapLimit(items, 4, async (item) => {
    const repo = repoOf(item);
    const [reviews, comments, talk] = await Promise.all([
      gh.reviews(repo, item.number),
      gh.reviewComments(repo, item.number, since),
      gh.issueComments(repo, item.number, since),
    ]);
    const events = [];
    for (const r of reviews) {
      const t = Date.parse(r.submitted_at);
      if (mine(r) && inside(t)) events.push({ at: t, kind: 'review', state: r.state, url: r.html_url });
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
      events,
    };
  });
  return prs.filter((p) => p.events.length);
}

module.exports = { GitHub, GitHubError, reviewActivity, mapLimit };
