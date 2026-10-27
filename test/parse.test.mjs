import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseQuick, fmt, resolveTypeName, addDays, weekdayIndex } from '../public/parse.js';

const dates = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const today = '2026-10-30';
const issues = [
  { idReadable: 'APP-1207', summary: 'Onboarding: email-first sign-up flow', preferred: true },
  { idReadable: 'APP-1215', summary: 'Billing: empty state for invoices' },
  { idReadable: 'DS-41', summary: 'Buttons: focus ring polish' },
  { idReadable: 'APP-1000', summary: 'Meetings and design rituals' },
  { idReadable: 'APP-1003', summary: 'Design review notes' },
];
const ctx = { dates, today, issues };

test('durations', () => {
  const cases = { '1.5': 90, '1,5': 90, '1h30': 90, '1h 30m': 90, '1.5h': 90, '90m': 90, '90': 90, '2': 120, '.5': 30, '1:30': 90, '45min': 45, '': 0, '0': 0 };
  for (const [input, want] of Object.entries(cases)) assert.equal(parseDuration(input), want, input);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('1h30x'), null);
});

test('fmt', () => {
  assert.equal(fmt(90), '1h 30m');
  assert.equal(fmt(120), '2h');
  assert.equal(fmt(45), '45m');
  assert.equal(fmt(0), '0m');
});

test('dates helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekdayIndex('2026-10-26'), 0);
  assert.equal(weekdayIndex('2026-11-01'), 6);
});

test('an ID, a time and a note', () => {
  const r = parseQuick('APP-1207 1h30 review copy', ctx);
  assert.equal(r.issue, 'APP-1207');
  assert.equal(r.issueKnown, true);
  assert.equal(r.minutes, 90);
  assert.deepEqual(r.dates, [today]);
  assert.equal(r.note, 'review copy');
});

test('IDs are matched without caring about case', () => {
  const r = parseQuick('ds-41 2h', ctx);
  assert.equal(r.issue, 'DS-41');
});

test('unknown IDs pass through for a lookup', () => {
  const r = parseQuick('ABC-12 2h', ctx);
  assert.equal(r.issue, 'ABC-12');
  assert.equal(r.issueKnown, false);
});

test('clock ranges, weekdays, ranges of days and types', () => {
  let r = parseQuick('9:00-10:30 APP-1215 #rev', ctx);
  assert.equal(r.minutes, 90);
  assert.equal(r.range, '9:00–10:30');
  assert.equal(r.type, 'rev');
  r = parseQuick('APP-1000 15m mon-fri standup', ctx);
  assert.deepEqual(r.dates, dates.slice(0, 5));
  assert.equal(r.note, 'standup');
  r = parseQuick('APP-1000 2h yesterday', ctx);
  assert.deepEqual(r.dates, ['2026-10-29']);
  r = parseQuick('APP-1000 2h tue', ctx);
  assert.deepEqual(r.dates, ['2026-10-27']);
  r = parseQuick('APP-1000 2h 2026-10-12', ctx);
  assert.deepEqual(r.dates, ['2026-10-12']);
});

test('words pick an issue when exactly one title matches best', () => {
  let r = parseQuick('2h billing invoices', ctx);
  assert.equal(r.issue, 'APP-1215');
  assert.equal(r.by, 'billing invoices');
  assert.equal(r.note, '');
  r = parseQuick('1h email flow polish', ctx); // flow -> APP-1207 (2 words + preferred), polish -> DS-41
  assert.equal(r.issue, 'APP-1207');
  r = parseQuick('1h design', ctx); // two titles say "design" with no preference: ask
  assert.equal(r.issue, null);
  assert.equal(r.ambiguous, true);
});

test('a day must be given outside the current week', () => {
  const r = parseQuick('APP-1207 1h', { dates, today: '2026-11-05', issues });
  assert.equal(r.dates, null);
  assert.match(r.dayError, /Which day/);
});

test('type names resolve by prefix', () => {
  const types = ['Development', 'Documentation', 'Review'];
  assert.deepEqual(resolveTypeName('rev', types), { name: 'Review' });
  assert.ok(resolveTypeName('d', types).error);
  assert.deepEqual(resolveTypeName('dev', types), { name: 'Development' });
  assert.ok(resolveTypeName('design', types).error);
  assert.deepEqual(resolveTypeName('design', null), { name: 'design', unchecked: true });
});
