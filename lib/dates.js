'use strict';

// Calendar dates travel as 'YYYY-MM-DD' strings. Arithmetic on them is done in UTC,
// so a date never shifts with the machine's time zone.

const pad = (n) => String(n).padStart(2, '0');

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0 = Sunday … 6 = Saturday
function weekday(date) {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

function mondayOf(date) {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// The calendar date of a moment, in this machine's time zone.
function localDate(ms = Date.now()) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function localMidnightMs(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// YouTrack stores a work item's day as midnight UTC.
function utcMidnightMs(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Reads a work item's day back. Adding 12 hours before truncating keeps the right day
// even if a server stored local midnight instead of UTC midnight.
function dateFromWorkItemMs(ms) {
  return new Date(Number(ms) + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { pad, isDate, addDays, weekday, mondayOf, weekDates, localDate, localMidnightMs, utcMidnightMs, dateFromWorkItemMs };
