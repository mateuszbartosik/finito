'use strict';

// The Jira Cloud adapter: worklogs through Jira's REST API v3, in the shapes from
// lib/tracker.js. Jira has no work types and no "my activity" feed Finito can use, so both
// capabilities are off; meetings and reviews still become suggestions.
// Docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/

const { TrackerError } = require('./tracker');
const D = require('./dates');

const ISSUE_FIELDS = ['summary', 'resolution', 'project'];
const MY_OPEN = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
const DAY = 24 * 3600 * 1000;

class JiraCloud {
  static id = 'jira';
  static label = 'Jira';
  static capabilities = { workTypes: false, activity: false };
  // Scoped API tokens only work through Atlassian's gateway, not the site's own address.
  static gateway = 'https://api.atlassian.com';

  static credentials = [
    { name: 'url', label: 'Site', placeholder: 'https://yourcompany.atlassian.net', required: 'Enter your Jira site, for example https://yourcompany.atlassian.net.' },
    { name: 'email', label: 'Email', placeholder: 'you@company.com', required: 'Enter the email you sign in to Jira with.' },
    { name: 'token', label: 'API token', placeholder: '', secret: true, required: 'Paste an API token from your Atlassian account.' },
  ];

  static help = {
    title: 'Where do I get an API token?',
    steps: [
      'Open your Atlassian account: **Security** → **API tokens**.',
      '**Create API token with scopes**, name it “Finito”, app **Jira**, scopes **read:jira-work**, **write:jira-work** and **read:jira-user**. A token without scopes works too.',
      'Copy it now (Atlassian shows it once) and paste it here, with the email you sign in with.',
    ],
    link: { label: 'Open my Atlassian API tokens', href: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
  };

  // A bare name, a host, or any Jira page: the site's address. "acme" means acme.atlassian.net.
  static normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + (/[.:]/.test(s) ? s : s + '.atlassian.net');
    try { return new URL(s).origin; } catch (_) { return ''; }
  }

  static normalizeCreds(creds) {
    return {
      url: JiraCloud.normalizeUrl(creds.url),
      email: String(creds.email || '').trim(),
      token: String(creds.token || '').trim(),
    };
  }

  // Tries the site first (classic tokens), then Atlassian's gateway (scoped tokens).
  // Returns the creds to save, including the address that worked.
  static async connect({ url, email, token }) {
    const site = url;
    const T = this;
    const probe = async (apiBase) => {
      const c = new T({ creds: { url: site, email, token, apiBase }, timeoutMs: 15000 });
      return c.me();
    };
    let firstError;
    try {
      const user = await probe(site);
      return { base: site, user, creds: { url: site, email, token, apiBase: site } };
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw connectError(e, site);
      firstError = e;
    }
    let cloudId = null;
    try {
      const res = await fetch(site + '/_edge/tenant_info', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (res.ok) cloudId = (await res.json()).cloudId || null;
    } catch (_) { /* not a Jira Cloud site, or offline */ }
    if (!cloudId) throw connectError(firstError, site);
    const apiBase = `${T.gateway}/ex/jira/${encodeURIComponent(cloudId)}`;
    try {
      const user = await probe(apiBase);
      return { base: site, user, creds: { url: site, email, token, apiBase } };
    } catch (e) {
      // The gateway out of reach says less than the site's own no.
      throw connectError(e.status === 401 || e.status === 403 ? e : firstError, site);
    }
  }

  constructor({ creds, timeoutMs = 20000 }) {
    this.base = String(creds.url || '').replace(/\/+$/, '');
    this.apiBase = String(creds.apiBase || this.base).replace(/\/+$/, '');
    this.auth = 'Basic ' + base64(`${creds.email || ''}:${creds.token || ''}`);
    this.timeoutMs = timeoutMs;
    this.account = null;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.apiBase + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    const headers = { Authorization: this.auth, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      const code = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      throw new TrackerError(timedOut ? 'Jira took too long to answer.' : `Couldn't reach Jira (${code}).`, 0, true);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }
    if (!res.ok) {
      throw new TrackerError(`Jira ${res.status}: ${errorText(json, text, res.statusText || 'request failed')}`, res.status, res.status >= 500 || res.status === 429);
    }
    return json;
  }

  links() {
    return { issue: this.base + '/browse/{key}', timesheets: null };
  }

  // ---------- shapes ----------

  toIssue(i) {
    if (!i || !i.key) return null;
    const f = i.fields || {};
    return {
      key: i.key,
      dbId: i.id || null,
      title: f.summary || '',
      resolved: !!f.resolution,
      project: f.project ? { key: f.project.key, name: f.project.name || '', dbId: f.project.id || null } : null,
      url: this.base + '/browse/' + i.key,
    };
  }

  toItem(w, issue) {
    const started = Date.parse(w.started);
    return {
      id: String(w.id),
      issue,
      date: D.localDate(started),
      minutes: Math.round((w.timeSpentSeconds || 0) / 60),
      type: null,
      note: adfText(w.comment),
      author: w.author ? { id: w.author.accountId, login: w.author.accountId } : null,
      createdAt: w.created ? Date.parse(w.created) : null,
    };
  }

  // ---------- issues ----------

  async me() {
    if (!this.account) {
      const u = await this.request('GET', '/rest/api/3/myself');
      if (!u || !u.accountId) throw new TrackerError("That address answered, but it doesn't look like Jira Cloud.", 0);
      this.account = { id: u.accountId, login: u.accountId, name: u.displayName || '', email: u.emailAddress || '' };
    }
    return this.account;
  }

  async getIssue(key) {
    return this.toIssue(await this.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}`, { query: { fields: ISSUE_FIELDS.join(',') } }));
  }

  async search(jql, limit, fields = ISSUE_FIELDS) {
    const out = [];
    let nextPageToken;
    // Pages are capped: a runaway token chain must not loop forever.
    for (let page = 0; page < 20 && out.length < limit; page++) {
      const body = { jql, fields, maxResults: Math.min(100, limit - out.length) };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const r = await this.request('POST', '/rest/api/3/search/jql', { body });
      out.push(...((r && r.issues) || []));
      nextPageToken = r && r.nextPageToken;
      if (!nextPageToken || (r && r.isLast)) break;
    }
    return out.map((i) => this.toIssue(i)).filter(Boolean);
  }

  // Words from a title. JQL's text search chokes on its own operators, so those go.
  searchIssues(text, limit = 10) {
    const words = String(text || '').replace(/[+\-&|!(){}[\]^~*?\\:"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!words) return this.myOpenIssues(limit);
    return this.search(`text ~ "${words}" ORDER BY updated DESC`, limit);
  }

  myOpenIssues(limit = 15) {
    return this.search(MY_OPEN, limit);
  }

  async projectKeys() {
    const keys = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const r = await this.request('GET', '/rest/api/3/project/search', { query: { startAt, maxResults: 100 } });
      const values = (r && r.values) || [];
      keys.push(...values.map((p) => p.key).filter(Boolean));
      if (!values.length || r.isLast !== false) break;
      startAt += values.length;
    }
    return keys;
  }

  // ---------- worklogs ----------

  // Mine on one issue, started between two moments.
  async myWorklogs(issue, fromMs, toMs) {
    const me = await this.me();
    const out = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const r = await this.request('GET', `/rest/api/3/issue/${ref(issue)}/worklog`, {
        query: { startAt, maxResults: 1000, startedAfter: fromMs, startedBefore: toMs },
      });
      const list = (r && r.worklogs) || [];
      for (const w of list) if (w.author && w.author.accountId === me.id) out.push(this.toItem(w, issue));
      startAt += list.length;
      if (!list.length || startAt >= (r.total || 0)) break;
    }
    return out;
  }

  // Jira can't list my worklogs across issues, so: find the issues I logged on in these days,
  // then read each one's worklogs. The search widens by a day on each side because Jira reads
  // worklogDate in the account's time zone; the days are checked here in this machine's.
  async workItems(fromDate, toDate) {
    const jql = `worklogAuthor = currentUser() AND worklogDate >= "${D.addDays(fromDate, -1)}" AND worklogDate <= "${D.addDays(toDate, 1)}"`;
    const issues = await this.search(jql, 500);
    const fromMs = D.localMidnightMs(fromDate) - DAY;
    const toMs = D.localMidnightMs(D.addDays(toDate, 1)) + DAY;
    const lists = await mapLimit(issues, 4, (issue) => this.myWorklogs(issue, fromMs, toMs));
    return lists.flat().filter((w) => w.date >= fromDate && w.date <= toDate);
  }

  // Recent ones are enough: this is for spotting a create that landed before a timeout.
  async issueWorkItems(issue) {
    const full = issue && issue.key && issue.title !== undefined ? issue : await this.getIssue(issue.key || issue);
    return this.myWorklogs(full, Date.now() - 40 * DAY, Date.now() + 40 * DAY);
  }

  async createWorkItem(issue, { date, minutes, note }) {
    const body = { started: startedAt(date), timeSpentSeconds: minutes * 60 };
    if (note) body.comment = adf(note);
    const w = await this.request('POST', `/rest/api/3/issue/${ref(issue)}/worklog`, { body });
    return this.toItem(w, await this.fullIssue(issue));
  }

  // patch: minutes and/or note. Jira has no types, so a type in the patch is ignored.
  async updateWorkItem(issue, id, patch) {
    const body = {};
    if ('minutes' in patch) body.timeSpentSeconds = patch.minutes * 60;
    if ('note' in patch) body.comment = adf(patch.note || '');
    const w = await this.request('PUT', `/rest/api/3/issue/${ref(issue)}/worklog/${encodeURIComponent(id)}`, { body });
    return this.toItem(w, await this.fullIssue(issue));
  }

  deleteWorkItem(issue, id) {
    return this.request('DELETE', `/rest/api/3/issue/${ref(issue)}/worklog/${encodeURIComponent(id)}`);
  }

  async workTypes() {
    return { enabled: true, types: [] };
  }

  async activities() {
    return { items: [], errors: [] };
  }

  async fullIssue(issue) {
    if (issue && issue.key && issue.title !== undefined) return issue;
    return this.getIssue(issue.key || issue.dbId || issue);
  }
}

function connectError(e, site) {
  if (e.status === 401 || e.status === 403) return new TrackerError('Jira turned the email and token down. Check both, and that the token is for this Atlassian account.', e.status);
  if (e.status === 404) return new TrackerError(`${site} answered, but it doesn't look like Jira Cloud. Is this the right site?`, 404);
  return e;
}

function errorText(json, text, fallback) {
  if (json && typeof json === 'object') {
    const msgs = [...(json.errorMessages || []), ...Object.values(json.errors || {})].filter(Boolean);
    if (msgs.length) return msgs.join(' ');
    if (json.message) return json.message;
  }
  if (text && text.length < 300 && !/<html/i.test(text)) return text.trim();
  return fallback;
}

// Jira takes an issue's key or id in a path.
function ref(issue) {
  const r = typeof issue === 'string' ? issue : issue && (issue.key || issue.dbId);
  return encodeURIComponent(r || '');
}

// A day's work goes in at 09:00 local time, with this machine's offset: Jira shows it on that day.
function startedAt(date) {
  const ms = D.localMidnightMs(date) + 9 * 3600 * 1000;
  const off = -new Date(ms).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${date}T09:00:00.000${sign}${D.pad(Math.floor(a / 60))}${D.pad(a % 60)}`;
}

// Notes travel as Atlassian Document Format: one paragraph per line.
function adf(text) {
  const lines = String(text).split('\n');
  return {
    type: 'doc',
    version: 1,
    content: lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph', content: [] })),
  };
}

function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfText);
  if (node.type === 'doc') return inner.join('\n').replace(/\n+$/, '');
  return inner.join('');
}

function base64(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64');
  return btoa(String.fromCharCode(...new TextEncoder().encode(s))); // the browser demo
}

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

module.exports = { JiraCloud, adf, adfText, startedAt };
