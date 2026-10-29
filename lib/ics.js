'use strict';

// A small reader for iCalendar files (RFC 5545): enough to list someone's meetings in a
// week from a calendar's secret iCal address (Google Calendar, Outlook, iCloud, Fastmail).
//
// Covers folded lines, escaped text, time zones (IANA names, common Windows names, or the
// file's own standard offset), all-day events, DURATION, RRULE (DAILY, WEEKLY, MONTHLY and
// YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS), RDATE, EXDATE,
// and occurrences that were moved or cancelled (RECURRENCE-ID).

const DAY_MS = 86400000;
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Windows time zone names Outlook writes as TZID, mapped to IANA names.
const WINDOWS_ZONES = {
  'Central European Standard Time': 'Europe/Warsaw',
  'Central Europe Standard Time': 'Europe/Budapest',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

// ---------- lines and components ----------

function unfold(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

// NAME;PARAM=VALUE;PARAM="quoted:value":the value
function parseLine(line) {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const parts = [];
  let cur = '';
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].trim().toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(s) {
  return String(s || '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

// A tree of components: { type, props: [{ name, params, value }], children }.
function parseComponents(text) {
  const root = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const raw of unfold(text).split('\n')) {
    const line = raw.trim() ? raw : '';
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') {
      const c = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(p);
    }
  }
  return root;
}

const prop = (c, name) => c.props.find((p) => p.name === name) || null;
const propsOf = (c, name) => c.props.filter((p) => p.name === name);

// ---------- time zones ----------

const zoneCache = new Map();
function isIana(tz) {
  if (zoneCache.has(tz)) return zoneCache.get(tz);
  let ok = false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); ok = true; } catch (_) { ok = false; }
  zoneCache.set(tz, ok);
  return ok;
}

// "+0200" -> 120
function offsetMinutes(v) {
  const m = /^([+-])(\d{2})(\d{2})/.exec(String(v || '').trim());
  if (!m) return null;
  const n = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -n : n;
}

// The file's own zones, by TZID, as a fixed standard offset. A last resort: it ignores
// daylight saving, so it's only used for names no other way understands.
function fileZones(root) {
  const out = {};
  const walk = (c) => {
    if (c.type === 'VTIMEZONE') {
      const id = prop(c, 'TZID');
      const std = c.children.find((x) => x.type === 'STANDARD') || c.children[0];
      const off = std ? offsetMinutes((prop(std, 'TZOFFSETTO') || {}).value) : null;
      if (id && off !== null) out[id.value.trim()] = { offset: off };
    }
    c.children.forEach(walk);
  };
  walk(root);
  return out;
}

// A zone is 'UTC', an IANA name, { offset } in minutes, or null for "floating" (this computer's zone).
function resolveZone(tzid, ctx) {
  if (!tzid) return ctx.floating;
  const t = String(tzid).trim();
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(t)) return 'UTC';
  if (isIana(t)) return t;
  const tail = /([A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/.exec(t); // "/mozilla.org/…/Europe/Berlin"
  if (tail && isIana(tail[1])) return tail[1];
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  if (ctx.fileZones[t]) return ctx.fileZones[t];
  return ctx.floating;
}

const fmtCache = new Map();
function zoneOffsetMs(ms, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in a zone -> epoch ms.
function wallToMs(w, zone) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh || 0, w.mi || 0, w.ss || 0);
  if (zone === 'UTC') return guess;
  if (zone && typeof zone === 'object') return guess - zone.offset * 60000;
  if (!zone) return new Date(w.y, w.m - 1, w.d, w.hh || 0, w.mi || 0, w.ss || 0).getTime();
  const first = guess - zoneOffsetMs(guess, zone);
  return guess - zoneOffsetMs(first, zone);
}

// ---------- values ----------

// "20261028T100000Z", "20261028T100000" or "20261028"
function parseStamp(value, params, ctx) {
  const v = String(value || '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const w = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: Number(m[4] || 0), mi: Number(m[5] || 0), ss: Number(m[6] || 0) };
  const allDay = !m[4] || (params && params.VALUE === 'DATE');
  if (allDay) return { allDay: true, w, zone: ctx.floating, ms: wallToMs(w, ctx.floating) };
  const zone = m[7] ? 'UTC' : resolveZone(params && params.TZID, ctx);
  return { allDay: false, w, zone, ms: wallToMs(w, zone) };
}

// "PT30M", "P1D", "-PT15M"
function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = ((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function stampList(p, ctx) {
  return String(p.value || '').split(',').map((v) => parseStamp(v, p.params, ctx)).filter(Boolean);
}

// ---------- civil dates ----------

const civil = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const civilMs = (c) => Date.UTC(c.y, c.m - 1, c.d);
const addCivilDays = (c, n) => civil(c.y, c.m, c.d + n);
const weekdayOf = (c) => new Date(civilMs(c)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const sameCivil = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
const civilKey = (c) => c.y * 10000 + c.m * 100 + c.d;

function parseRule(v) {
  const r = {};
  for (const part of String(v || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) r[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  const list = (s, f) => (s ? s.split(',').map(f).filter((x) => x !== null && !Number.isNaN(x)) : null);
  return {
    freq: (r.FREQ || '').toUpperCase(),
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL || null,
    byday: list(r.BYDAY, (s) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim());
      return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAYS[m[2].toUpperCase()] } : null;
    }),
    bymonthday: list(r.BYMONTHDAY, (s) => parseInt(s, 10)),
    bymonth: list(r.BYMONTH, (s) => parseInt(s, 10)),
    bysetpos: list(r.BYSETPOS, (s) => parseInt(s, 10)),
    wkst: WEEKDAYS[(r.WKST || 'MO').toUpperCase()] ?? 1,
  };
}

// The days of one month that a MONTHLY or YEARLY rule picks, in order.
function monthDays(y, m, rule, start) {
  const dim = daysInMonth(y, m);
  let days = [];
  if (rule.byday && rule.byday.length) {
    for (const b of rule.byday) {
      const all = [];
      for (let d = 1; d <= dim; d++) if (weekdayOf({ y, m, d }) === b.wd) all.push(d);
      if (!b.n) days.push(...all);
      else {
        const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n];
        if (pick) days.push(pick);
      }
    }
    if (rule.bymonthday && rule.bymonthday.length) {
      const md = rule.bymonthday.map((x) => (x < 0 ? dim + 1 + x : x));
      days = days.filter((d) => md.includes(d));
    }
  } else if (rule.bymonthday && rule.bymonthday.length) {
    for (const x of rule.bymonthday) {
      const d = x < 0 ? dim + 1 + x : x;
      if (d >= 1 && d <= dim) days.push(d);
    }
  } else if (start.d <= dim) {
    days.push(start.d);
  }
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bysetpos && rule.bysetpos.length) {
    days = rule.bysetpos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter(Boolean).sort((a, b) => a - b);
  }
  return days.map((d) => ({ y, m, d }));
}

// Dates a rule produces from its start day, in order, while `keep(date)` says go on.
// Bounded so a malformed rule can't spin forever.
function* ruleDates(start, rule) {
  const MAX = 200000;
  let guard = 0;
  if (rule.freq === 'DAILY') {
    for (let k = 0; guard++ < MAX; k++) {
      const c = addCivilDays(start, k * rule.interval);
      if (rule.bymonth && !rule.bymonth.includes(c.m)) { yield { skip: c }; continue; }
      if (rule.byday && rule.byday.length && !rule.byday.some((b) => b.wd === weekdayOf(c))) { yield { skip: c }; continue; }
      if (rule.bymonthday && rule.bymonthday.length && !rule.bymonthday.some((x) => (x < 0 ? daysInMonth(c.y, c.m) + 1 + x : x) === c.d)) { yield { skip: c }; continue; }
      yield { date: c };
    }
  } else if (rule.freq === 'WEEKLY') {
    const back = (weekdayOf(start) - rule.wkst + 7) % 7;
    const weekStart = addCivilDays(start, -back);
    const wds = (rule.byday && rule.byday.length ? rule.byday.map((b) => b.wd) : [weekdayOf(start)])
      .map((wd) => (wd - rule.wkst + 7) % 7)
      .sort((a, b) => a - b);
    for (let k = 0; guard++ < MAX; k++) {
      const ws = addCivilDays(weekStart, k * 7 * rule.interval);
      for (const off of [...new Set(wds)]) {
        const c = addCivilDays(ws, off);
        if (civilKey(c) < civilKey(start)) continue;
        if (rule.bymonth && !rule.bymonth.includes(c.m)) { yield { skip: c }; continue; }
        yield { date: c };
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let k = 0; guard++ < MAX; k++) {
      const first = civil(start.y, start.m + k * rule.interval, 1);
      if (rule.bymonth && !rule.bymonth.includes(first.m)) { yield { skip: first }; continue; }
      const days = monthDays(first.y, first.m, rule, start);
      if (!days.length) yield { skip: first };
      for (const c of days) if (civilKey(c) >= civilKey(start)) yield { date: c };
    }
  } else if (rule.freq === 'YEARLY') {
    for (let k = 0; guard++ < MAX; k++) {
      const y = start.y + k * rule.interval;
      const months = rule.bymonth && rule.bymonth.length ? [...rule.bymonth].sort((a, b) => a - b) : [start.m];
      let any = false;
      for (const m of months) {
        const days = (rule.byday && rule.byday.length) || (rule.bymonthday && rule.bymonthday.length)
          ? monthDays(y, m, rule, start)
          : (start.d <= daysInMonth(y, m) ? [{ y, m, d: start.d }] : []);
        for (const c of days) if (civilKey(c) >= civilKey(start)) { any = true; yield { date: c }; }
      }
      if (!any) yield { skip: { y, m: 12, d: 31 } };
    }
  }
}

// ---------- events ----------

function attendeeOf(p) {
  const email = String(p.value || '').replace(/^mailto:/i, '').trim().toLowerCase();
  return { email, name: p.params.CN || '', status: (p.params.PARTSTAT || 'NEEDS-ACTION').toUpperCase(), role: (p.params.ROLE || '').toUpperCase() };
}

function readEvent(c, ctx) {
  const dtstart = prop(c, 'DTSTART');
  if (!dtstart) return null;
  const start = parseStamp(dtstart.value, dtstart.params, ctx);
  if (!start) return null;
  let length;
  const dtend = prop(c, 'DTEND');
  const dur = prop(c, 'DURATION');
  if (dtend) {
    const end = parseStamp(dtend.value, dtend.params, ctx);
    length = end ? end.ms - start.ms : 0;
  } else if (dur) {
    length = parseDuration(dur.value) || 0;
  } else {
    length = start.allDay ? DAY_MS : 0;
  }
  const rid = prop(c, 'RECURRENCE-ID');
  const text = (name) => { const p = prop(c, name); return p ? unescapeText(p.value).trim() : ''; };
  const busy = text('X-MICROSOFT-CDO-BUSYSTATUS').toUpperCase();
  const organizer = prop(c, 'ORGANIZER');
  return {
    uid: text('UID'),
    title: text('SUMMARY'),
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
    status: text('STATUS').toUpperCase(),
    transparent: text('TRANSP').toUpperCase() === 'TRANSPARENT' || busy === 'FREE',
    start,
    length: Math.max(0, length),
    allDay: start.allDay,
    rule: prop(c, 'RRULE') ? parseRule(prop(c, 'RRULE').value) : null,
    exdates: propsOf(c, 'EXDATE').flatMap((p) => stampList(p, ctx)),
    rdates: propsOf(c, 'RDATE').filter((p) => (p.params.VALUE || '').toUpperCase() !== 'PERIOD').flatMap((p) => stampList(p, ctx)),
    recurrenceId: rid ? parseStamp(rid.value, rid.params, ctx) : null,
    attendees: propsOf(c, 'ATTENDEE').map(attendeeOf),
    organizer: organizer ? String(organizer.value || '').replace(/^mailto:/i, '').trim().toLowerCase() : '',
  };
}

function occurrence(ev, startMs, extra = {}) {
  return {
    uid: ev.uid,
    title: ev.title,
    description: ev.description,
    location: ev.location,
    status: ev.status,
    transparent: ev.transparent,
    allDay: ev.allDay,
    start: startMs,
    end: startMs + ev.length,
    attendees: ev.attendees,
    organizer: ev.organizer,
    recurring: !!extra.recurring,
  };
}

// A recurring event's occurrences that overlap [fromMs, toMs), as { ms, day } (day: the civil date in the event's zone).
function expand(ev, fromMs, toMs) {
  const out = [];
  const s = ev.start;
  const startDay = { y: s.w.y, m: s.w.m, d: s.w.d };
  const r = ev.rule;
  let untilMs = null;
  let untilDay = null;
  if (r.until) {
    const u = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(r.until);
    if (u && !u[4]) untilDay = { y: Number(u[1]), m: Number(u[2]), d: Number(u[3]) };
    else if (u) untilMs = wallToMs({ y: Number(u[1]), m: Number(u[2]), d: Number(u[3]), hh: Number(u[4]), mi: Number(u[5]), ss: Number(u[6] || 0) }, u[7] ? 'UTC' : s.zone);
  }
  const after = new Date(toMs + 2 * DAY_MS);
  const lastDay = { y: after.getUTCFullYear(), m: after.getUTCMonth() + 1, d: after.getUTCDate() };
  let n = 0;
  for (const step of ruleDates(startDay, r)) {
    const c = step.date || step.skip;
    if (civilKey(c) > civilKey(lastDay)) break;
    if (untilDay && civilKey(c) > civilKey(untilDay)) break;
    if (!step.date) continue;
    // Exact time zone math is slow, so it's done only near the window (or near UNTIL);
    // a daily meeting that started years ago is mostly counted, not converted.
    const approx = Date.UTC(c.y, c.m - 1, c.d, s.w.hh, s.w.mi, s.w.ss);
    if (untilMs !== null && approx > untilMs + 2 * DAY_MS) break;
    const near = approx > fromMs - 2 * DAY_MS - ev.length && approx < toMs + 2 * DAY_MS;
    const nearUntil = untilMs !== null && Math.abs(approx - untilMs) < 2 * DAY_MS;
    const ms = near || nearUntil
      ? (s.allDay ? wallToMs(c, s.zone) : wallToMs({ y: c.y, m: c.m, d: c.d, hh: s.w.hh, mi: s.w.mi, ss: s.w.ss }, s.zone))
      : null;
    if (ms !== null && untilMs !== null && ms > untilMs) break;
    n++;
    if (r.count !== null && n > r.count) break;
    if (ms !== null && ms + ev.length > fromMs && ms < toMs) out.push({ ms, day: c });
  }
  return out;
}

// Every occurrence that overlaps [fromMs, toMs), cancelled ones included (check `status`).
function eventsBetween(text, fromMs, toMs) {
  const root = parseComponents(text);
  const cal = root.children.find((c) => c.type === 'VCALENDAR') || root;
  const calName = prop(cal, 'X-WR-CALNAME');
  const calZone = prop(cal, 'X-WR-TIMEZONE');
  const ctx = { fileZones: fileZones(root), floating: null };
  if (calZone && isIana(calZone.value.trim())) ctx.floating = calZone.value.trim();

  const masters = [];
  const overrides = new Map(); // uid -> [event]
  for (const c of cal.children) {
    if (c.type !== 'VEVENT') continue;
    const ev = readEvent(c, ctx);
    if (!ev) continue;
    if (ev.recurrenceId) {
      if (!overrides.has(ev.uid)) overrides.set(ev.uid, []);
      overrides.get(ev.uid).push(ev);
    } else {
      masters.push(ev);
    }
  }

  const out = [];
  const overlaps = (start, length) => start + length > fromMs && start < toMs;
  for (const ev of masters) {
    const moved = new Set((overrides.get(ev.uid) || []).map((o) => o.recurrenceId.ms));
    if (!ev.rule && !ev.rdates.length) {
      if (overlaps(ev.start.ms, ev.length)) out.push(occurrence(ev, ev.start.ms));
      continue;
    }
    const starts = new Map(); // ms -> civil day
    if (ev.rule) for (const o of expand(ev, fromMs, toMs)) starts.set(o.ms, o.day);
    else if (overlaps(ev.start.ms, ev.length)) starts.set(ev.start.ms, ev.start.w);
    for (const r of ev.rdates) if (overlaps(r.ms, ev.length)) starts.set(r.ms, r.w);
    const exMs = new Set(ev.exdates.filter((x) => !x.allDay).map((x) => x.ms));
    const exDays = ev.exdates.filter((x) => x.allDay).map((x) => x.w);
    for (const [ms, day] of [...starts].sort((a, b) => a[0] - b[0])) {
      if (exMs.has(ms) || moved.has(ms)) continue;
      if (exDays.some((x) => sameCivil(x, day))) continue;
      out.push(occurrence(ev, ms, { recurring: true }));
    }
  }
  // Moved or cancelled occurrences stand on their own.
  for (const list of overrides.values()) {
    for (const o of list) if (overlaps(o.start.ms, o.length)) out.push(occurrence(o, o.start.ms, { recurring: true }));
  }
  out.sort((a, b) => a.start - b.start);
  return { name: calName ? unescapeText(calName.value).trim() : '', events: out };
}

function looksLikeCalendar(text) {
  return /BEGIN:VCALENDAR/i.test(String(text || '').slice(0, 4096));
}

module.exports = { eventsBetween, looksLikeCalendar, parseDuration, parseRule, wallToMs, unfold, parseLine, unescapeText };
