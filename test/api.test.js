'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp, normalizeUrl } = require('../lib/app');
const { createMockYouTrack } = require('./mock-youtrack');
const D = require('../lib/dates');

async function setup() {
  const mock = createMockYouTrack({ token: 'secret' });
  const ytUrl = await mock.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spent-test-'));
  const app = createApp({ port: 0, dataDir });
  const port = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: Object.assign({ 'x-spent': '1' }, body ? { 'Content-Type': 'application/json' } : {}, headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* text */ }
    return { status: res.status, body: json, text };
  };
  return { mock, ytUrl, app, base, call, dataDir, async done() { await app.stop(); await mock.stop(); } };
}

test('normalizeUrl accepts what people paste', () => {
  assert.equal(normalizeUrl('issues.example.com'), 'https://issues.example.com');
  assert.equal(normalizeUrl('https://issues.example.com/issue/ABC-1'), 'https://issues.example.com');
  assert.equal(normalizeUrl('https://example.com/youtrack/dashboard?x=1'), 'https://example.com/youtrack');
  assert.equal(normalizeUrl('http://issues.example.com/'), 'http://issues.example.com');
  assert.equal(normalizeUrl(''), '');
});

test('guards: header, host and origin', async () => {
  const t = await setup();
  try {
    let r = await t.call('GET', '/api/status', null, { 'x-spent': '' });
    assert.equal(r.status, 403);
    r = await t.call('GET', '/api/status', null, { Origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    // A rebinding page would arrive with its own Host header (fetch can't set Host, so use http).
    const status = await new Promise((resolve, reject) => {
      const u = new URL(t.base);
      require('http').get({ host: u.hostname, port: u.port, path: '/', headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 403);
    r = await t.call('GET', '/../lib/app.js');
    assert.notEqual(r.status, 200);
  } finally {
    await t.done();
  }
});

test('setup, week, edit, remove, submit, timer, suggestions', async () => {
  const t = await setup();
  try {
    let r = await t.call('GET', '/api/status');
    assert.equal(r.body.configured, false);

    r = await t.call('POST', '/api/setup', { url: t.ytUrl, token: 'wrong' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /token/);

    r = await t.call('POST', '/api/setup', { url: t.ytUrl + '/dashboard', token: 'secret' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.login, 'sample');
    assert.equal(r.body.url, t.ytUrl);

    const today = D.localDate();
    const monday = D.mondayOf(today);
    r = await t.call('GET', '/api/week?start=' + monday);
    assert.equal(r.status, 200, r.text);
    const week = r.body;
    assert.equal(week.dates.length, 7);
    const seeded = t.mock.state.items.filter((w) => week.dates.includes(D.dateFromWorkItemMs(w.date))).length;
    assert.equal(week.entries.length, seeded);
    assert.ok(week.projects.APP.types.includes('Review'));
    assert.equal(week.pending, 0);

    // New draft, with a type given as a prefix.
    r = await t.call('POST', '/api/entries', { issue: 'app-1221', dates: [today], minutes: 90, type: 'rev', text: 'QA notes' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.type, 'Review');
    assert.equal(r.body.issue.idReadable, 'APP-1221');

    r = await t.call('POST', '/api/entries', { issue: 'APP-1221', dates: [today], minutes: 30, type: 'Design' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no “Design” work type/);

    r = await t.call('POST', '/api/entries', { issue: 'NOPE-1', dates: [today], minutes: 30 });
    assert.equal(r.status, 404);

    // Edit and remove two synced items.
    r = await t.call('GET', '/api/week?start=' + monday);
    const synced = r.body.entries.filter((e) => e.status === 'synced');
    assert.ok(synced.length >= 2, 'needs two synced items in the seeded week');
    const [a, b] = synced;
    r = await t.call('PATCH', '/api/entries/' + encodeURIComponent(a.key), { minutes: a.minutes + 15, base: a });
    assert.equal(r.status, 200, r.text);
    r = await t.call('POST', '/api/entries/' + encodeURIComponent(b.key) + '/remove', { snapshot: b });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.pending, 3);

    // Editing back to the original value drops the edit.
    r = await t.call('PATCH', '/api/entries/' + encodeURIComponent(a.key), { minutes: a.minutes, base: a });
    assert.equal(r.body.pending, 2);
    r = await t.call('PATCH', '/api/entries/' + encodeURIComponent(a.key), { minutes: a.minutes + 15, text: 'More', base: a });
    assert.equal(r.body.pending, 3);

    r = await t.call('GET', '/api/pending');
    assert.equal(r.body.items.length, 3);
    assert.deepEqual(r.body.items.map((i) => i.change).sort(), ['edit', 'new', 'remove']);

    // Submit everything; the first create fails once with a 503 and is retried.
    t.mock.state.failCreates = 1;
    const before = t.mock.state.items.length;
    for (const it of r.body.items) {
      const s = await t.call('POST', '/api/submit/' + encodeURIComponent(it.key));
      assert.equal(s.body.ok, true, JSON.stringify(s.body));
    }
    assert.equal(t.mock.state.items.length, before); // +1 created, -1 removed
    const editedNow = t.mock.state.items.find((w) => w.id === a.ytId);
    assert.equal(editedNow.minutes, a.minutes + 15);
    assert.equal(editedNow.text, 'More');
    assert.ok(!t.mock.state.items.find((w) => w.id === b.ytId));
    const created = t.mock.state.items[t.mock.state.items.length - 1];
    assert.equal(created.minutes, 90);
    assert.equal(created.typeId, '65-5');
    assert.equal(D.dateFromWorkItemMs(created.date), today);
    assert.equal(created.date, D.utcMidnightMs(today));

    r = await t.call('GET', '/api/week?start=' + monday);
    assert.equal(r.body.pending, 0);
    assert.ok(r.body.entries.every((e) => e.status === 'synced'));

    // A create that lands but times out must not be written twice.
    await t.call('POST', '/api/entries', { issue: 'APP-1230', dates: [today], minutes: 45 });
    t.mock.state.landThenFail = 1;
    const n0 = t.mock.state.items.length;
    r = await t.call('GET', '/api/pending');
    const s2 = await t.call('POST', '/api/submit/' + encodeURIComponent(r.body.items[0].key));
    assert.equal(s2.body.ok, true, JSON.stringify(s2.body));
    assert.equal(s2.body.retried, true);
    assert.equal(t.mock.state.items.length, n0 + 1);

    // A non-transient error stays on the draft.
    await t.call('POST', '/api/entries', { issue: 'APP-1230', dates: [today], minutes: 20, type: null });
    r = await t.call('GET', '/api/pending');
    const key = r.body.items[0].key;
    t.mock.projects['0-1'].types = t.mock.projects['0-1'].types.filter((x) => x[1] !== 'Testing');
    await t.call('PATCH', '/api/entries/' + encodeURIComponent(key), { type: 'Testing' }).then((x) => assert.equal(x.status, 200));
    await t.call('POST', '/api/refresh');
    const s3 = await t.call('POST', '/api/submit/' + encodeURIComponent(key));
    assert.equal(s3.body.ok, false);
    assert.match(s3.body.error, /no “Testing” work type/);
    r = await t.call('GET', '/api/pending');
    assert.match(r.body.items[0].error, /Testing/);
    await t.call('POST', '/api/entries/' + encodeURIComponent(key) + '/remove', {});

    // An edit to an item deleted in YouTrack meanwhile is dropped, not stuck.
    r = await t.call('GET', '/api/week?start=' + monday + '&fresh=1');
    // Pick one that the suggestions check below doesn't rely on.
    const victim = r.body.entries.find((e) => e.status === 'synced' && e.issue !== 'APP-1207');
    await t.call('PATCH', '/api/entries/' + encodeURIComponent(victim.key), { minutes: victim.minutes + 5, base: victim });
    t.mock.state.items = t.mock.state.items.filter((w) => w.id !== victim.ytId);
    const sd = await t.call('POST', '/api/submit/' + encodeURIComponent(victim.key));
    assert.equal(sd.body.ok, true);
    assert.equal(sd.body.dropped, true);
    r = await t.call('GET', '/api/pending');
    assert.ok(!r.body.items.some((i) => i.key === victim.key));

    // Timer
    r = await t.call('POST', '/api/timer/start', { issue: 'APP-1215' });
    assert.equal(r.body.timer.issue, 'APP-1215');
    r = await t.call('POST', '/api/timer/start', { issue: 'APP-1221' });
    assert.equal(r.body.stopped.length, 1);
    assert.equal(r.body.stopped[0].minutes, 5); // a short run counts as one rounding step
    r = await t.call('POST', '/api/timer/stop', { endAt: Date.now() + 47 * 60000 });
    assert.equal(r.body.stopped[0].minutes, 45);
    r = await t.call('POST', '/api/timer/start', { issue: 'APP-1215' });
    r = await t.call('POST', '/api/timer/stop', { discard: true });
    assert.equal(r.body.stopped.length, 0);

    // Suggestions: activity on issues with no time that day.
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.errors, []);
    const qa = r.body.suggestions.find((x) => x.issue === 'APP-1221');
    const actDay = today === monday ? today : D.addDays(today, -1);
    if (qa) {
      assert.equal(qa.date, actDay);
      assert.equal(qa.minutes, 150);
      assert.match(qa.title, /2 comments/);
    }
    const studio = r.body.suggestions.find((x) => x.issue === 'DS-41');
    assert.ok(studio, JSON.stringify(r.body.suggestions));
    assert.match(studio.title, /moved to In Progress/);
    assert.ok(!r.body.suggestions.find((x) => x.issue === 'APP-1207' && x.date === actDay));
    r = await t.call('POST', '/api/suggestions/dismiss', { id: studio.id });
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.ok(!r.body.suggestions.find((x) => x.id === studio.id));

    // Rows: add one, then copy last week's (skips the resolved APP-1188).
    r = await t.call('POST', '/api/rows', { monday, action: 'add', issue: 'APP-1230' });
    assert.ok(r.body.rows.includes('APP-1230'));
    r = await t.call('POST', '/api/rows', { monday, action: 'copy-previous' });
    assert.ok(r.body.skipped.includes('APP-1188'));

    // Settings: a new default type also fills type-less drafts.
    await t.call('POST', '/api/entries', { issue: 'APP-1221', dates: [today], minutes: 25, type: null });
    r = await t.call('PUT', '/api/settings', { dailyTargetMinutes: 450, typeDefaults: { APP: 'Research' }, workDays: [5, 1, 2, 3, 4] });
    assert.equal(r.body.dailyTargetMinutes, 450);
    assert.deepEqual(r.body.workDays, [1, 2, 3, 4, 5]);
    r = await t.call('GET', '/api/pending');
    assert.ok(r.body.items.filter((i) => i.issue.startsWith('APP')).every((i) => i.type), JSON.stringify(r.body.items));
    r = await t.call('POST', '/api/entries', { issue: 'APP-1215', dates: [today], minutes: 30 });
    assert.equal(r.body.type, 'Research');
    r = await t.call('PUT', '/api/settings', { timerRounding: 7 });
    assert.equal(r.status, 400);

    // State survives a restart.
    const state = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'state.json'), 'utf8'));
    assert.equal(state.settings.dailyTargetMinutes, 450);
    const cfg = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'config.json'), 'utf8'));
    assert.equal(cfg.token, 'secret');
  } finally {
    await t.done();
  }
});

test('a rejected token surfaces as 401', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/setup', { url: t.ytUrl, token: 'secret' });
    const cfgPath = path.join(t.dataDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.token = 'expired';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    // A fresh app reads the changed file.
    await t.app.stop();
    const app2 = createApp({ port: 0, dataDir: t.dataDir });
    const port = await app2.start();
    const res = await fetch(`http://127.0.0.1:${port}/api/week`, { headers: { 'x-spent': '1' } });
    assert.equal(res.status, 401);
    const st = await (await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { 'x-spent': '1' } })).json();
    assert.equal(st.ytStatus, 401);
    await app2.stop();
    await t.mock.stop();
  } catch (e) {
    await t.mock.stop().catch(() => {});
    throw e;
  }
});
