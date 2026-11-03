'use strict';

// The Jira Cloud adapter, on its own and through the app, against test/mock-jira.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JiraCloud, adf, adfText, startedAt } = require('../lib/jira');
const { createApp } = require('../lib/app');
const { createMockJira } = require('./mock-jira');
const D = require('../lib/dates');

// The gateway for scoped tokens is the mock too.
const jiraAt = (gateway) => class extends JiraCloud { static gateway = gateway; };

async function setup({ token } = {}) {
  const mock = createMockJira();
  const url = await mock.start();
  const Jira = jiraAt(url);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finito-jira-'));
  const app = createApp({ port: 0, dataDir, trackers: [Jira] });
  const port = await app.start();
  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: Object.assign({ 'x-finito': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* text */ }
    return { status: res.status, body: json, text };
  };
  const r = await call('POST', '/api/setup', { tracker: 'jira', url, email: mock.email, token: token || mock.token });
  assert.equal(r.status, 200, r.text);
  return { mock, url, app, call, dataDir, async done() { await app.stop(); await mock.stop(); } };
}

test('notes travel as Atlassian Document Format and come back as text', () => {
  const d = adf('First line\n\nThird');
  assert.equal(d.type, 'doc');
  assert.equal(d.content.length, 3);
  assert.equal(adfText(d), 'First line\n\nThird');
  assert.equal(adfText(null), '');
  assert.equal(adfText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }), 'a\nb');
});

test('a day goes in at 09:00 local time with the offset Jira expects', () => {
  const s = startedAt('2026-11-03');
  assert.match(s, /^2026-11-03T09:00:00\.000[+-]\d{4}$/);
  assert.equal(D.localDate(Date.parse(s)), '2026-11-03');
  assert.equal(new Date(Date.parse(s)).getHours(), 9);
});

test('the site address is found in whatever is pasted', () => {
  assert.equal(JiraCloud.normalizeUrl('acme'), 'https://acme.atlassian.net');
  assert.equal(JiraCloud.normalizeUrl('acme.atlassian.net'), 'https://acme.atlassian.net');
  assert.equal(JiraCloud.normalizeUrl('https://acme.atlassian.net/jira/software/projects/APP/boards/1'), 'https://acme.atlassian.net');
  assert.equal(JiraCloud.normalizeUrl('https://acme.atlassian.net/browse/APP-1'), 'https://acme.atlassian.net');
  assert.equal(JiraCloud.normalizeUrl(''), '');
});

test('classic tokens use the site, scoped tokens the gateway, wrong ones get a clear no', async () => {
  const mock = createMockJira();
  const url = await mock.start();
  const Jira = jiraAt(url);
  try {
    let r = await Jira.connect({ url, email: mock.email, token: mock.token });
    assert.equal(r.creds.apiBase, url);
    assert.equal(r.user.name, 'Sample User');
    assert.equal(r.user.login, 'acc-me');

    r = await Jira.connect({ url, email: mock.email, token: mock.scopedToken });
    assert.equal(r.creds.apiBase, `${url}/ex/jira/${mock.cloudId}`);
    assert.equal(r.base, url, 'links still point at the site');

    await assert.rejects(Jira.connect({ url, email: mock.email, token: 'nope' }), /turned the email and token down/);
    await assert.rejects(Jira.connect({ url, email: 'other@example.com', token: mock.token }), /turned the email and token down/);
    // Even when Atlassian's gateway can't be reached, a wrong token reads as a wrong token.
    await assert.rejects(jiraAt('http://127.0.0.1:1').connect({ url, email: mock.email, token: 'nope' }), /turned the email and token down/);
  } finally {
    await mock.stop();
  }
});

test('Jira through the app: the week, logging, editing, removing and retrying', async () => {
  const t = await setup();
  try {
    const today = D.localDate();
    const monday = D.mondayOf(today);
    let r = await t.call('GET', '/api/status');
    assert.equal(r.body.tracker, 'jira');
    assert.equal(r.body.user.fullName, 'Sample User');

    // The week: only my worklogs, in this week.
    r = await t.call('GET', '/api/week');
    assert.equal(r.status, 200, r.text);
    const week = r.body;
    assert.equal(week.ytError, null);
    assert.deepEqual(week.tracker, { id: 'jira', label: 'Jira', workTypes: false, activity: false, links: { issue: t.url + '/browse/{key}', timesheets: null } });
    const expected = t.mock.state.worklogs.filter((w) => w.author.accountId === 'acc-me' && week.dates.includes(t.mock.logDate(w))).length;
    assert.equal(week.entries.length, expected);
    assert.ok(week.entries.every((e) => e.status === 'synced' && e.type === null));
    if (expected) {
      const signUp = week.entries.find((e) => e.issue === 'APP-1207');
      assert.equal(signUp.minutes, 180);
      assert.equal(signUp.text, 'Sign-up screens');
    }
    for (const e of week.entries) assert.equal(week.issues[e.issue].project.shortName, e.issue.split('-')[0]);
    assert.ok(Object.values(week.projects).every((p) => p.types.length === 0));

    // Last week, for "copy last week's issues".
    r = await t.call('GET', '/api/week?start=' + D.addDays(monday, -7));
    assert.equal(r.body.entries.length, 15);

    // Finding issues: by key, by words, and mine.
    r = await t.call('GET', '/api/issues/search?q=app-1215');
    assert.deepEqual(r.body.issues.map((i) => i.idReadable), ['APP-1215']);
    r = await t.call('GET', '/api/issues/search?q=' + encodeURIComponent('focus ring'));
    assert.deepEqual(r.body.issues.map((i) => i.idReadable), ['DS-41']);
    r = await t.call('GET', '/api/issues/mine');
    assert.ok(r.body.issues.length >= 5);
    assert.ok(!r.body.issues.some((i) => i.idReadable === 'APP-1188'), 'resolved issues stay out');
    r = await t.call('GET', '/api/issue/NOPE-1');
    assert.equal(r.status, 404);
    assert.match(r.body.error, /isn't in your Jira/);

    // A meeting suggestion: the kind of work goes in the note.
    r = await t.call('POST', '/api/entries', { issue: 'APP-1221', dates: [today], minutes: 45, typeHint: ['Meeting'] });
    assert.equal(r.status, 200, r.text);
    r = await t.call('POST', '/api/entries', { issue: 'DS-41', dates: [today], minutes: 30, text: 'Focus ring\nand contrast' });
    r = await t.call('GET', '/api/pending');
    assert.equal(r.body.items.length, 2);
    for (const it of r.body.items) {
      r = await t.call('POST', '/api/submit/' + encodeURIComponent(it.key));
      assert.equal(r.body.ok, true, JSON.stringify(r.body));
    }
    const qa = t.mock.state.worklogs.find((w) => w.issueId === '10103');
    assert.equal(qa.seconds, 45 * 60);
    assert.equal(adfText(qa.comment), 'Meeting');
    assert.equal(t.mock.logDate(qa), today);
    assert.equal(new Date(Date.parse(qa.started)).getHours(), 9);
    const ds = t.mock.state.worklogs.find((w) => w.issueId === '10106');
    assert.equal(adfText(ds.comment), 'Focus ring\nand contrast');

    // Edit and remove what's in Jira.
    r = await t.call('GET', '/api/week?fresh=1');
    const mineDs = r.body.entries.find((e) => e.issue === 'DS-41');
    assert.equal(mineDs.text, 'Focus ring\nand contrast');
    r = await t.call('PATCH', '/api/entries/' + encodeURIComponent(mineDs.key), { minutes: 60, text: 'Focus ring', base: mineDs });
    assert.equal(r.status, 200, r.text);
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(mineDs.key));
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(r.body.entry.minutes, 60);
    assert.equal(ds.seconds, 3600);
    assert.equal(adfText(ds.comment), 'Focus ring');
    r = await t.call('POST', '/api/entries/' + encodeURIComponent(mineDs.key) + '/remove', { snapshot: mineDs });
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(mineDs.key));
    assert.equal(r.body.removed, true, JSON.stringify(r.body));
    assert.equal(t.mock.state.worklogs.some((w) => w.issueId === '10106'), false);

    // A create that landed but timed out isn't written twice; one that failed is retried.
    const count = () => t.mock.state.worklogs.filter((w) => w.issueId === '10104').length;
    t.mock.state.landThenFail = 1;
    await t.call('POST', '/api/entries', { issue: 'APP-1230', dates: [today], minutes: 20, text: 'grid' });
    r = await t.call('GET', '/api/pending');
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(r.body.items[0].key));
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(r.body.retried, true);
    assert.equal(count(), 1, 'no duplicate');
    t.mock.state.failCreates = 1;
    await t.call('POST', '/api/entries', { issue: 'APP-1230', dates: [today], minutes: 25, text: 'grid 2' });
    r = await t.call('GET', '/api/pending');
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(r.body.items[0].key));
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.equal(count(), 2);

    // Someone else's worklog on my issue never shows up as mine.
    r = await t.call('GET', '/api/week?fresh=1');
    assert.ok(!r.body.entries.some((e) => e.text === 'Not mine'));
  } finally {
    await t.done();
  }
});

test('with a scoped token every call goes through the gateway', async () => {
  const t = await setup({ token: 'scoped-secret' });
  try {
    t.mock.state.calls.length = 0;
    let r = await t.call('GET', '/api/week');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.entries.length, t.mock.state.worklogs.filter((w) => w.author.accountId === 'acc-me' && r.body.dates.includes(t.mock.logDate(w))).length);
    await t.call('POST', '/api/entries', { issue: 'APP-1215', dates: [D.localDate()], minutes: 15 });
    r = await t.call('GET', '/api/pending');
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(r.body.items[0].key));
    assert.equal(r.body.ok, true, JSON.stringify(r.body));
    assert.ok(t.mock.state.calls.length > 0);
    assert.ok(t.mock.state.calls.every((c) => c.gateway), JSON.stringify(t.mock.state.calls.filter((c) => !c.gateway)));
    r = await t.call('GET', '/api/week?fresh=1');
    assert.equal(r.body.tracker.links.issue, t.url + '/browse/{key}', 'links use the site, not the gateway');
  } finally {
    await t.done();
  }
});

test('Jira with time tracking turned off says so', async () => {
  const t = await setup();
  try {
    t.mock.state.timeTracking = false;
    await t.call('POST', '/api/entries', { issue: 'APP-1215', dates: [D.localDate()], minutes: 15 });
    let r = await t.call('GET', '/api/pending');
    r = await t.call('POST', '/api/submit/' + encodeURIComponent(r.body.items[0].key));
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /Time tracking is disabled/);
  } finally {
    await t.done();
  }
});
