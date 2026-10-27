// Parsing and formatting shared by the UI (and the tests).

export const pad = (n) => String(n).padStart(2, '0');

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday = 0 … Sunday = 6
export function weekdayIndex(date) {
  return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

export function localDateOf(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function fmt(min) {
  const v = Math.round(min);
  if (!v) return '0m';
  const h = Math.floor(v / 60);
  const m = v % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

// "1.5", "1,5", "1h30", "1h 30m", "90m", "90", "1:30" -> minutes. Empty or "0" -> 0. Unreadable -> null.
export function parseDuration(text) {
  const t = String(text == null ? '' : text).trim().toLowerCase().replace(',', '.');
  if (!t || t === '0' || t === '-') return 0;
  let m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2})\s*m?)?$/);
  if (m) return Math.round(parseFloat(m[1]) * 60) + (m[2] ? parseInt(m[2], 10) : 0);
  m = t.match(/^(\d+)\s*m(?:in)?$/);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = t.match(/^(\d*\.\d+|\d+)$/);
  if (m) {
    const v = parseFloat(m[1]);
    // Whole numbers up to 12 are hours; bigger ones are minutes ("90" = 1h 30m).
    return m[1].indexOf('.') === -1 && v > 12 ? Math.round(v) : Math.round(v * 60);
  }
  return null;
}

// Picks a work type from a project's list: exact name, else a unique prefix.
export function resolveTypeName(typed, types) {
  if (!typed) return { name: null };
  const n = String(typed).trim().toLowerCase();
  const list = types || [];
  const exact = list.find((t) => t.toLowerCase() === n);
  if (exact) return { name: exact };
  const starts = list.filter((t) => t.toLowerCase().startsWith(n));
  if (starts.length === 1) return { name: starts[0] };
  if (!list.length) return { name: typed, unchecked: true };
  return { error: starts.length ? `“${typed}” could be ${starts.join(' or ')}` : `no “${typed}” type here` };
}

const WD = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
const WD_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'some', 'more', 'about', 'after', 'before', 'work', 'worked', 'working', 'on', 'of', 'to', 'in', 'a', 'an', 'at', 'by']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One line of free text -> issue, minutes, days, type and note.
// ctx: { dates: the visible week (7 'YYYY-MM-DD', Monday first), today, issues: [{ idReadable, summary, preferred }] }
export function parseQuick(raw, { dates, today, issues = [] }) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let rest = ' ' + text.replace(/\s+/g, ' ') + ' ';
  const r = { issue: null, issueKnown: false, summary: '', by: null, ambiguous: false, minutes: null, range: null, dates: null, dayError: null, type: null, note: '' };

  let m = rest.match(/\s([A-Za-z][\w]*-\d+)(?=\s)/);
  if (m) {
    const typed = m[1];
    const known = issues.find((i) => i.idReadable.toLowerCase() === typed.toLowerCase());
    r.issue = known ? known.idReadable : typed;
    r.issueKnown = !!known;
    r.summary = known ? known.summary : '';
    rest = rest.replace(m[0], ' ');
  }

  // A clock range: 9:00-10:30
  m = rest.match(/\s(\d{1,2})[:.](\d{2})\s?[-–]\s?(\d{1,2})[:.](\d{2})(?=\s)/);
  if (m) {
    const a = Number(m[1]) * 60 + Number(m[2]);
    const b = Number(m[3]) * 60 + Number(m[4]);
    if (b > a) { r.minutes = b - a; r.range = `${m[1]}:${m[2]}–${m[3]}:${m[4]}`; }
    rest = rest.replace(m[0], ' ');
  }
  if (r.minutes === null) {
    m = rest.match(/\s(\d+(?:[.,]\d+)?)\s?h(?:\s?(\d{1,2})\s?m?)?(?=\s)/i);
    if (m) { r.minutes = Math.round(parseFloat(m[1].replace(',', '.')) * 60) + (m[2] ? Number(m[2]) : 0); rest = rest.replace(m[0], ' '); }
  }
  if (r.minutes === null) {
    m = rest.match(/\s(\d+)\s?m(?:in)?(?=\s)/i);
    if (m) { r.minutes = Number(m[1]); rest = rest.replace(m[0], ' '); }
  }
  if (r.minutes === null) {
    m = rest.match(/\s(\d{1,2}):(\d{2})(?=\s)/);
    if (m) { r.minutes = Number(m[1]) * 60 + Number(m[2]); rest = rest.replace(m[0], ' '); }
  }

  // Days: 2026-10-27, mon-fri, today, yesterday, a weekday of the visible week
  m = rest.match(/\s(\d{4}-\d{2}-\d{2})(?=\s)/);
  if (m && isDate(m[1])) { r.dates = [m[1]]; rest = rest.replace(m[0], ' '); }
  if (!r.dates) {
    m = rest.match(new RegExp(`\\s(${WD})\\s?[-–]\\s?(${WD})(?=\\s)`, 'i'));
    if (m) {
      const a = WD_INDEX[m[1].slice(0, 3).toLowerCase()];
      const b = WD_INDEX[m[2].slice(0, 3).toLowerCase()];
      if (b >= a) r.dates = dates.slice(a, b + 1);
      rest = rest.replace(m[0], ' ');
    }
  }
  if (!r.dates) {
    m = rest.match(new RegExp(`\\s(today|yesterday|${WD})(?=\\s)`, 'i'));
    if (m) {
      const w = m[1].toLowerCase();
      r.dates = [w === 'today' ? today : w === 'yesterday' ? addDays(today, -1) : dates[WD_INDEX[w.slice(0, 3)]]];
      rest = rest.replace(m[0], ' ');
    }
  }

  // A bare number last, so dates aren't eaten: ".5" "1.5" "2" are hours, "90" is minutes.
  if (r.minutes === null) {
    m = rest.match(/\s(\d*[.,]\d+|\d{1,3})(?=\s)/);
    if (m) {
      const v = parseFloat(m[1].replace(',', '.'));
      r.minutes = /[.,]/.test(m[1]) || v <= 12 ? Math.round(v * 60) : Math.round(v);
      rest = rest.replace(m[0], ' ');
    }
  }
  if (!r.dates) {
    if (dates.includes(today)) r.dates = [today];
    else r.dayError = 'Which day? Add mon…sun, today or yesterday.';
  }

  m = rest.match(/\s#([^\s#]+)(?=\s)/);
  if (m) { r.type = m[1]; rest = rest.replace(m[0], ' '); }

  // No ID: match words against issue titles. Ties are left for the person to settle.
  if (!r.issue) {
    const words = rest.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
    if (words.length) {
      let best = null;
      let bestScore = 0;
      let tie = false;
      for (const i of issues) {
        const s = (i.summary || '').toLowerCase();
        const hit = words.filter((w) => s.includes(w));
        if (!hit.length) continue;
        const score = hit.length + (i.preferred ? 0.5 : 0);
        if (score > bestScore) { best = { i, hit }; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
      }
      if (best && !tie) {
        r.issue = best.i.idReadable;
        r.issueKnown = true;
        r.summary = best.i.summary;
        r.by = best.hit.join(' ');
        for (const w of best.hit) rest = rest.replace(new RegExp('\\s' + escapeRe(w) + '(?=\\s)', 'i'), ' ');
      } else if (tie) r.ambiguous = true;
    }
  }

  r.note = rest.replace(/\s+/g, ' ').trim();
  return r;
}
