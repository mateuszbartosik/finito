'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ICS = require('../lib/ics');

// The week of Monday 26 October 2026 in Warsaw. Daylight saving ended on Sunday the 25th,
// so Warsaw is UTC+1 this week and was UTC+2 the week before.
const WEEK_FROM = Date.UTC(2026, 9, 25, 23, 0); // Mon 26 Oct, 00:00 in Warsaw
const WEEK_TO = WEEK_FROM + 7 * 86400000;
const z = (iso) => Date.parse(iso);

const cal = (events) => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'X-WR-CALNAME:sample@example.com',
  'X-WR-TIMEZONE:Europe/Warsaw',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Warsaw',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']),
  'END:VCALENDAR',
].join('\r\n');

const standup = [
  'DTSTART;TZID=Europe/Warsaw:20261005T093000',
  'DTEND;TZID=Europe/Warsaw:20261005T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'EXDATE;TZID=Europe/Warsaw:20261028T093000',
  'UID:standup@google.com',
  'SUMMARY:Daily standup',
  'ATTENDEE;CN=Sample User;PARTSTAT=ACCEPTED:mailto:sample@example.com',
  'ATTENDEE;CN=Sam;PARTSTAT=ACCEPTED:mailto:sam@example.com',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H10M0S',
  'END:VALARM',
];
const movedStandup = [
  'DTSTART;TZID=Europe/Warsaw:20261029T110000',
  'DTEND;TZID=Europe/Warsaw:20261029T111500',
  'RECURRENCE-ID;TZID=Europe/Warsaw:20261029T093000',
  'UID:standup@google.com',
  'SUMMARY:Daily standup (moved)',
];

test('a weekly meeting: daylight saving, a skipped day, a moved day, alarms ignored', () => {
  const { name, events } = ICS.eventsBetween(cal([standup, movedStandup]), WEEK_FROM, WEEK_TO);
  assert.equal(name, 'sample@example.com');
  assert.deepEqual(events.map((e) => [new Date(e.start).toISOString(), e.title]), [
    ['2026-10-26T08:30:00.000Z', 'Daily standup'],
    ['2026-10-27T08:30:00.000Z', 'Daily standup'],
    ['2026-10-29T10:00:00.000Z', 'Daily standup (moved)'],
    ['2026-10-30T08:30:00.000Z', 'Daily standup'],
  ]);
  assert.equal(events[0].end - events[0].start, 15 * 60000);
  assert.equal(events[0].description, '', "the alarm's description stays with the alarm");
  assert.deepEqual(events[0].attendees.map((a) => [a.email, a.status]), [['sample@example.com', 'ACCEPTED'], ['sam@example.com', 'ACCEPTED']]);
  // The week before, Warsaw was UTC+2.
  const before = ICS.eventsBetween(cal([standup]), WEEK_FROM - 7 * 86400000, WEEK_FROM).events;
  assert.equal(new Date(before[3].start).toISOString(), '2026-10-22T07:30:00.000Z');
});

test('a cancelled occurrence stays visible as cancelled', () => {
  const cancelled = ['DTSTART;TZID=Europe/Warsaw:20261027T093000', 'DTEND;TZID=Europe/Warsaw:20261027T094500',
    'RECURRENCE-ID;TZID=Europe/Warsaw:20261027T093000', 'UID:standup@google.com', 'STATUS:CANCELLED', 'SUMMARY:Daily standup'];
  const { events } = ICS.eventsBetween(cal([standup, cancelled]), WEEK_FROM, WEEK_TO);
  const tue = events.filter((e) => new Date(e.start).toISOString().startsWith('2026-10-27'));
  assert.equal(tue.length, 1);
  assert.equal(tue[0].status, 'CANCELLED');
});

test('all-day, declined, free and single events', () => {
  const { events } = ICS.eventsBetween(cal([
    ['DTSTART;VALUE=DATE:20261027', 'DTEND;VALUE=DATE:20261028', 'UID:a', 'SUMMARY:Holiday'],
    ['DTSTART:20261027T130000Z', 'DTEND:20261027T140000Z', 'UID:b', 'SUMMARY:Vendor call',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:sample@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:vendor@example.org'],
    ['DTSTART:20261028T120000Z', 'DURATION:PT45M', 'UID:c', 'SUMMARY:Focus time', 'TRANSP:TRANSPARENT'],
  ]), WEEK_FROM, WEEK_TO);
  const byTitle = Object.fromEntries(events.map((e) => [e.title, e]));
  assert.equal(byTitle.Holiday.allDay, true);
  assert.equal(byTitle['Vendor call'].attendees[0].status, 'DECLINED');
  assert.equal(byTitle['Focus time'].transparent, true);
  assert.equal(byTitle['Focus time'].end - byTitle['Focus time'].start, 45 * 60000);
});

test('monthly on the last Friday, daily with COUNT, weekly with UNTIL, every other week', () => {
  const { events } = ICS.eventsBetween(cal([
    ['DTSTART:20260130T150000Z', 'DTEND:20260130T160000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'UID:m', 'SUMMARY:Monthly demo'],
    ['DTSTART:20261026T120000Z', 'DTEND:20261026T123000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'UID:d', 'SUMMARY:Onboarding'],
    ['DTSTART:20261005T140000Z', 'DTEND:20261005T143000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20261027T235959Z;BYDAY=MO,TH', 'UID:w', 'SUMMARY:Sync'],
    ['DTSTART;TZID=Europe/Warsaw:20261019T100000', 'DTEND;TZID=Europe/Warsaw:20261019T103000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'UID:o', 'SUMMARY:1:1'],
  ]), WEEK_FROM, WEEK_TO);
  const days = (t) => events.filter((e) => e.title === t).map((e) => new Date(e.start).toISOString().slice(0, 10));
  assert.deepEqual(days('Monthly demo'), ['2026-10-30']);
  assert.deepEqual(days('Onboarding'), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(days('Sync'), ['2026-10-26']);
  assert.deepEqual(days('1:1'), []);
  const next = ICS.eventsBetween(cal([['DTSTART;TZID=Europe/Warsaw:20261019T100000', 'DTEND;TZID=Europe/Warsaw:20261019T103000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'UID:o', 'SUMMARY:1:1']]), WEEK_TO, WEEK_TO + 7 * 86400000).events;
  assert.equal(new Date(next[0].start).toISOString(), '2026-11-02T09:00:00.000Z');
});

test("Outlook's Windows zone names, folded lines and escaped text", () => {
  const text = cal([[
    'DTSTART;TZID="Central European Standard Time":20261027T140000',
    'DTEND;TZID="Central European Standard Time":20261027T150000',
    'UID:o1',
    'SUMMARY:Design review\\, APP-1221',
    'DESCRIPTION:Agenda:\\n1. The empty st',
    ' ate\\; 2. Icons',
    'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
  ]]);
  const [e] = ICS.eventsBetween(text, WEEK_FROM, WEEK_TO).events;
  assert.equal(e.title, 'Design review, APP-1221');
  assert.equal(e.description, 'Agenda:\n1. The empty state; 2. Icons');
  assert.equal(new Date(e.start).toISOString(), '2026-10-27T13:00:00.000Z');
  assert.equal(e.transparent, false);
});

test('reads durations and recognizes calendars', () => {
  assert.equal(ICS.parseDuration('PT1H30M'), 90 * 60000);
  assert.equal(ICS.parseDuration('P1D'), 86400000);
  assert.equal(ICS.parseDuration('nope'), null);
  assert.equal(ICS.looksLikeCalendar('BEGIN:VCALENDAR\r\nVERSION:2.0'), true);
  assert.equal(ICS.looksLikeCalendar('<html>'), false);
});
