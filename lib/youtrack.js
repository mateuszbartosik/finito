'use strict';

// The YouTrack adapter: a thin client for the parts of YouTrack's REST API that Finito uses,
// turning YouTrack's records into the shapes in lib/tracker.js.
// Docs: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html

const { TrackerError } = require('./tracker');
const D = require('./dates');

const PROJECT_FIELDS = 'project(id,shortName,name)';
const ISSUE_FIELDS = 'id,idReadable,summary,resolved,' + PROJECT_FIELDS;
const ITEM_FIELDS = 'id,date,created,duration(minutes,presentation),text,type(id,name),author(id,login),issue(' + ISSUE_FIELDS + ')';
const TARGET_FIELDS = `target(id,idReadable,summary,${PROJECT_FIELDS},issue(id,idReadable,summary,${PROJECT_FIELDS}))`;
const SIMPLE_TARGET_FIELDS = 'target(idReadable,summary,issue(idReadable,summary))';
const MY_OPEN = 'for: me #Unresolved sort by: updated desc';

const ACTIVITY_CATEGORIES = [
  'CommentsCategory', 'CommentAttachmentsCategory', 'AttachmentsCategory', 'IssueCreatedCategory',
  'IssueResolvedCategory', 'DescriptionCategory', 'SummaryCategory', 'LinksCategory', 'TagsCategory',
  'VcsChangeCategory', 'PullRequestChangeCategory',
];
const KIND = {
  CommentsCategory: 'comment',
  CommentAttachmentsCategory: 'attachment',
  AttachmentsCategory: 'attachment',
  CustomFieldCategory: 'field',
  DescriptionCategory: 'description',
  SummaryCategory: 'title',
  LinksCategory: 'link',
  TagsCategory: 'tag',
  VcsChangeCategory: 'commit',
  PullRequestChangeCategory: 'pull-request',
  IssueCreatedCategory: 'created',
  IssueResolvedCategory: 'resolved',
};

function errorText(json, text, fallback) {
  if (json && typeof json === 'object') {
    return json.error_description || json.error_developer_message || json.error || fallback;
  }
  if (text && text.length < 300 && !/<html/i.test(text)) return text.trim();
  return fallback;
}

// Reads a work item's day back. YouTrack stores it as midnight UTC; adding 12 hours before
// truncating keeps the right day even if a server stored local midnight instead.
const itemDate = (ms) => D.dateFromWorkItemMs(ms);

class YouTrack {
  static id = 'youtrack';
  static label = 'YouTrack';

  // workTypes: work items can carry a type (Development, Review, …).
  // activity: activities() returns my comments, field changes and so on, for suggestions.
  static capabilities = { workTypes: true, activity: true };

  // What the connect form asks for. `required` is the message when a field is left empty;
  // a `secret` field left empty keeps the saved value.
  static credentials = [
    { name: 'url', label: 'Address', placeholder: 'https://youtrack.example.com', required: 'Enter your YouTrack address, for example https://youtrack.example.com.' },
    { name: 'token', label: 'Permanent token', placeholder: 'perm:…', secret: true, required: 'Paste a permanent token from your YouTrack profile.' },
  ];

  // How to get the token. **Bold** marks what to click. `link.path` is opened on the address.
  static help = {
    title: 'Where do I get a token?',
    steps: [
      'In YouTrack: your avatar → **Profile** → **Account Security**.',
      '**New token…**, name it “Finito”, scope **YouTrack**.',
      'Copy it now (YouTrack shows it once) and paste it here.',
    ],
    link: { label: 'Open my YouTrack profile', path: '/users/me' },
  };

  // Accepts whatever the person pastes (a bare host, an issue link, a dashboard URL) and
  // returns the YouTrack base address.
  static normalizeUrl(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch (_) { return ''; }
    let p = u.pathname.replace(/\/+$/, '');
    const cut = p.search(/\/(issue|issues|dashboard|agiles|timesheets|articles|projects|api|admin|users|reports|hub)(\/|$)/i);
    if (cut >= 0) p = p.slice(0, cut);
    return (u.origin + p).replace(/\/+$/, '');
  }

  static normalizeCreds(creds) {
    return { url: YouTrack.normalizeUrl(creds.url), token: String(creds.token || '').trim() };
  }

  // Takes { creds } as saved by connect(), or { url, token }.
  constructor({ creds, url, token, timeoutMs = 20000 }) {
    const c = creds || { url, token };
    this.base = String(c.url || '').replace(/\/+$/, '');
    this.token = c.token;
    this.timeoutMs = timeoutMs;
  }

  // Checks the address and token, following redirects ourselves so the token isn't
  // dropped on an http -> https hop. Every error here is something the person can fix.
  // Returns the address it ended up on, who the token belongs to, and the creds to save.
  static async connect({ url, token }) {
    let base = url;
    for (let hop = 0; hop < 4; hop++) {
      let res;
      try {
        res = await fetch(base + '/api/users/me?fields=id,login,fullName,email', {
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
      } catch (e) {
        const code = (e.cause && (e.cause.code || e.cause.message)) || e.message;
        throw new TrackerError(`Couldn't reach ${base} (${code}). Check the address, and your VPN if YouTrack needs one.`, 0);
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) break;
        const next = new URL(loc, base);
        if (base.startsWith('https:') && next.protocol === 'http:') {
          throw new TrackerError(`${base} redirects to an unencrypted http:// address, so Finito stopped before sending your token there.`, 0);
        }
        const at = next.pathname.indexOf('/api/users/me');
        base = (next.origin + (at > 0 ? next.pathname.slice(0, at) : '')).replace(/\/+$/, '');
        continue;
      }
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
      if (res.status === 401 || res.status === 403) {
        throw new TrackerError('YouTrack turned the token down. Use a permanent token with the YouTrack scope.', res.status);
      }
      if (!res.ok) {
        const why = json && (json.error_description || json.error) ? `: ${json.error_description || json.error}` : '';
        throw new TrackerError(`YouTrack answered ${res.status}${why}. Is this the right address?`, res.status);
      }
      if (!json || !json.login) throw new TrackerError("That address answered, but it doesn't look like YouTrack.", res.status);
      return { base, user: toUser(json), creds: { url: base, token } };
    }
    throw new TrackerError('Too many redirects from that address.', 0);
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const headers = { Authorization: 'Bearer ' + this.token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      const code = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      throw new TrackerError(timedOut ? 'YouTrack took too long to answer.' : `Couldn't reach YouTrack (${code}).`, 0, true);
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }

    if (!res.ok) {
      const msg = errorText(json, text, res.statusText || 'request failed');
      throw new TrackerError(`YouTrack ${res.status}: ${msg}`, res.status, res.status >= 500 || res.status === 429);
    }
    return json;
  }

  // Where the person can look things up in YouTrack itself. timesheets is null where a
  // tracker has no such page.
  links() {
    return { issue: this.base + '/issue/{key}', timesheets: this.base + '/timesheets' };
  }

  // ---------- shapes ----------

  toIssue(i) {
    if (!i || !i.idReadable) return null;
    return {
      key: i.idReadable,
      dbId: i.id || null,
      title: i.summary || '',
      resolved: !!i.resolved,
      project: i.project && i.project.shortName ? { key: i.project.shortName, name: i.project.name || '', dbId: i.project.id || null } : null,
      url: this.base + '/issue/' + i.idReadable,
    };
  }

  toItem(w) {
    return {
      id: w.id,
      issue: this.toIssue(w.issue),
      date: itemDate(w.date),
      minutes: w.duration ? w.duration.minutes : 0,
      type: w.type ? { id: w.type.id, name: w.type.name } : null,
      note: w.text || '',
      author: w.author ? { id: w.author.id, login: w.author.login } : null,
      createdAt: w.created || null,
    };
  }

  // The issue an activity is about: the issue itself, or the issue a comment belongs to.
  toActivity(a) {
    if (!a || !a.timestamp || !a.target) return null;
    const t = a.target;
    const issue = this.toIssue(t.idReadable ? t : t.issue);
    if (!issue) return null;
    const cat = (a.category && a.category.id) || '';
    return { id: a.id || null, at: a.timestamp, issue, kind: KIND[cat] || 'other', state: stateName(a) };
  }

  // ---------- issues ----------

  async me() {
    return toUser(await this.request('GET', '/api/users/me', { query: { fields: 'id,login,fullName,email' } }));
  }

  async getIssue(key) {
    return this.toIssue(await this.request('GET', `/api/issues/${encodeURIComponent(key)}`, { query: { fields: ISSUE_FIELDS } }));
  }

  // Free text, read as a YouTrack query.
  async searchIssues(text, limit = 10) {
    const list = await this.request('GET', '/api/issues', { query: { query: text, fields: ISSUE_FIELDS, $top: limit } });
    return (list || []).map((i) => this.toIssue(i)).filter(Boolean);
  }

  myOpenIssues(limit = 15) {
    return this.searchIssues(MY_OPEN, limit);
  }

  // Keys of the projects I can see. Used to tell issue keys apart from look-alikes such as UTF-8.
  async projectKeys() {
    const list = await this.request('GET', '/api/admin/projects', { query: { fields: 'id,shortName,name', $top: 2000 } });
    return (list || []).map((p) => p.shortName).filter(Boolean);
  }

  // ---------- work items ----------

  // All of my work items between two days (inclusive), across projects.
  async workItems(fromDate, toDate) {
    const out = [];
    const top = 500;
    for (let skip = 0; skip < 10000; skip += top) {
      const page = await this.request('GET', '/api/workItems', {
        query: { author: 'me', startDate: fromDate, endDate: toDate, fields: ITEM_FIELDS, $top: top, $skip: skip },
      });
      if (!Array.isArray(page) || !page.length) break;
      out.push(...page);
      if (page.length < top) break;
    }
    return out.map((w) => this.toItem(w));
  }

  async issueWorkItems(issue) {
    const list = await this.request('GET', `/api/issues/${ref(issue)}/timeTracking/workItems`, {
      query: { fields: ITEM_FIELDS, $top: 1000 },
    });
    return (list || []).map((w) => this.toItem(w));
  }

  async createWorkItem(issue, { date, minutes, type, note }) {
    const body = { date: D.utcMidnightMs(date), duration: { minutes } };
    if (note) body.text = note;
    if (type) body.type = { id: type.id };
    return this.toItem(await this.request('POST', `/api/issues/${ref(issue)}/timeTracking/workItems`, {
      query: { fields: ITEM_FIELDS },
      body,
    }));
  }

  // patch: any of minutes, note, type (a WorkType, or null to clear it).
  async updateWorkItem(issue, id, patch) {
    const body = {};
    if ('minutes' in patch) body.duration = { minutes: patch.minutes };
    if ('note' in patch) body.text = patch.note;
    if ('type' in patch) body.type = patch.type ? { id: patch.type.id } : null;
    return this.toItem(await this.request('POST', `/api/issues/${ref(issue)}/timeTracking/workItems/${encodeURIComponent(id)}`, {
      query: { fields: ITEM_FIELDS },
      body,
    }));
  }

  deleteWorkItem(issue, id) {
    return this.request('DELETE', `/api/issues/${ref(issue)}/timeTracking/workItems/${encodeURIComponent(id)}`);
  }

  // Work item types for a project.
  async workTypes(project) {
    if (!project || !project.dbId) return { enabled: true, types: [] };
    try {
      const s = await this.request('GET', `/api/admin/projects/${encodeURIComponent(project.dbId)}/timeTrackingSettings`, {
        query: { fields: 'enabled,workItemTypes(id,name)' },
      });
      return { enabled: !s || s.enabled !== false, types: ((s && s.workItemTypes) || []).map((t) => ({ id: t.id, name: t.name })) };
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e;
      const all = await this.request('GET', '/api/admin/timeTrackingSettings/workItemTypes', { query: { fields: 'id,name' } });
      return { enabled: true, types: (all || []).map((t) => ({ id: t.id, name: t.name })), global: true };
    }
  }

  // ---------- activity ----------

  // My activity (comments, field changes, …) between two moments, oldest first. Each list of
  // requests is tried in order until one works: richer requests first, plainer ones after,
  // since some YouTrack versions and permissions refuse the richer fields.
  async activities(fromMs, toMs) {
    const items = [];
    const errors = [];
    const fetchFirstWorking = async (variants) => {
      let last = null;
      for (const v of variants) {
        try {
          const r = await this.request('GET', '/api/activities', {
            query: { categories: v.categories, author: 'me', start: fromMs, end: toMs, reverse: 'false', fields: v.fields, $top: 2000 },
          });
          for (const a of Array.isArray(r) ? r : []) {
            const x = this.toActivity(a);
            if (x) items.push(x);
          }
          return;
        } catch (e) {
          if (e.status === 401) throw e;
          last = e;
        }
      }
      if (last) errors.push(last.message);
    };
    await fetchFirstWorking([
      { categories: ['CustomFieldCategory'], fields: `id,timestamp,category(id),targetMember,field(name,presentation),added(name),${TARGET_FIELDS}` },
      { categories: ['CustomFieldCategory'], fields: `id,timestamp,category(id),${TARGET_FIELDS}` },
      { categories: ['CustomFieldCategory'], fields: `id,timestamp,category(id),${SIMPLE_TARGET_FIELDS}` },
    ]);
    await fetchFirstWorking([
      { categories: ACTIVITY_CATEGORIES, fields: `id,timestamp,category(id),${TARGET_FIELDS}` },
      { categories: ACTIVITY_CATEGORIES, fields: `id,timestamp,category(id),${SIMPLE_TARGET_FIELDS}` },
      { categories: ['CommentsCategory', 'AttachmentsCategory', 'IssueCreatedCategory'], fields: `id,timestamp,category(id),${SIMPLE_TARGET_FIELDS}` },
    ]);
    return { items, errors };
  }
}

function toUser(u) {
  return { id: u.id, login: u.login, name: u.fullName || u.login || '', email: u.email || '' };
}

// YouTrack takes either the readable key or the database id in a path.
function ref(issue) {
  const r = typeof issue === 'string' ? issue : issue && (issue.dbId || issue.key);
  return encodeURIComponent(r || '');
}

function stateName(a) {
  if (!a || !a.category || a.category.id !== 'CustomFieldCategory') return null;
  const fieldName = (a.field && (a.field.name || a.field.presentation)) || a.targetMember || '';
  if (!/state/i.test(fieldName)) return null;
  const v = Array.isArray(a.added) ? a.added[0] : a.added;
  return v && typeof v === 'object' && v.name ? v.name : null;
}

module.exports = { YouTrack, TrackerError, YouTrackError: TrackerError, ISSUE_FIELDS, ITEM_FIELDS };
