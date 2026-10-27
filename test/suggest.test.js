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
