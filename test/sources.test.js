'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app');
const { createMockYouTrack } = require('./mock-youtrack');
const { createMockSources } = require('./mock-sources');
const D = require('../lib/dates');

// Last week, so every sample meeting and review is in the past whatever day the tests run.
const monday = D.addDays(D.mondayOf(D.localDate()), -7);
const day = (k) => D.addDays(monday, k);

async function setup(sources = {}) {
  const yt = createMockYouTrack({ token: 'secret' });
  const ytUrl = await yt.start();
  const src = createMockSources(Object.assign({ monday, email: yt.me.email }, sources));
  const urls = await src.start();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finito-src-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ youtrackUrl: ytUrl, token: 'secret' }));
  const app = createApp({ port: 0, dataDir, githubApi: urls.githubApi });
  const port = await app.start();
  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: Object.assign({ 'x-finito': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { yt, src, urls, call, dataDir, async done() { await app.stop(); await src.stop(); await yt.stop(); } };
}

test('calendar and GitHub: connect, suggest, sort, ignore, undo', async () => {
  const t = await setup();
  try {
    // Connecting checks the address and the token first.
    let r = await t.call('POST', '/api/sources/calendar', { url: 'not a url' });
    assert.equal(r.status, 400);
    r = await t.call('POST', '/api/sources/calendar', { url: t.urls.base + '/nope.ics' });
    assert.equal(r.status, 400);
    r = await t.call('POST', '/api/sources/calendar', { url: t.urls.calendarUrl });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.calendar.connected, true);
    assert.equal(r.body.calendar.name, 'sample@example.com');
    r = await t.call('POST', '/api/sources/github', { token: 'wrong' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /turned the token down/);
    r = await t.call('POST', '/api/sources/github', { token: 'gh-token' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.github.login, 'sample-user');
    const cfg = JSON.parse(fs.readFileSync(path.join(t.dataDir, 'config.json'), 'utf8'));
    assert.equal(cfg.githubToken, 'gh-token');
    r = await t.call('GET', '/api/sources');
    assert.equal(JSON.stringify(r.body).includes('gh-token'), false, 'the token never goes back to the browser');
    assert.equal(JSON.stringify(r.body).includes('calendar.ics'), false, 'nor does the secret calendar address');

    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.errors, []);
    const sugg = (issue, date) => r.body.suggestions.find((s) => s.issue === issue && s.date === date);
    // A meeting that names an issue: as scheduled, typed as a meeting.
    const qa = sugg('APP-1221', day(1));
    assert.ok(qa, JSON.stringify(r.body.suggestions));
    assert.equal(qa.minutes, 30);
    assert.equal(qa.estimate, false);
    assert.equal(qa.title, 'meeting: Design review APP-1221');
    assert.equal(qa.typeHint[0], 'Meeting');
    // A review of a pull request that names an issue: comments at 10:05 and 10:20, the review at 10:40.
    const ds = sugg('DS-41', day(2));
    assert.ok(ds, JSON.stringify(r.body.suggestions));
    assert.equal(ds.minutes, 45);
    assert.equal(ds.title, 'a review and 2 comments on web#42');
    assert.equal(ds.when, '10:05–10:40');
    assert.equal(ds.refs[0].url, 'https://github.example.com/acme/web/pull/42');
    assert.equal(ds.typeHint[0], 'Review');
    // The rest needs an issue: the standup, the 1:1 and a pull request with no issue in it.
    const rows = Object.fromEntries(r.body.unsorted.map((u) => [u.key, u]));
    assert.deepEqual(Object.keys(rows).sort(), ['meeting:1:1 with sam', 'meeting:daily standup', 'pr:acme/api#7']);
    assert.deepEqual(Object.keys(rows['meeting:daily standup'].cells).sort(), [0, 1, 2, 3, 4].map(day));
    assert.equal(rows['meeting:daily standup'].cells[day(0)].minutes, 15);
    assert.deepEqual(Object.keys(rows['meeting:1:1 with sam'].cells), [day(2)]);
    assert.equal(rows['pr:acme/api#7'].cells[day(3)].minutes, 15);
    assert.equal(rows['pr:acme/api#7'].sub, 'acme/api#7');
    // Lunch alone, a declined call, a "free" all-hands and an all-day event are not meetings.
    const all = JSON.stringify(r.body);
    for (const name of ['Lunch', 'Vendor call', 'all-hands', 'Conference']) assert.equal(all.includes(name), false, name);

    // Log the standup to an issue from now on.
    r = await t.call('POST', '/api/suggestions/map', { key: 'meeting:daily standup', issue: 'app-1230', label: 'Daily standup' });
    assert.equal(r.status, 200);
    assert.equal(r.body.mapping.issue, 'APP-1230');
    r = await t.call('POST', '/api/suggestions/map', { key: 'meeting:1:1 with sam', ignore: true, label: '1:1 with Sam' });
    assert.equal(r.status, 200);
    r = await t.call('POST', '/api/suggestions/dismiss', { id: 'pr:acme/api#7|' + day(3) });
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.deepEqual(r.body.unsorted.map((u) => u.key), []);
    const standups = r.body.suggestions.filter((s) => s.issue === 'APP-1230');
    assert.equal(standups.length, 5);
    assert.equal(standups[0].title, 'meeting: Daily standup');
    r = await t.call('GET', '/api/sources');
    assert.deepEqual(r.body.mappings.map((m) => [m.label, m.issue, m.ignore]).sort(), [['1:1 with Sam', null, true], ['Daily standup', 'APP-1230', false]]);

    // Undo puts the row back.
    await t.call('POST', '/api/suggestions/unmap', { key: 'meeting:1:1 with sam' });
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.deepEqual(r.body.unsorted.map((u) => u.key), ['meeting:1:1 with sam']);

    // Accepting a meeting suggestion types it as a meeting where the project has such a type.
    r = await t.call('POST', '/api/entries', { issue: 'APP-1221', dates: [day(1)], minutes: 30, typeHint: qa.typeHint });
    assert.equal(r.body.type, 'Communication');
    r = await t.call('POST', '/api/entries', { issue: 'DS-41', dates: [day(2)], minutes: 45, typeHint: ds.typeHint });
    assert.equal(r.body.type, null, 'DS has no Review type and no default, so no type');

    // Removing a source stops its suggestions.
    await t.call('POST', '/api/sources/calendar/remove');
    await t.call('POST', '/api/sources/github/remove');
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.equal(r.body.suggestions.some((s) => s.sources && (s.sources.meetings || s.sources.reviews)), false);
    assert.deepEqual(r.body.unsorted, []);
  } finally {
    await t.done();
  }
});

test('a broken source is reported, not fatal', async () => {
  const t = await setup();
  try {
    await t.call('POST', '/api/sources/calendar', { url: t.urls.calendarUrl });
    await t.call('POST', '/api/sources/github', { token: 'gh-token' });
    await t.src.stop();
    await t.call('POST', '/api/refresh');
    const r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.equal(r.status, 200);
    assert.equal(r.body.errors.length, 2, JSON.stringify(r.body.errors));
    assert.match(r.body.errors[0], /^Calendar: /);
    assert.match(r.body.errors[1], /^GitHub: /);
  } finally {
    t.src.stop = async () => {};
    await t.done();
  }
});

test("an organization's rules for tokens are explained when connecting and under the week", async () => {
  const rules = {};
  const t = await setup({ refuse: rules });
  try {
    let r = await t.call('POST', '/api/sources/github', { token: 'gh-token' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.warning, null);
    // Later acme starts refusing tokens that last more than a year, the way some organizations do.
    rules.acme = { message: "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days. Please adjust your token's lifetime at the following URL: https://github.com/settings/personal-access-tokens/123" };
    const why = 'The acme organization accepts only tokens that expire within 366 days. Regenerate the token with an expiry date at https://github.com/settings/personal-access-tokens/123, then connect the new one in Settings.';
    await t.call('POST', '/api/refresh');
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.errors, ['GitHub: ' + why], 'one line for the organization, not one per pull request');
    assert.equal(r.body.suggestions.some((s) => s.sources && s.sources.reviews), false);
    // Connecting such a token again stops with the reason.
    r = await t.call('POST', '/api/sources/github', { token: 'gh-token' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, why);
  } finally {
    await t.done();
  }
});

test('a repository that refuses the token is skipped and the rest still counts', async () => {
  const t = await setup({ refuse: { 'acme/api': { message: 'Resource not accessible by personal access token' } } });
  try {
    const why = "The token can't read acme/api. In GitHub, give it that repository and read access to pull requests, then reload.";
    let r = await t.call('POST', '/api/sources/github', { token: 'gh-token' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.warning, why);
    r = await t.call('GET', '/api/suggestions?start=' + monday);
    assert.deepEqual(r.body.errors, ['GitHub: ' + why]);
    assert.ok(r.body.suggestions.find((s) => s.issue === 'DS-41' && s.date === day(2)), 'the review in acme/web still counts');
    assert.equal(r.body.unsorted.some((u) => u.key === 'pr:acme/api#7'), false);
  } finally {
    await t.done();
  }
});
