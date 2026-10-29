'use strict';

// A small in-memory stand-in for YouTrack's REST API: just the endpoints Finito calls.
// Used by the tests and by `npm run demo`.

const http = require('http');
const D = require('../lib/dates');

function createMockYouTrack({ token = 'test-token', today = D.localDate() } = {}) {
  const me = { id: '1-1', login: 'sample', fullName: 'Sample User', email: 'sample@example.com' };
  const projects = {
    '0-1': {
      id: '0-1', shortName: 'APP', name: 'Product',
      types: [['65-0', 'Development'], ['65-1', 'Testing'], ['65-2', 'Documentation'], ['65-3', 'Communication'], ['65-4', 'Research'], ['65-5', 'Review'], ['65-6', 'Investigation'], ['65-7', 'Support']],
    },
    '0-2': {
      id: '0-2', shortName: 'DS', name: 'Design System',
      types: [['65-0', 'Development'], ['65-1', 'Testing'], ['65-6', 'Investigation'], ['65-7', 'Support']],
    },
  };
  const issues = [
    ['2-1', 'APP-1207', 'Onboarding: email-first sign-up flow', '0-1', false],
    ['2-2', 'APP-1215', 'Billing: empty state for invoices', '0-1', false],
    ['2-3', 'APP-1221', 'Design QA for the 3.2 release', '0-1', false],
    ['2-4', 'APP-1230', 'Icons: move to the 24 px grid', '0-1', false],
    ['2-5', 'APP-1188', 'Support form: remove the legacy fields', '0-1', true],
    ['2-6', 'DS-41', 'Buttons: focus ring polish', '0-2', false],
    ['2-7', 'APP-1000', 'Meetings and design rituals', '0-1', false],
  ].map(([id, idReadable, summary, projectId, resolved]) => ({ id, idReadable, summary, projectId, resolved: resolved ? Date.now() - 86400000 : null }));

  const state = { items: [], seq: 100, failCreates: 0, landThenFail: 0, calls: [], activities: [] };

  const findIssue = (ref) => issues.find((i) => i.id === ref || i.idReadable.toLowerCase() === String(ref).toLowerCase());
  const shapeProject = (pid) => { const p = projects[pid]; return { id: p.id, shortName: p.shortName, name: p.name }; };
  const shapeIssue = (i) => ({ id: i.id, idReadable: i.idReadable, summary: i.summary, resolved: i.resolved, project: shapeProject(i.projectId) });
  const typeName = (pid, tid) => { const t = projects[pid].types.find((x) => x[0] === tid); return t ? t[1] : null; };
  const presentation = (m) => { const h = Math.floor(m / 60); const r = m % 60; return (h ? h + 'h' : '') + (h && r ? ' ' : '') + (r ? r + 'm' : '') || '0m'; };
  const shapeItem = (w) => {
    const iss = findIssue(w.issueId);
    return {
      id: w.id,
      date: w.date,
      created: w.created,
      duration: { minutes: w.minutes, presentation: presentation(w.minutes) },
      text: w.text || null,
      type: w.typeId ? { id: w.typeId, name: typeName(iss.projectId, w.typeId) } : null,
      author: { id: me.id, login: me.login },
      issue: shapeIssue(iss),
    };
  };

  function addItem(issueRid, date, minutes, type, text) {
    const iss = findIssue(issueRid);
    const t = projects[iss.projectId].types.find((x) => x[1] === type);
    const w = { id: '115-' + state.seq++, issueId: iss.id, date: D.utcMidnightMs(date), minutes, typeId: t ? t[0] : null, text, created: Date.now() - 3600 * 1000 };
    state.items.push(w);
    return w;
  }

  // Seed: last week fully logged, this week logged up to yesterday with short days.
  const monday = D.mondayOf(today);
  const prev = D.addDays(monday, -7);
  for (let i = 0; i < 5; i++) {
    const d = D.addDays(prev, i);
    addItem('APP-1207', d, 240, 'Research', 'Flow work');
    addItem('APP-1188', d, 180, 'Development', 'Legacy cleanup');
    addItem('APP-1000', d, 60, 'Communication', 'Standup and planning');
  }
  for (let i = 0; i < 5; i++) {
    const d = D.addDays(monday, i);
    if (d >= today) break;
    addItem('APP-1207', d, 240, 'Research', 'Prototype');
    addItem('APP-1000', d, 30, 'Communication', 'Standup');
    if (i % 2 === 0) addItem('APP-1215', d, 120, 'Development', 'Empty state');
  }
  if (today === monday) addItem('APP-1207', today, 60, 'Research', 'Kickoff');

  const actDay = today === monday ? today : D.addDays(today, -1);
  const at = (date, h, m) => D.localMidnightMs(date) + (h * 60 + m) * 60000;
  state.activities.push(
    { id: 'a1', timestamp: at(actDay, 11, 40), category: 'CommentsCategory', issue: 'APP-1221' },
    { id: 'a2', timestamp: at(actDay, 12, 55), category: 'AttachmentsCategory', issue: 'APP-1221' },
    { id: 'a3', timestamp: at(actDay, 14, 10), category: 'CommentsCategory', issue: 'APP-1221' },
    { id: 'a4', timestamp: at(actDay, 15, 30), category: 'CustomFieldCategory', issue: 'DS-41', field: 'State', added: 'In Progress' },
    { id: 'a5', timestamp: at(actDay, 16, 5), category: 'CommentsCategory', issue: 'DS-41' },
    { id: 'a6', timestamp: at(actDay, 10, 0), category: 'CommentsCategory', issue: 'APP-1207' }, // already has time
  );

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  const notFound = (res, what) => json(res, 404, { error: 'Not Found', error_description: `Entity with id ${what} not found` });

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const t = Buffer.concat(chunks).toString('utf8');
        try { resolve(t ? JSON.parse(t) : {}); } catch (_) { resolve({}); }
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    const q = url.searchParams;
    state.calls.push({ method: req.method, path: p, query: Object.fromEntries(q) });
    if (req.headers.authorization !== 'Bearer ' + token) return json(res, 401, { error: 'Unauthorized', error_description: 'You are not logged in.' });
    let m;

    if (req.method === 'GET' && p === '/api/users/me') return json(res, 200, me);

    if (req.method === 'GET' && p === '/api/workItems') {
      const s = q.get('startDate');
      const e = q.get('endDate');
      let list = state.items.filter((w) => {
        const d = D.dateFromWorkItemMs(w.date);
        return (!s || d >= s) && (!e || d <= e);
      });
      const skip = Number(q.get('$skip') || 0);
      const top = Number(q.get('$top') || 42);
      list = list.slice(skip, skip + top);
      return json(res, 200, list.map(shapeItem));
    }

    if (req.method === 'GET' && p === '/api/issues') {
      const query = (q.get('query') || '').toLowerCase();
      let list = issues;
      if (query.startsWith('for: me')) list = issues.filter((i) => !i.resolved);
      else {
        const words = query.split(/\s+/).filter(Boolean);
        list = issues.filter((i) => words.every((w) => (i.summary + ' ' + i.idReadable).toLowerCase().includes(w)));
      }
      return json(res, 200, list.slice(0, Number(q.get('$top') || 42)).map(shapeIssue));
    }

    if ((m = p.match(/^\/api\/issues\/([^/]+)$/)) && req.method === 'GET') {
      const iss = findIssue(decodeURIComponent(m[1]));
      return iss ? json(res, 200, shapeIssue(iss)) : notFound(res, m[1]);
    }

    if ((m = p.match(/^\/api\/issues\/([^/]+)\/timeTracking\/workItems$/))) {
      const iss = findIssue(decodeURIComponent(m[1]));
      if (!iss) return notFound(res, m[1]);
      if (req.method === 'GET') return json(res, 200, state.items.filter((w) => w.issueId === iss.id).map(shapeItem));
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (state.failCreates > 0) { state.failCreates--; return json(res, 503, { error: 'Service Unavailable' }); }
        if (!b.duration || !(b.duration.minutes > 0)) return json(res, 400, { error: 'bad_request', error_description: 'Duration is required' });
        if (b.type && !projects[iss.projectId].types.some((t) => t[0] === b.type.id)) return json(res, 400, { error: 'bad_request', error_description: 'Unknown work item type' });
        const date = D.utcMidnightMs(D.dateFromWorkItemMs(b.date || Date.now()));
        const w = { id: '115-' + state.seq++, issueId: iss.id, date, minutes: b.duration.minutes, typeId: b.type ? b.type.id : null, text: b.text || '', created: Date.now() };
        state.items.push(w);
        if (state.landThenFail > 0) { state.landThenFail--; return json(res, 504, { error: 'Gateway Timeout' }); }
        return json(res, 200, shapeItem(w));
      }
    }

    if ((m = p.match(/^\/api\/issues\/([^/]+)\/timeTracking\/workItems\/([^/]+)$/))) {
      const iss = findIssue(decodeURIComponent(m[1]));
      const w = state.items.find((x) => x.id === decodeURIComponent(m[2]));
      if (!iss || !w || w.issueId !== iss.id) return notFound(res, m[2]);
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (b.duration) w.minutes = b.duration.minutes;
        if ('text' in b) w.text = b.text || '';
        if ('type' in b) {
          if (b.type && !projects[iss.projectId].types.some((t) => t[0] === b.type.id)) return json(res, 400, { error: 'bad_request', error_description: 'Unknown work item type' });
          w.typeId = b.type ? b.type.id : null;
        }
        return json(res, 200, shapeItem(w));
      }
      if (req.method === 'DELETE') {
        state.items = state.items.filter((x) => x !== w);
        return json(res, 200);
      }
    }

    if (req.method === 'GET' && p === '/api/admin/projects') {
      return json(res, 200, Object.values(projects).map((pr) => ({ id: pr.id, shortName: pr.shortName, name: pr.name })));
    }

    if ((m = p.match(/^\/api\/admin\/projects\/([^/]+)\/timeTrackingSettings$/)) && req.method === 'GET') {
      const pr = projects[decodeURIComponent(m[1])];
      if (!pr) return notFound(res, m[1]);
      return json(res, 200, { enabled: true, workItemTypes: pr.types.map(([id, name]) => ({ id, name })) });
    }

    if (req.method === 'GET' && p === '/api/admin/timeTrackingSettings/workItemTypes') {
      const all = new Map();
      for (const pr of Object.values(projects)) for (const [id, name] of pr.types) all.set(id, { id, name });
      return json(res, 200, [...all.values()]);
    }

    if (req.method === 'GET' && p === '/api/activities') {
      const cats = (q.get('categories') || '').split(',').filter(Boolean);
      if (!cats.length) return json(res, 400, { error: 'bad_request', error_description: 'categories is required' });
      const start = Number(q.get('start') || 0);
      const end = Number(q.get('end') || Number.MAX_SAFE_INTEGER);
      const out = state.activities
        .filter((a) => cats.includes(a.category) && a.timestamp >= start && a.timestamp <= end)
        .map((a) => {
          const iss = shapeIssue(findIssue(a.issue));
          const item = { id: a.id, timestamp: a.timestamp, category: { id: a.category } };
          if (a.category === 'CommentsCategory') item.target = { id: 'c-' + a.id, issue: iss };
          else item.target = iss;
          if (a.field) { item.field = { name: a.field, presentation: a.field }; item.added = [{ name: a.added }]; }
          return item;
        });
      return json(res, 200, out);
    }

    return json(res, 404, { error: 'Not Found', error_description: 'No such endpoint in the mock: ' + req.method + ' ' + p });
  });

  return {
    state,
    issues,
    projects,
    me,
    token,
    start(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createMockYouTrack };
