'use strict';

// The YouTrack adapter turns YouTrack's records into Finito's own shapes (lib/tracker.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { YouTrack } = require('../lib/youtrack');

const yt = new YouTrack({ url: 'https://yt.example.com/', token: 't' });
const raw = (id, summary) => ({ id: '2-' + id.length, idReadable: id, summary, project: { id: '0-1', shortName: id.split('-')[0], name: 'Product' } });

test('issues come out with a key, a title and a link', () => {
  assert.deepEqual(yt.toIssue(raw('APP-1', 'One')), {
    key: 'APP-1', dbId: '2-5', title: 'One', resolved: false,
    project: { key: 'APP', name: 'Product', dbId: '0-1' },
    url: 'https://yt.example.com/issue/APP-1',
  });
  assert.equal(yt.toIssue({ idReadable: 'APP-2', summary: 'Two' }).project, null, 'plain requests have no project');
  assert.equal(yt.toIssue({ id: 'x' }), null);
});

test('a work item keeps its day whether YouTrack stored UTC or local midnight', () => {
  const item = (date) => yt.toItem({ id: '115-1', date, duration: { minutes: 90 }, text: null, type: { id: '65-5', name: 'Review' }, author: { id: '1-1', login: 'me' }, issue: raw('APP-1', 'One') });
  assert.equal(item(Date.UTC(2026, 9, 29)).date, '2026-10-29');
  assert.equal(item(Date.UTC(2026, 9, 28, 23)).date, '2026-10-29', 'local midnight east of UTC');
  const w = item(Date.UTC(2026, 9, 29));
  assert.equal(w.minutes, 90);
  assert.equal(w.note, '');
  assert.deepEqual(w.type, { id: '65-5', name: 'Review' });
  assert.equal(w.issue.key, 'APP-1');
});

test('activities point at their issue, with a plain kind and the new state', () => {
  const comment = yt.toActivity({ id: '1', timestamp: 5, category: { id: 'CommentsCategory' }, target: { id: 'c1', issue: raw('A-1', 'One') } });
  assert.equal(comment.issue.key, 'A-1');
  assert.equal(comment.kind, 'comment');
  assert.equal(comment.state, null);
  const moved = yt.toActivity({ id: '3', timestamp: 5, category: { id: 'CustomFieldCategory' }, field: { name: 'State' }, added: [{ name: 'In Progress' }], target: raw('A-1', 'One') });
  assert.equal(moved.kind, 'field');
  assert.equal(moved.state, 'In Progress');
  const priority = yt.toActivity({ id: '4', timestamp: 5, category: { id: 'CustomFieldCategory' }, field: { name: 'Priority' }, added: [{ name: 'Major' }], target: raw('A-1', 'One') });
  assert.equal(priority.state, null);
  assert.equal(yt.toActivity({ id: '5', timestamp: 5, category: { id: 'IssueCreatedCategory' }, target: raw('C-3', 'Three') }).kind, 'created');
  assert.equal(yt.toActivity({ id: '6', timestamp: 5, category: { id: 'SomethingNew' }, target: raw('C-3', 'Three') }).kind, 'other');
  assert.equal(yt.toActivity({ id: '7', timestamp: 5, category: { id: 'CommentsCategory' }, target: { id: 'c9' } }), null, 'no issue, no activity');
});
