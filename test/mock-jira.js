'use strict';

// A small in-memory stand-in for Jira Cloud's REST API v3: just the endpoints Finito calls.
// Classic API tokens work on the site's address; scoped ones only through the gateway path
// /ex/jira/{cloudId}, like Atlassian's api.atlassian.com. Used by the tests and `npm run demo:jira`.

const http = require('http');
const D = require('../lib/dates');

const CLOUD_ID = 'cloud-1';

function createMockJira({ email = 'sample@example.com', token = 'secret', scopedToken = 'scoped-secret', today = D.localDate() } = {}) {
  const me = { accountId: 'acc-me', displayName: 'Sample User', emailAddress: email };
  const someoneElse = { accountId: 'acc-sam', displayName: 'Sam Doe' };
  const projects = [
    { id: '10000', key: 'APP', name: 'Product' },
    { id: '10001', key: 'DS', name: 'Design System' },
  ];
  const issues = [
    ['10101', 'APP-1207', 'Onboarding: email-first sign-up flow', 'APP', false],
    ['10102', 'APP-1215', 'Billing: empty state for invoices', 'APP', false],
    ['10103', 'APP-1221', 'Design QA for the 3.2 release', 'APP', false],
    ['10104', 'APP-1230', 'Icons: move to the 24 px grid', 'APP', false],
    ['10105', 'APP-1188', 'Support form: remove the legacy fields', 'APP', true],
    ['10106', 'DS-41', 'Buttons: focus ring polish', 'DS', false],
    ['10107', 'APP-1000', 'Meetings and design rituals', 'APP', false],
  ].map(([id, key, summary, project, resolved]) => ({ id, key, summary, project, resolved }));

  const state = { worklogs: [], seq: 20000, failCreates: 0, landThenFail: 0, calls: [], timeTracking: true };

  const findIssue = (ref) => issues.find((i) => i.id === ref || i.key.toLowerCase() === String(ref).toLowerCase());
  const shapeIssue = (i) => {
    const p = projects.find((x) => x.key === i.project);
    return { id: i.id, key: i.key, fields: { summary: i.summary, resolution: i.resolved ? { name: 'Done' } : null, project: { id: p.id, key: p.key, name: p.name } } };
  };
  const pad = D.pad;
  const offset = (ms) => {
    const off = -new Date(ms).getTimezoneOffset();
    const a = Math.abs(off);
    return (off >= 0 ? '+' : '-') + pad(Math.floor(a / 60)) + pad(a % 60);
  };
  // Jira writes times like 2026-11-03T09:00:00.000+0100.
  const jiraTime = (ms) => {
    const d = new Date(ms);
    return `${D.localDate(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000${offset(ms)}`;
  };
  const doc = (text) => (text ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } : null);
  const shapeLog = (w) => ({
    id: w.id, issueId: w.issueId, author: w.author, updateAuthor: w.author,
    started: w.started, timeSpentSeconds: w.seconds, timeSpent: Math.round(w.seconds / 60) + 'm',
    comment: w.comment || undefined, created: w.created, updated: w.created,
  });

  function addLog(key, date, minutes, text, author = me, hour = 9) {
    const iss = findIssue(key);
    const ms = D.localMidnightMs(date) + hour * 3600000;
    const w = { id: String(state.seq++), issueId: iss.id, author: { accountId: author.accountId, displayName: author.displayName }, started: jiraTime(ms), seconds: minutes * 60, comment: doc(text), created: jiraTime(Date.now() - 3600000) };
    state.worklogs.push(w);
    return w;
  }

  // Seed: last week fully logged, this week up to yesterday, and someone else's time.
  const monday = D.mondayOf(today);
  const last = D.addDays(monday, -7);
  [['APP-1207', 240], ['APP-1215', 120], ['APP-1000', 120]].forEach(([k, m], i) => {
    for (let d = 0; d < 5; d++) addLog(k, D.addDays(last, d), m, i === 0 ? 'Flow and copy' : '');
  });
  for (let d = 0; D.addDays(monday, d) < today; d++) {
    addLog('APP-1207', D.addDays(monday, d), 180, 'Sign-up screens');
    addLog('APP-1000', D.addDays(monday, d), 60, 'Standup and planning');
  }
  addLog('APP-1207', today, 90, 'Not mine', someoneElse);

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  const errors = (res, status, ...msgs) => json(res, status, { errorMessages: msgs, errors: {} });

  function readBody(req) {
    return new Promise((resolve) => {
      let s = '';
      req.on('data', (c) => { s += c; });
      req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (_) { resolve(null); } });
    });
  }

  function authorized(req, viaGateway) {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Basic ')) return false;
    const [user, pass] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (user !== email) return false;
    return viaGateway ? pass === scopedToken : pass === token;
  }

  const logDate = (w) => D.localDate(Date.parse(w.started));
  const mine = (w) => w.author.accountId === me.accountId;

  function runJql(jql) {
    let m;
    if ((m = /worklogAuthor = currentUser\(\) AND worklogDate >= "([\d-]+)" AND worklogDate <= "([\d-]+)"/.exec(jql))) {
      const [, from, to] = m;
      const ids = new Set(state.worklogs.filter((w) => mine(w) && logDate(w) >= from && logDate(w) <= to).map((w) => w.issueId));
      return issues.filter((i) => ids.has(i.id));
    }
    if (/assignee = currentUser\(\) AND resolution = Unresolved/.test(jql)) return issues.filter((i) => !i.resolved);
    if ((m = /text ~ "([^"]*)"/.exec(jql))) {
      const words = m[1].toLowerCase().split(/\s+/).filter(Boolean);
      return issues.filter((i) => words.every((w) => i.summary.toLowerCase().includes(w)));
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = u.pathname;
    const q = u.searchParams;
    if (p === '/_edge/tenant_info') return json(res, 200, { cloudId: CLOUD_ID });
    const gw = '/ex/jira/' + CLOUD_ID;
    const viaGateway = p.startsWith(gw + '/');
    if (viaGateway) p = p.slice(gw.length);
    state.calls.push({ method: req.method, path: p, gateway: viaGateway });
    if (!p.startsWith('/rest/api/3/')) return errors(res, 404, 'Not found');
    if (!authorized(req, viaGateway)) return errors(res, 401, 'Client must be authenticated to access this resource.');

    if (req.method === 'GET' && p === '/rest/api/3/myself') return json(res, 200, me);

    if (req.method === 'POST' && p === '/rest/api/3/search/jql') {
      const b = await readBody(req);
      if (!b || !b.jql) return errors(res, 400, 'JQL is required.');
      const found = runJql(b.jql);
      if (!found) return errors(res, 400, `Mock can't read this JQL: ${b.jql}`);
      const start = Number(b.nextPageToken || 0);
      const max = Math.min(Number(b.maxResults) || 50, 100);
      const page = found.slice(start, start + max);
      const more = start + max < found.length;
      return json(res, 200, Object.assign({ issues: page.map(shapeIssue), isLast: !more }, more ? { nextPageToken: String(start + max) } : {}));
    }

    if (req.method === 'GET' && p === '/rest/api/3/project/search') {
      const start = Number(q.get('startAt') || 0);
      const max = Number(q.get('maxResults') || 50);
      return json(res, 200, { startAt: start, maxResults: max, total: projects.length, isLast: start + max >= projects.length, values: projects.slice(start, start + max) });
    }

    let m;
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(p)) && req.method === 'GET') {
      const iss = findIssue(decodeURIComponent(m[1]));
      if (!iss) return errors(res, 404, 'Issue does not exist or you do not have permission to see it.');
      return json(res, 200, shapeIssue(iss));
    }

    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)\/worklog(?:\/([^/]+))?$/.exec(p))) {
      const iss = findIssue(decodeURIComponent(m[1]));
      if (!iss) return errors(res, 404, 'Issue does not exist or you do not have permission to see it.');
      if (!state.timeTracking) return errors(res, 400, 'Time tracking is disabled.');
      const id = m[2] && decodeURIComponent(m[2]);

      if (req.method === 'GET' && !id) {
        const after = q.has('startedAfter') ? Number(q.get('startedAfter')) : -Infinity;
        const before = q.has('startedBefore') ? Number(q.get('startedBefore')) : Infinity;
        const all = state.worklogs.filter((w) => w.issueId === iss.id && Date.parse(w.started) >= after && Date.parse(w.started) <= before);
        const start = Number(q.get('startAt') || 0);
        const max = Math.min(Number(q.get('maxResults') || 5000), 5000);
        return json(res, 200, { startAt: start, maxResults: max, total: all.length, worklogs: all.slice(start, start + max).map(shapeLog) });
      }

      if (req.method === 'POST' && !id) {
        const b = await readBody(req);
        if (!b || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(b.started || '')) return json(res, 400, { errorMessages: [], errors: { started: 'You must specify a valid start date.' } });
        if (!(b.timeSpentSeconds >= 60)) return json(res, 400, { errorMessages: [], errors: { timeLogged: 'You must indicate the time spent working.' } });
        if (b.comment && b.comment.type !== 'doc') return errors(res, 400, 'Comment must be in Atlassian Document Format.');
        if (state.failCreates > 0) { state.failCreates--; return errors(res, 503, 'Service unavailable'); }
        const w = { id: String(state.seq++), issueId: iss.id, author: { accountId: me.accountId, displayName: me.displayName }, started: b.started, seconds: b.timeSpentSeconds, comment: b.comment || null, created: jiraTime(Date.now()) };
        state.worklogs.push(w);
        if (state.landThenFail > 0) { state.landThenFail--; return errors(res, 504, 'Gateway timeout'); }
        return json(res, 201, shapeLog(w));
      }

      const w = id && state.worklogs.find((x) => x.id === id && x.issueId === iss.id);
      if (id && !w) return errors(res, 404, 'Cannot find worklog with id: ' + id);
      if (req.method === 'PUT' && w) {
        if (!mine(w)) return errors(res, 403, "You don't have permission to edit this worklog.");
        const b = await readBody(req);
        if (!b) return errors(res, 400, 'Bad body');
        if ('timeSpentSeconds' in b) w.seconds = b.timeSpentSeconds;
        if ('comment' in b) w.comment = b.comment;
        if ('started' in b) w.started = b.started;
        return json(res, 200, shapeLog(w));
      }
      if (req.method === 'DELETE' && w) {
        state.worklogs = state.worklogs.filter((x) => x !== w);
        res.writeHead(204);
        return res.end();
      }
    }
    return errors(res, 404, 'Not found');
  });

  return {
    me, state, issues, cloudId: CLOUD_ID, email, token, scopedToken,
    logDate,
    start(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
    },
    stop() { return new Promise((resolve) => server.close(() => resolve())); },
  };
}

module.exports = { createMockJira };
