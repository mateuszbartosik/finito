'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSuggestions, estimateMinutes } = require('../lib/suggest');
const D = require('../lib/dates');

const day = '2026-10-29';
const at = (h, m) => D.localMidnightMs(day) + (h * 60 + m) * 60000;
const issue = (id, summary) => ({ idReadable: id, summary, project: { shortName: id.split('-')[0] } });

test('estimate', () => {
  assert.equal(estimateMinutes(0, 0, 1), 15);
  assert.equal(estimateMinutes(at(11, 40), at(14, 10), 3), 150);
  assert.equal(estimateMinutes(at(9, 0), at(9, 5), 2), 15);
  assert.equal(estimateMinutes(at(8, 0), at(18, 0), 9), 240);
});

test('groups by issue and day, skips logged and dismissed', () => {
  const acts = [
    { id: '1', timestamp: at(11, 40), category: { id: 'CommentsCategory' }, target: { id: 'c1', issue: issue('A-1', 'One') } },
    { id: '2', timestamp: at(14, 10), category: { id: 'CommentsCategory' }, target: { id: 'c2', issue: issue('A-1', 'One') } },
    { id: '2', timestamp: at(14, 10), category: { id: 'CommentsCategory' }, target: { id: 'c2', issue: issue('A-1', 'One') } }, // duplicate
    { id: '3', timestamp: at(12, 0), category: { id: 'CustomFieldCategory' }, field: { name: 'State' }, added: [{ name: 'In Progress' }], target: issue('A-1', 'One') },
    { id: '4', timestamp: at(10, 0), category: { id: 'AttachmentsCategory' }, target: issue('B-2', 'Two') },
    { id: '5', timestamp: at(10, 0), category: { id: 'IssueCreatedCategory' }, target: issue('C-3', 'Three') },
    { id: '6', timestamp: D.localMidnightMs('2026-11-20'), category: { id: 'CommentsCategory' }, target: issue('A-1', 'One') }, // other week
  ];
  const out = buildSuggestions(acts, { dates: [day], existing: new Set(['B-2|' + day]), dismissed: { ['C-3|' + day]: 1 } });
  assert.equal(out.length, 1);
  const s = out[0];
  assert.equal(s.issue, 'A-1');
  assert.equal(s.minutes, 150);
  assert.equal(s.title, 'moved to In Progress, 2 comments');
  assert.equal(s.when, '11:40–14:10');
});

test('reviews and meetings join the same issue-day; overlaps count once', () => {
  const pr = { label: 'acme/web#42', url: 'https://github.com/acme/web/pull/42', title: 'A-1: empty state' };
  const out = buildSuggestions([
    { id: '1', timestamp: at(10, 0), category: { id: 'CommentsCategory' }, target: { id: 'c1', issue: issue('A-1', 'One') } },
  ], {
    dates: [day],
    points: [
      { issue: issue('A-1', 'One'), at: at(10, 5), kind: 'review-comment', ref: pr },
      { issue: issue('A-1', 'One'), at: at(10, 40), kind: 'review', ref: pr },
      { issue: issue('B-2', 'Two'), at: at(16, 0), kind: 'review', ref: { label: 'acme/web#43', url: 'u', title: 'B-2' } },
    ],
    blocks: [
      { issue: issue('A-1', 'One'), start: at(10, 30), end: at(11, 0), title: 'Design review' },
      { issue: issue('C-3', 'Three'), start: at(13, 0), end: at(13, 25), title: 'Planning' },
    ],
  });
  const by = Object.fromEntries(out.map((s) => [s.issue, s]));
  // 10:00–10:15 (one comment), 10:05–10:50 (the review, rounded up), 10:30–11:00 (the meeting): 60 minutes once merged.
  assert.equal(by['A-1'].minutes, 60);
  assert.equal(by['A-1'].title, '1 comment, a review and a comment on web#42, meeting: Design review');
  assert.equal(by['A-1'].when, '10:00, 10:05–10:40, 10:30–11:00');
  assert.equal(by['A-1'].typeHint[0], 'Review');
  assert.deepEqual(by['A-1'].sources, { activity: 1, reviews: 2, meetings: 1 });
  assert.equal(by['B-2'].minutes, 15);
  assert.equal(by['B-2'].title, 'a review on web#43');
  // Meetings only: as scheduled, rounded up to 15 minutes, and not an estimate.
  assert.equal(by['C-3'].minutes, 30);
  assert.equal(by['C-3'].estimate, false);
  assert.equal(by['C-3'].typeHint[0], 'Meeting');
  assert.equal(by['C-3'].when, '13:00–13:25');
});

test('separate sources on one day stay separate spans', () => {
  const pr = { label: 'acme/web#42', url: 'u', title: 'A-1' };
  const [s] = buildSuggestions([
    { id: '1', timestamp: at(15, 30), category: { id: 'CommentsCategory' }, target: { id: 'c1', issue: issue('A-1', 'One') } },
    { id: '2', timestamp: at(16, 5), category: { id: 'CommentsCategory' }, target: { id: 'c2', issue: issue('A-1', 'One') } },
  ], { dates: [day], points: [
    { issue: issue('A-1', 'One'), at: at(10, 5), kind: 'review-comment', ref: pr },
    { issue: issue('A-1', 'One'), at: at(10, 40), kind: 'review', ref: pr },
  ] });
  // 45 minutes of comments in the afternoon and 45 of review in the morning, not 10:05 to 16:05.
  assert.equal(s.minutes, 90);
  assert.equal(s.when, '10:05–10:40, 15:30–16:05');
});

test('a comment wrapped in a review of its own counts once, and replies on my own pull request are comments', () => {
  const issue = { idReadable: 'APP-1', summary: 'Something', project: { shortName: 'APP' } };
  const ref = { label: 'acme/web#50', url: 'https://github.example.com/acme/web/pull/50', title: 'APP-1: something' };
  const at = (h, m) => new Date(2026, 9, 28, h, m).getTime();
  const points = [
    { issue, at: at(10, 0), kind: 'review', quiet: true, ref },
    { issue, at: at(10, 0), kind: 'review-comment', ref },
    { issue, at: at(10, 20), kind: 'review', quiet: true, ref },
    { issue, at: at(10, 20), kind: 'review-comment', ref },
  ];
  const [theirs] = buildSuggestions([], { dates: ['2026-10-28'], points });
  assert.equal(theirs.title, '2 comments on web#50');
  assert.equal(theirs.minutes, 30);
  assert.equal(theirs.typeHint[0], 'Review');
  const mine = points.map((p) => Object.assign({}, p, { ref: Object.assign({}, ref, { own: true }) }));
  const [own] = buildSuggestions([], { dates: ['2026-10-28'], points: mine });
  assert.equal(own.title, '2 comments on your pull request web#50');
  assert.equal(own.typeHint, null);
});
