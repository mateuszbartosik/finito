'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { JsonFile } = require('./store');
const { YouTrack, YouTrackError } = require('./youtrack');
const { buildSuggestions } = require('./suggest');
const D = require('./dates');

const DEFAULT_SETTINGS = {
  dailyTargetMinutes: 480,
  workDays: [1, 2, 3, 4, 5], // 0 = Sunday
  timerRounding: 5,
  dayEnds: '18:00',
  typeDefaults: {}, // project short name -> work type name
};

const ACTIVITY_CATEGORIES = [
  'CommentsCategory', 'CommentAttachmentsCategory', 'AttachmentsCategory', 'IssueCreatedCategory',
  'IssueResolvedCategory', 'DescriptionCategory', 'SummaryCategory', 'LinksCategory', 'TagsCategory',
  'VcsChangeCategory', 'PullRequestChangeCategory',
];
const PROJECT_FIELDS = 'project(id,shortName,name)';
const TARGET_FIELDS = `target(id,idReadable,summary,${PROJECT_FIELDS},issue(id,idReadable,summary,${PROJECT_FIELDS}))`;
const SIMPLE_TARGET_FIELDS = 'target(idReadable,summary,issue(idReadable,summary))';
const ISSUE_ID = /^[A-Za-z][\w]*-\d+$/;

const CACHE_TTL = 10 * 60 * 1000;
const WEEK_TTL = 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// Accepts whatever the person pastes (a bare host, an issue link, a dashboard URL) and
// returns the YouTrack base address.
function normalizeUrl(input) {
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

// Checks the address and token, following redirects ourselves so the token isn't
// dropped on an http -> https hop.
async function probeYouTrack(url, token) {
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
      throw httpError(400, `Couldn't reach ${base} (${code}). Check the address, and your VPN if YouTrack needs one.`);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) break;
      const next = new URL(loc, base);
      if (base.startsWith('https:') && next.protocol === 'http:') {
        throw httpError(400, `${base} redirects to an unencrypted http:// address, so Spent stopped before sending your token there.`);
      }
      const at = next.pathname.indexOf('/api/users/me');
      base = (next.origin + (at > 0 ? next.pathname.slice(0, at) : '')).replace(/\/+$/, '');
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    if (res.status === 401 || res.status === 403) {
      throw httpError(400, 'YouTrack turned the token down. Use a permanent token with the YouTrack scope.');
    }
    if (!res.ok) {
      const why = json && (json.error_description || json.error) ? `: ${json.error_description || json.error}` : '';
      throw httpError(400, `YouTrack answered ${res.status}${why}. Is this the right address?`);
    }
    if (!json || !json.login) throw httpError(400, "That address answered, but it doesn't look like YouTrack.");
    return { base, user: json };
  }
  throw httpError(400, 'Too many redirects from that address.');
}

function openBrowser(url) {
  try {
    const opts = { detached: true, stdio: 'ignore' };
    let child;
    if (process.platform === 'win32') {
      // Verbatim: Node's own quoting of the empty window title confuses cmd's start.
      child = spawn('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')],
        { ...opts, windowsVerbatimArguments: true, windowsHide: true });
    }
    else if (process.platform === 'darwin') child = spawn('open', [url], opts);
    else child = spawn('xdg-open', [url], opts);
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* the URL is printed anyway */ }
}

function createApp(opts = {}) {
  const wantedPort = Number(opts.port === undefined ? 5178 : opts.port);
  const dataDir = path.resolve(opts.dataDir || path.join(__dirname, '..', 'data'));
  const publicDir = path.resolve(opts.publicDir || path.join(__dirname, '..', 'public'));
  let port = wantedPort;

  const config = new JsonFile(path.join(dataDir, 'config.json'), { youtrackUrl: '', token: '' });
  const store = new JsonFile(path.join(dataDir, 'state.json'), {
    version: 1, seq: 1, drafts: [], edits: {}, deletions: {}, rows: {}, timer: null, dismissed: {}, settings: {},
  });

  let yt = null;
  let me = null;
  const issueCache = new Map();
  const typeCache = new Map();
  const weekCache = new Map();

  // ---------- helpers ----------

  function settings() {
    const s = store.load();
    const merged = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    merged.typeDefaults = Object.assign({}, (s.settings && s.settings.typeDefaults) || {});
    return merged;
  }

  function client() {
    const c = config.load();
    if (!c.youtrackUrl || !c.token) return null;
    const base = c.youtrackUrl.replace(/\/+$/, '');
    if (!yt || yt.base !== base || yt.token !== c.token) {
      yt = new YouTrack({ url: base, token: c.token, timeoutMs: opts.timeoutMs || 20000 });
      me = null;
    }
    return yt;
  }

  function requireClient() {
    const c = client();
    if (!c) throw httpError(409, 'Connect YouTrack first.');
    return c;
  }

  async function currentUser() {
    if (!me) me = await requireClient().me();
    return me;
  }

  function slimIssue(i) {
    return {
      id: i.id,
      idReadable: i.idReadable,
      summary: i.summary || '',
      resolved: !!i.resolved,
      project: i.project ? { id: i.project.id, shortName: i.project.shortName, name: i.project.name } : null,
    };
  }

  function rememberIssue(i) {
    if (i && i.idReadable) issueCache.set(i.idReadable.toLowerCase(), { issue: slimIssue(i), at: Date.now() });
  }

  function cachedIssue(id) {
    const c = issueCache.get(String(id || '').toLowerCase());
    return c ? c.issue : null;
  }

  async function getIssue(id) {
    const key = String(id || '').trim();
    if (!ISSUE_ID.test(key)) throw httpError(400, `“${key}” isn't an issue ID.`);
    const c = issueCache.get(key.toLowerCase());
    if (c && Date.now() - c.at < CACHE_TTL) return c.issue;
    try {
      const i = await requireClient().issue(key);
      rememberIssue(i);
      return slimIssue(i);
    } catch (e) {
      if (e.status === 404) throw httpError(404, `${key} isn't in your YouTrack, or you can't see it.`);
      throw e;
    }
  }

  async function getTypes(project) {
    if (!project || !project.id) return { enabled: true, types: [] };
    const c = typeCache.get(project.id);
    if (c && Date.now() - c.at < CACHE_TTL) return c;
    const t = Object.assign({ at: Date.now() }, await requireClient().projectTypes(project.id));
    typeCache.set(project.id, t);
    return t;
  }

  async function resolveType(issue, name) {
    if (!name) return null;
    const { types } = await getTypes(issue.project);
    const n = String(name).trim().toLowerCase();
    const exact = types.find((t) => t.name.toLowerCase() === n);
    if (exact) return exact;
    const starts = types.filter((t) => t.name.toLowerCase().startsWith(n));
    if (starts.length === 1) return starts[0];
    const pk = issue.project ? issue.project.shortName : 'This project';
    if (!types.length) throw httpError(400, `${pk} has no work types, so leave the type empty.`);
    throw httpError(400, `${pk} has no “${name}” work type. Pick one of: ${types.map((t) => t.name).join(', ')}.`);
  }

  async function defaultTypeName(issue) {
    const wanted = issue.project && settings().typeDefaults[issue.project.shortName];
    if (!wanted) return null;
    try { return (await resolveType(issue, wanted)).name; } catch (_) { return null; }
  }

  async function weekItems(monday, fresh) {
    const hit = weekCache.get(monday);
    if (!fresh && hit && Date.now() - hit.at < WEEK_TTL) return hit.items;
    const dates = D.weekDates(monday);
    const items = await requireClient().workItems(dates[0], dates[6]);
    for (const i of items) if (i.issue) rememberIssue(i.issue);
    weekCache.set(monday, { at: Date.now(), items });
    return items;
  }

  function ytEntry(item) {
    const iss = item.issue || {};
    return {
      key: 'y:' + item.id,
      ytId: item.id,
      issue: iss.idReadable,
      issueDbId: iss.id,
      date: D.dateFromWorkItemMs(item.date),
      minutes: item.duration ? item.duration.minutes : 0,
      type: item.type ? item.type.name : null,
      text: item.text || '',
      status: 'synced',
    };
  }

  function withOverlay(e, s) {
    const del = s.deletions[e.ytId];
    if (del) return Object.assign({}, e, { status: 'deleted', error: del.error || null });
    const ed = s.edits[e.ytId];
    if (ed && ed.changes && Object.keys(ed.changes).length) {
      const out = Object.assign({}, e, { status: 'edited', error: ed.error || null, base: { minutes: e.minutes, type: e.type, text: e.text } });
      for (const k of ['minutes', 'type', 'text']) if (k in ed.changes) out[k] = ed.changes[k];
      return out;
    }
    return e;
  }

  function draftEntry(d) {
    return {
      key: 'd:' + d.key, ytId: null, issue: d.issue, date: d.date, minutes: d.minutes,
      type: d.type || null, text: d.text || '', status: 'draft', error: d.error || null, fromTimer: !!d.fromTimer,
    };
  }

  function pendingCount(s) {
    const edits = Object.keys(s.edits).filter((id) => !s.deletions[id]).length;
    return s.drafts.length + Object.keys(s.deletions).length + edits;
  }

  function prune(s) {
    const oldestWeek = D.addDays(D.mondayOf(D.localDate()), -7 * 26);
    for (const k of Object.keys(s.rows || {})) if (k < oldestWeek) delete s.rows[k];
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    for (const [k, v] of Object.entries(s.dismissed || {})) if (v < cutoff) delete s.dismissed[k];
  }

  function stopTimer(s, endAt) {
    const t = s.timer;
    const end = Math.max(t.startedAt, Number(endAt) || Date.now());
    const step = Math.max(1, Number(settings().timerRounding) || 1);
    const issue = cachedIssue(t.issue);
    const type = issue && issue.project ? settings().typeDefaults[issue.project.shortName] || null : null;
    // A timer that ran past midnight becomes one draft per day.
    const pieces = [];
    for (let from = t.startedAt; from < end;) {
      const date = D.localDate(from);
      const to = Math.min(end, D.localMidnightMs(D.addDays(date, 1)));
      pieces.push({ date, minutes: (to - from) / 60000 });
      from = to;
    }
    if (!pieces.length) pieces.push({ date: D.localDate(t.startedAt), minutes: 0 });
    const out = [];
    pieces.forEach((p, i) => {
      let minutes = Math.round(p.minutes / step) * step;
      if (minutes <= 0 && pieces.length === 1 && i === 0) minutes = step; // a short run still counts once
      if (minutes <= 0) return;
      s.drafts.push({ key: String(s.seq++), issue: t.issue, date: p.date, minutes, type, text: '', createdAt: Date.now(), fromTimer: true });
      out.push({ issue: t.issue, date: p.date, minutes });
    });
    return out;
  }

  // If a create timed out, the item may have landed anyway. Look before writing again.
  async function findLanded(c, issue, d) {
    try {
      const user = await currentUser();
      const items = await c.issueWorkItems(issue.id);
      const recent = Date.now() - 15 * 60 * 1000;
      return (items || []).find((i) => i.author && i.author.login === user.login
        && D.dateFromWorkItemMs(i.date) === d.date
        && i.duration && i.duration.minutes === d.minutes
        && (i.text || '') === (d.text || '')
        && (!i.created || i.created >= recent)) || null;
    } catch (_) {
      return null;
    }
  }

  function setError(s, key, msg) {
    if (key.startsWith('d:')) {
      const d = s.drafts.find((x) => x.key === key.slice(2));
      if (d) d.error = msg;
    } else {
      const id = key.slice(2);
      if (s.deletions[id]) s.deletions[id].error = msg;
      else if (s.edits[id]) s.edits[id].error = msg;
    }
  }

  async function submitOne(c, key) {
    const s = store.load();
    if (key.startsWith('d:')) {
      const d = s.drafts.find((x) => x.key === key.slice(2));
      if (!d) return { skipped: true };
      const issue = await getIssue(d.issue);
      const type = d.type ? await resolveType(issue, d.type) : null;
      const payload = { date: D.utcMidnightMs(d.date), minutes: d.minutes, typeId: type ? type.id : null, text: d.text };
      let created;
      let retried = false;
      try {
        created = await c.createWorkItem(issue.id, payload);
      } catch (e) {
        if (!e.transient) throw e;
        retried = true;
        created = (await findLanded(c, issue, d)) || (await c.createWorkItem(issue.id, payload));
      }
      store.update((st) => { st.drafts = st.drafts.filter((x) => x.key !== d.key); });
      return { entry: ytEntry(created), retried };
    }
    if (key.startsWith('y:')) {
      const ytId = key.slice(2);
      const del = s.deletions[ytId];
      if (del) {
        const issueRef = del.issueDbId || (await getIssue(del.issue)).id;
        let retried = false;
        try {
          await c.deleteWorkItem(issueRef, ytId);
        } catch (e) {
          if (e.status === 404) { /* already gone */ } else if (e.transient) {
            retried = true;
            try { await c.deleteWorkItem(issueRef, ytId); } catch (e2) { if (e2.status !== 404) throw e2; }
          } else throw e;
        }
        store.update((st) => { delete st.deletions[ytId]; delete st.edits[ytId]; });
        return { removed: true, retried };
      }
      const ed = s.edits[ytId];
      if (!ed) return { skipped: true };
      const issue = await getIssue(ed.issue);
      const patch = {};
      if ('minutes' in ed.changes) patch.duration = { minutes: ed.changes.minutes };
      if ('text' in ed.changes) patch.text = ed.changes.text;
      if ('type' in ed.changes) patch.type = ed.changes.type ? { id: (await resolveType(issue, ed.changes.type)).id } : null;
      let updated;
      let retried = false;
      try {
        updated = await c.updateWorkItem(issue.id, ytId, patch);
      } catch (e) {
        if (e.status === 404) {
          // Deleted in YouTrack meanwhile: there's nothing left to edit.
          store.update((st) => { delete st.edits[ytId]; });
          return { dropped: true };
        }
        if (!e.transient) throw e;
        retried = true; // an update sets values, so sending it twice is safe
        updated = await c.updateWorkItem(issue.id, ytId, patch);
      }
      store.update((st) => { delete st.edits[ytId]; });
      return { entry: ytEntry(updated), retried };
    }
    throw httpError(400, 'Unknown change.');
  }

  // ---------- routes ----------

  const routes = [];
  function route(method, pattern, handler) {
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });
  }

  route('GET', '/api/status', async () => {
    const cfg = config.load();
    const c = client();
    if (!c) return { configured: false, url: cfg.youtrackUrl || '' };
    try {
      const user = await currentUser();
      return { configured: true, url: c.base, user };
    } catch (e) {
      return { configured: true, url: c.base, user: null, error: e.message, ytStatus: e.status || 0 };
    }
  });

  route('POST', '/api/setup', async ({ body }) => {
    const url = normalizeUrl(body.url);
    const token = String(body.token || '').trim() || config.load().token;
    if (!url) throw httpError(400, 'Enter your YouTrack address, for example https://youtrack.example.com.');
    if (!token) throw httpError(400, 'Paste a permanent token from your YouTrack profile.');
    const probe = await probeYouTrack(url, token);
    config.update((c) => { c.youtrackUrl = probe.base; c.token = token; });
    yt = null;
    client();
    me = probe.user;
    issueCache.clear();
    typeCache.clear();
    weekCache.clear();
    return { ok: true, url: probe.base, user: probe.user };
  });

  route('POST', '/api/disconnect', async () => {
    config.update((c) => { c.token = ''; });
    yt = null;
    me = null;
    return { ok: true };
  });

  route('GET', '/api/week', async ({ query }) => {
    const c = requireClient();
    const today = D.localDate();
    const monday = D.isDate(query.start) ? D.mondayOf(query.start) : D.mondayOf(today);
    const dates = D.weekDates(monday);
    const s = store.load();
    let items = [];
    let ytError = null;
    try {
      items = await weekItems(monday, query.fresh === '1');
    } catch (e) {
      if (e.status === 401) throw e;
      ytError = e.message;
    }
    const entries = items.map(ytEntry).filter((e) => dates.includes(e.date)).map((e) => withOverlay(e, s));
    for (const d of s.drafts) if (dates.includes(d.date)) entries.push(draftEntry(d));

    const ids = new Set(entries.map((e) => e.issue).filter(Boolean));
    for (const id of s.rows[monday] || []) ids.add(id);
    if (s.timer) ids.add(s.timer.issue);
    const issues = {};
    await Promise.all([...ids].map(async (id) => {
      try { issues[id] = await getIssue(id); } catch (e) {
        issues[id] = { idReadable: id, summary: '', missing: true, error: e.message, project: null };
      }
    }));
    const projects = {};
    for (const i of Object.values(issues)) {
      if (i.project && !projects[i.project.shortName]) projects[i.project.shortName] = Object.assign({}, i.project);
    }
    await Promise.all(Object.values(projects).map(async (p) => {
      try {
        const t = await getTypes(p);
        p.types = t.types.map((x) => x.name);
        p.timeTracking = t.enabled;
      } catch (e) {
        p.types = [];
        p.typesError = e.message;
      }
    }));
    return {
      monday, dates, today, entries, issues, projects,
      rows: s.rows[monday] || [],
      timer: s.timer,
      settings: settings(),
      pending: pendingCount(s),
      url: c.base,
      user: me,
      ytError,
    };
  });

  route('POST', '/api/entries', async ({ body }) => {
    const dates = Array.isArray(body.dates) ? body.dates : [body.date];
    if (!dates.length || !dates.every(D.isDate)) throw httpError(400, 'Pick a day for this time.');
    const minutes = Math.round(Number(body.minutes));
    if (!(minutes >= 1 && minutes <= 1440)) throw httpError(400, 'Time has to be between 1 minute and 24 hours.');
    const issue = await getIssue(body.issue);
    let type = null;
    if (body.type === undefined || body.type === '') type = await defaultTypeName(issue);
    else if (body.type !== null) type = (await resolveType(issue, body.type)).name;
    const text = String(body.text || '').slice(0, 4000);
    const s = store.update((st) => {
      for (const date of dates) {
        st.drafts.push({ key: String(st.seq++), issue: issue.idReadable, date, minutes, type, text, createdAt: Date.now() });
      }
    });
    return { ok: true, issue, type, pending: pendingCount(s) };
  });

  route('PATCH', '/api/entries/:key', async ({ params, body }) => {
    const key = params.key;
    const s = store.load();
    const draft = key.startsWith('d:') ? s.drafts.find((x) => x.key === key.slice(2)) : null;
    if (key.startsWith('d:') && !draft) throw httpError(404, 'That draft is gone. Reload the week.');
    const base = body.base || {};
    const changes = {};
    if ('minutes' in body) {
      const m = Math.round(Number(body.minutes));
      if (!(m >= 1 && m <= 1440)) throw httpError(400, 'Time has to be between 1 minute and 24 hours.');
      changes.minutes = m;
    }
    if ('text' in body) changes.text = String(body.text || '').slice(0, 4000);
    if ('type' in body) {
      if (body.type) {
        const issue = await getIssue(draft ? draft.issue : base.issue);
        changes.type = (await resolveType(issue, body.type)).name;
      } else changes.type = null;
    }
    if (draft) {
      if ('date' in body) {
        if (!D.isDate(body.date)) throw httpError(400, 'That date looks wrong.');
        draft.date = body.date;
      }
      Object.assign(draft, changes);
      draft.error = null;
    } else if (key.startsWith('y:')) {
      const ytId = key.slice(2);
      const ed = s.edits[ytId] || {
        issue: base.issue,
        issueDbId: base.issueDbId,
        date: base.date,
        base: { minutes: base.minutes, type: base.type || null, text: base.text || '' },
        changes: {},
      };
      if (!ed.issue) throw httpError(400, 'The original work item is needed to edit it.');
      Object.assign(ed.changes, changes);
      for (const k of Object.keys(ed.changes)) if (ed.changes[k] === ed.base[k]) delete ed.changes[k];
      if (Object.keys(ed.changes).length) {
        ed.error = null;
        s.edits[ytId] = ed;
      } else delete s.edits[ytId];
    } else throw httpError(400, 'Unknown entry.');
    store.save();
    return { ok: true, pending: pendingCount(s) };
  });

  route('POST', '/api/entries/:key/remove', async ({ params, body }) => {
    const key = params.key;
    const s = store.load();
    if (key.startsWith('d:')) {
      s.drafts = s.drafts.filter((d) => d.key !== key.slice(2));
    } else if (key.startsWith('y:')) {
      const snap = body.snapshot || {};
      if (!snap.issue) throw httpError(400, 'The original work item is needed to remove it.');
      s.deletions[key.slice(2)] = {
        issue: snap.issue, issueDbId: snap.issueDbId, date: snap.date, minutes: snap.minutes,
        type: snap.type || null, text: snap.text || '',
      };
    } else throw httpError(400, 'Unknown entry.');
    store.save();
    return { ok: true, pending: pendingCount(s) };
  });

  route('POST', '/api/entries/:key/restore', async ({ params }) => {
    const s = store.load();
    if (params.key.startsWith('y:')) delete s.deletions[params.key.slice(2)];
    store.save();
    return { ok: true, pending: pendingCount(s) };
  });

  route('GET', '/api/pending', async () => {
    const s = store.load();
    const items = [];
    for (const d of s.drafts) {
      items.push({ key: 'd:' + d.key, change: 'new', issue: d.issue, date: d.date, minutes: d.minutes, type: d.type || null, text: d.text || '', error: d.error || null });
    }
    for (const [id, ed] of Object.entries(s.edits)) {
      if (s.deletions[id]) continue;
      const v = Object.assign({}, ed.base, ed.changes);
      items.push({ key: 'y:' + id, change: 'edit', issue: ed.issue, date: ed.date, minutes: v.minutes, type: v.type || null, text: v.text || '', fields: Object.keys(ed.changes), error: ed.error || null });
    }
    for (const [id, del] of Object.entries(s.deletions)) {
      items.push({ key: 'y:' + id, change: 'remove', issue: del.issue, date: del.date, minutes: del.minutes, type: del.type || null, text: del.text || '', error: del.error || null });
    }
    items.sort((a, b) => (a.date === b.date ? String(a.issue).localeCompare(String(b.issue)) : a.date < b.date ? -1 : 1));
    const summaries = {};
    for (const it of items) {
      const ci = cachedIssue(it.issue);
      if (ci) summaries[it.issue] = ci.summary;
    }
    return { items, summaries };
  });

  route('POST', '/api/submit/:key', async ({ params }) => {
    const c = requireClient();
    const key = params.key;
    try {
      const result = await submitOne(c, key);
      weekCache.clear();
      return Object.assign({ ok: true }, result);
    } catch (e) {
      if (e.status === 401) throw e;
      const msg = e.message || String(e);
      store.update((st) => setError(st, key, msg));
      return { ok: false, error: msg };
    }
  });

  route('POST', '/api/refresh', async () => {
    weekCache.clear();
    issueCache.clear();
    typeCache.clear();
    return { ok: true };
  });

  route('POST', '/api/timer/start', async ({ body }) => {
    const issue = await getIssue(body.issue);
    const s = store.load();
    const stopped = s.timer ? stopTimer(s, Date.now()) : [];
    s.timer = { issue: issue.idReadable, startedAt: Date.now() };
    store.save();
    return { ok: true, timer: s.timer, stopped, pending: pendingCount(s) };
  });

  route('POST', '/api/timer/stop', async ({ body }) => {
    const s = store.load();
    if (!s.timer) return { ok: true, stopped: [] };
    const stopped = body.discard ? [] : stopTimer(s, body.endAt);
    s.timer = null;
    store.save();
    return { ok: true, stopped, pending: pendingCount(s) };
  });

  route('POST', '/api/rows', async ({ body }) => {
    const monday = D.isDate(body.monday) ? D.mondayOf(body.monday) : D.mondayOf(D.localDate());
    const s = store.load();
    s.rows[monday] = s.rows[monday] || [];
    const rows = s.rows[monday];
    if (body.action === 'add') {
      const issue = await getIssue(body.issue);
      if (!rows.includes(issue.idReadable)) rows.push(issue.idReadable);
      store.save();
      return { ok: true, issue, rows };
    }
    if (body.action === 'remove') {
      s.rows[monday] = rows.filter((id) => id !== body.issue);
      store.save();
      return { ok: true, rows: s.rows[monday] };
    }
    if (body.action === 'copy-previous') {
      const prev = D.addDays(monday, -7);
      const prevItems = await weekItems(prev, false);
      const candidates = [...new Set([...(s.rows[prev] || []), ...prevItems.map((i) => i.issue && i.issue.idReadable).filter(Boolean)])];
      const thisItems = await weekItems(monday, false);
      const present = new Set([...rows, ...thisItems.map((i) => i.issue && i.issue.idReadable), ...s.drafts.filter((d) => D.mondayOf(d.date) === monday).map((d) => d.issue)]);
      const added = [];
      const skipped = [];
      for (const id of candidates) {
        if (present.has(id)) continue;
        let iss;
        try { iss = await getIssue(id); } catch (_) { continue; }
        if (iss.resolved) skipped.push(iss.idReadable);
        else { rows.push(iss.idReadable); added.push(iss.idReadable); }
      }
      store.save();
      return { ok: true, added, skipped, rows };
    }
    throw httpError(400, 'Unknown action.');
  });

  route('GET', '/api/issues/search', async ({ query }) => {
    const c = requireClient();
    const q = String(query.q || '').trim();
    let list = [];
    if (!q) list = await c.searchIssues('for: me #Unresolved sort by: updated desc', 15);
    else if (ISSUE_ID.test(q)) {
      try { list = [await getIssue(q)]; } catch (e) { if (e.httpStatus !== 404) throw e; }
    } else list = await c.searchIssues(q, 15);
    for (const i of list || []) rememberIssue(i);
    return { issues: (list || []).map(slimIssue) };
  });

  route('GET', '/api/issues/mine', async () => {
    const list = await requireClient().searchIssues('for: me #Unresolved sort by: updated desc', 50);
    for (const i of list || []) rememberIssue(i);
    return { issues: (list || []).map(slimIssue) };
  });

  route('GET', '/api/issue/:id', async ({ params }) => ({ issue: await getIssue(params.id) }));

  route('GET', '/api/suggestions', async ({ query }) => {
    const c = requireClient();
    const monday = D.isDate(query.start) ? D.mondayOf(query.start) : D.mondayOf(D.localDate());
    const dates = D.weekDates(monday);
    const start = D.localMidnightMs(dates[0]);
    const end = Math.min(Date.now(), D.localMidnightMs(D.addDays(dates[6], 1)));
    if (end <= start) return { suggestions: [], errors: [] };
    const acts = [];
    const errors = [];
    async function fetchFirstWorking(variants) {
      let last = null;
      for (const v of variants) {
        try {
          const r = await c.activities(Object.assign({ start, end }, v));
          acts.push(...(Array.isArray(r) ? r : []));
          return;
        } catch (e) {
          if (e.status === 401) throw e;
          last = e;
        }
      }
      if (last) errors.push(last.message);
    }
    // Each list is tried in order until one works: richer requests first, plainer ones after.
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
    const s = store.load();
    let items = [];
    try { items = await weekItems(monday, false); } catch (e) { errors.push(e.message); }
    const existing = new Set();
    for (const i of items) {
      if (i.issue && !s.deletions[i.id]) existing.add(i.issue.idReadable + '|' + D.dateFromWorkItemMs(i.date));
    }
    for (const d of s.drafts) existing.add(d.issue + '|' + d.date);
    const suggestions = buildSuggestions(acts, { dates, existing, dismissed: s.dismissed || {} });
    return { suggestions, errors: [...new Set(errors)] };
  });

  route('POST', '/api/suggestions/dismiss', async ({ body }) => {
    store.update((s) => {
      s.dismissed = s.dismissed || {};
      for (const id of [].concat(body.ids || body.id || [])) s.dismissed[String(id)] = Date.now();
    });
    return { ok: true };
  });

  route('GET', '/api/settings', async () => settings());

  route('PUT', '/api/settings', async ({ body }) => {
    const next = settings();
    if ('dailyTargetMinutes' in body) {
      const v = Math.round(Number(body.dailyTargetMinutes));
      if (!(v >= 0 && v <= 1440)) throw httpError(400, 'The daily target has to be between 0 and 24 hours.');
      next.dailyTargetMinutes = v;
    }
    if ('workDays' in body) {
      if (!Array.isArray(body.workDays) || !body.workDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) throw httpError(400, 'Work days look wrong.');
      next.workDays = [...new Set(body.workDays)].sort((a, b) => a - b);
    }
    if ('timerRounding' in body) {
      const v = Number(body.timerRounding);
      if (![1, 5, 10, 15, 30].includes(v)) throw httpError(400, 'Round timers to 1, 5, 10, 15 or 30 minutes.');
      next.timerRounding = v;
    }
    if ('dayEnds' in body) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.dayEnds))) throw httpError(400, 'The end of the day should look like 18:00.');
      next.dayEnds = body.dayEnds;
    }
    if (body.typeDefaults && typeof body.typeDefaults === 'object') {
      next.typeDefaults = {};
      for (const [k, v] of Object.entries(body.typeDefaults)) if (v) next.typeDefaults[String(k)] = String(v);
    }
    store.update((s) => {
      s.settings = next;
      // A new default also fills drafts that don't have a type yet.
      for (const d of s.drafts) {
        if (d.type) continue;
        const iss = cachedIssue(d.issue);
        const def = iss && iss.project && next.typeDefaults[iss.project.shortName];
        if (def) d.type = def;
      }
    });
    return next;
  });

  // ---------- http ----------

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  }

  function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 1024 * 1024) { reject(httpError(413, 'That request is too large.')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text) return resolve({});
        try { resolve(JSON.parse(text)); } catch (_) { reject(httpError(400, 'That request body is not JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch (_) { return sendText(res, 400, 'Bad path'); }
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return sendText(res, 403, 'Forbidden');
    fs.readFile(file, (err, buf) => {
      if (err) return sendText(res, 404, 'Not found');
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      };
      if (file.endsWith('.html')) {
        headers['Content-Security-Policy'] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
        headers['Referrer-Policy'] = 'no-referrer';
      }
      res.writeHead(200, headers);
      res.end(buf);
    });
  }

  function allowedHosts() {
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  }

  async function handle(req, res) {
    const hosts = allowedHosts();
    const host = String(req.headers.host || '').toLowerCase();
    // Only answer to our own address: this blocks DNS-rebinding pages.
    if (!hosts.includes(host)) return sendText(res, 403, 'Spent only answers on localhost.');
    const origin = req.headers.origin;
    if (origin && !hosts.some((h) => String(origin).toLowerCase() === 'http://' + h)) return sendText(res, 403, 'Cross-site requests are not allowed.');
    const url = new URL(req.url, 'http://' + host);
    if (url.pathname.startsWith('/api/')) {
      // A custom header can't be sent cross-site without a CORS preflight, which we never approve.
      if (req.headers['x-spent'] !== '1') return sendJson(res, 403, { error: 'Missing X-Spent header.' });
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) return sendJson(res, 404, { error: 'No such endpoint.' });
      const m = url.pathname.match(r.re);
      const params = {};
      for (const [k, v] of Object.entries(m.groups || {})) params[k] = decodeURIComponent(v);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const out = await r.handler({ req, params, query: Object.fromEntries(url.searchParams), body });
      return sendJson(res, 200, out === undefined ? { ok: true } : out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    return serveStatic(res, url.pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.httpStatus || (e instanceof YouTrackError ? (e.status === 401 ? 401 : 502) : 500);
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: e.message || String(e), ytStatus: e.status || 0 });
      else res.end();
    });
  });

  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(wantedPort, '127.0.0.1', () => {
        port = server.address().port;
        server.removeListener('error', reject);
        try { store.update(prune); } catch (_) { /* best effort */ }
        resolve(port);
      });
    });
  }

  function stop() {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, start, stop, get port() { return port; }, dataDir };
}

module.exports = { createApp, openBrowser, normalizeUrl, probeYouTrack };
