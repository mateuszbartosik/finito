'use strict';

const { localDate, pad } = require('./dates');

// Turns what I did into suggested time: one suggestion per issue per day, for issue-days
// that have no time yet. The evidence is my activity in the tracker, my pull request reviews
// on GitHub (both moments in time) and my meetings (blocks of time). Issues and activities
// come in the shapes from lib/tracker.js.

const LABELS = {
  comment: ['comment', 'comments'],
  attachment: ['attachment', 'attachments'],
  field: ['field change', 'field changes'],
  description: ['description edit', 'description edits'],
  title: ['title edit', 'title edits'],
  link: ['link change', 'link changes'],
  tag: ['tag change', 'tag changes'],
  commit: ['commit', 'commits'],
  'pull-request': ['pull request update', 'pull request updates'],
};
const ONE_OFF = { created: 'created it', resolved: 'resolved it' };

// Work types to try, in order, when time comes mostly from meetings or from reviews.
const MEETING_TYPES = ['Meeting', 'Meetings', 'Communication', 'Communications'];
const REVIEW_TYPES = ['Review', 'Code review', 'Code Review', 'Reviews'];

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
const MIN = 60000;

function clock(ms) {
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// First to last activity, rounded up to 15 minutes, between 15 minutes and 4 hours.
function estimateMinutes(first, last, count) {
  if (count <= 1) return MIN_MINUTES;
  const span = Math.round((last - first) / MIN);
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil(span / 15) * 15));
}

function unionMs(spans) {
  const s = spans.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

// Each group of moments (my tracker activity, or one pull request's review) becomes a
// span from its first to its last moment, estimated as above; meetings count as scheduled;
// where spans overlap, the time counts once. Rounded up to 15 minutes.
function estimate(timeGroups, blocks) {
  const spans = [];
  const ranges = [];
  for (const times of timeGroups) {
    if (!times.length) continue;
    const first = Math.min(...times);
    const last = Math.max(...times);
    spans.push([first, first + estimateMinutes(first, last, times.length) * MIN]);
    ranges.push([first, times.length > 1 ? clock(first) + '–' + clock(last) : clock(first)]);
  }
  const activity = Math.round(unionMs(spans) / MIN);
  for (const b of blocks) {
    spans.push([b.start, b.end]);
    ranges.push([b.start, clock(b.start) + '–' + clock(b.end)]);
  }
  const meetings = Math.round(unionMs(blocks.map((b) => [b.start, b.end])) / MIN);
  const minutes = Math.max(MIN_MINUTES, Math.ceil(Math.round(unionMs(spans) / MIN) / 15) * 15);
  ranges.sort((a, b) => a[0] - b[0]);
  return { minutes, activity, meetings, when: ranges.map((r) => r[1]).join(', ') };
}

const shortPr = (ref) => {
  const m = /^[^/]+\/([^#]+)#(\d+)$/.exec(ref.label || '');
  return m ? `${m[1]}#${m[2]}` : ref.label;
};

// A review that only wraps one comment (quiet) counts as that comment. On my own pull request
// everything I write is a comment: replies to its reviewers.
function reviewText(list) {
  const pr = shortPr(list[0].ref);
  const counted = list.filter((p) => !(p.kind === 'review' && p.quiet));
  const plural = (n, one, many) => (n === 1 ? one : n + ' ' + many);
  if (list[0].ref && list[0].ref.own) return plural(counted.length || 1, 'a comment', 'comments') + ' on your pull request ' + pr;
  const r = counted.filter((p) => p.kind === 'review').length;
  const c = counted.length - r;
  const parts = [];
  if (r) parts.push(plural(r, 'a review', 'reviews'));
  if (c) parts.push(plural(c, 'a comment', 'comments'));
  return (parts.length ? parts.join(' and ') : 'a review') + ' on ' + pr;
}

// activities: Activity items from the tracker. points: [{ issue, at, kind, ref: { label, url, title } }]
// from reviews. blocks: [{ issue, start, end, title }] from meetings.
function buildSuggestions(activities, { dates, existing = new Set(), dismissed = {}, points = [], blocks = [] }) {
  const groups = new Map();
  const seen = new Set();
  const group = (issue, date) => {
    const key = issue.key + '|' + date;
    let g = groups.get(key);
    if (!g) {
      g = { key, issue: issue.key, summary: issue.title || '', project: issue.project ? issue.project.key : '', date, times: [], yt: [], counts: {}, states: [], reviews: [], blocks: [] };
      groups.set(key, g);
    }
    if (!g.summary && issue.title) g.summary = issue.title;
    return g;
  };
  for (const a of activities || []) {
    if (!a || !a.at || !a.issue) continue;
    if (a.id) {
      if (seen.has(a.id)) continue; // the same activity can come back from two requests
      seen.add(a.id);
    }
    const date = localDate(a.at);
    if (!dates.includes(date)) continue;
    const g = group(a.issue, date);
    g.times.push(a.at);
    g.yt.push(a.at);
    const kind = a.kind || 'other';
    g.counts[kind] = (g.counts[kind] || 0) + 1;
    if (a.state) g.states.push(a.state);
  }
  for (const p of points) {
    const date = localDate(p.at);
    if (!p.issue || !dates.includes(date)) continue;
    const g = group(p.issue, date);
    g.times.push(p.at);
    g.reviews.push(p);
  }
  for (const b of blocks) {
    const date = localDate(b.start);
    if (!b.issue || !dates.includes(date)) continue;
    group(b.issue, date).blocks.push(b);
  }

  const out = [];
  for (const g of groups.values()) {
    if (existing.has(g.key) || dismissed[g.key]) continue;
    const byPr = new Map();
    for (const r of g.reviews) {
      const k = r.ref ? r.ref.label : '';
      if (!byPr.has(k)) byPr.set(k, []);
      byPr.get(k).push(r);
    }
    const est = estimate([g.yt, ...[...byPr.values()].map((list) => list.map((r) => r.at))], g.blocks);
    const parts = [];
    if (g.states.length) parts.push('moved to ' + g.states[g.states.length - 1]);
    for (const [kind, k] of Object.entries(g.counts)) {
      if (ONE_OFF[kind]) { parts.push(ONE_OFF[kind]); continue; }
      if (kind === 'field' && g.states.length) {
        const rest = k - g.states.length;
        if (rest > 0) parts.push(rest + ' other ' + (rest === 1 ? 'field change' : 'field changes'));
        continue;
      }
      const label = LABELS[kind] || ['change', 'changes'];
      parts.push(k + ' ' + (k === 1 ? label[0] : label[1]));
    }
    for (const list of byPr.values()) parts.push(reviewText(list));
    if (g.blocks.length === 1) parts.push('meeting: ' + (g.blocks[0].title || 'untitled'));
    else if (g.blocks.length > 1) parts.push(g.blocks.length + ' meetings');

    const ytCount = g.times.length - g.reviews.length;
    // Replies on my own pull request are work on the issue, not reviewing.
    const reviewing = g.reviews.filter((r) => !(r.ref && r.ref.own)).length;
    let typeHint = null;
    if (g.blocks.length && est.meetings >= est.activity) typeHint = MEETING_TYPES;
    else if (reviewing && reviewing >= ytCount) typeHint = REVIEW_TYPES;

    const why = [];
    if (g.times.length > 1) why.push('activity counts from first to last (each pull request on its own), rounded up to 15 min, at most 4h');
    else if (g.times.length === 1) why.push('a single touch counts as 15 min');
    if (g.blocks.length) why.push('meetings count as scheduled');
    if (g.times.length && g.blocks.length) why.push('overlaps count once');

    const refs = [];
    for (const list of byPr.values()) if (list[0].ref) refs.push({ kind: 'review', label: list[0].ref.label, url: list[0].ref.url, title: list[0].ref.title || '' });
    for (const b of g.blocks) refs.push({ kind: 'meeting', label: b.title || 'Meeting', when: clock(b.start) + '–' + clock(b.end) });

    out.push({
      id: g.key,
      issue: g.issue,
      summary: g.summary,
      project: g.project,
      date: g.date,
      minutes: est.minutes,
      estimate: g.times.length > 0,
      title: parts.join(', '),
      when: est.when,
      why: (g.times.length ? 'Estimate: ' : '') + why.join('; ') + '.',
      typeHint,
      sources: { activity: ytCount, reviews: g.reviews.length, meetings: g.blocks.length },
      refs,
    });
  }
  out.sort((a, b) => (a.date === b.date ? b.minutes - a.minutes : a.date < b.date ? -1 : 1));
  return out;
}

module.exports = { buildSuggestions, estimateMinutes, estimate, clock, MEETING_TYPES, REVIEW_TYPES };
