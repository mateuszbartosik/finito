'use strict';

const { localDate, pad } = require('./dates');

// Turns what I did into suggested time: one suggestion per issue per day, for issue-days
// that have no time yet. The evidence is my YouTrack activity, my pull request reviews on
// GitHub (both moments in time) and my meetings (blocks of time).

const LABELS = {
  CommentsCategory: ['comment', 'comments'],
  CommentAttachmentsCategory: ['attachment', 'attachments'],
  AttachmentsCategory: ['attachment', 'attachments'],
  CustomFieldCategory: ['field change', 'field changes'],
  DescriptionCategory: ['description edit', 'description edits'],
  SummaryCategory: ['title edit', 'title edits'],
  LinksCategory: ['link change', 'link changes'],
  TagsCategory: ['tag change', 'tag changes'],
  VcsChangeCategory: ['commit', 'commits'],
  PullRequestChangeCategory: ['pull request update', 'pull request updates'],
};
const ONE_OFF = { IssueCreatedCategory: 'created it', IssueResolvedCategory: 'resolved it' };

// Work types to try, in order, when time comes mostly from meetings or from reviews.
const MEETING_TYPES = ['Meeting', 'Meetings', 'Communication', 'Communications'];
const REVIEW_TYPES = ['Review', 'Code review', 'Code Review', 'Reviews'];

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
const MIN = 60000;

function issueOf(target) {
  if (!target) return null;
  if (target.idReadable) return target;
  if (target.issue && target.issue.idReadable) return target.issue;
  return null;
}

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

// Each group of moments (my YouTrack activity, or one pull request's review) becomes a
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

function stateName(a) {
  if (!a || !a.category || a.category.id !== 'CustomFieldCategory') return null;
  const fieldName = (a.field && (a.field.name || a.field.presentation)) || a.targetMember || '';
  if (!/state/i.test(fieldName)) return null;
  const v = Array.isArray(a.added) ? a.added[0] : a.added;
  return v && typeof v === 'object' && v.name ? v.name : null;
}

const shortPr = (ref) => {
  const m = /^[^/]+\/([^#]+)#(\d+)$/.exec(ref.label || '');
  return m ? `${m[1]}#${m[2]}` : ref.label;
};

function reviewText(list) {
  const r = list.filter((p) => p.kind === 'review').length;
  const c = list.length - r;
  const parts = [];
  if (r) parts.push(r === 1 ? 'a review' : r + ' reviews');
  if (c) parts.push(c === 1 ? 'a comment' : c + ' comments');
  return parts.join(' and ') + ' on ' + shortPr(list[0].ref);
}

// activities: YouTrack activity items. points: [{ issue, at, kind, ref: { label, url, title } }]
// from reviews. blocks: [{ issue, start, end, title }] from meetings.
function buildSuggestions(activities, { dates, existing = new Set(), dismissed = {}, points = [], blocks = [] }) {
  const groups = new Map();
  const seen = new Set();
  const group = (issue, date) => {
    const key = issue.idReadable + '|' + date;
    let g = groups.get(key);
    if (!g) {
      g = { key, issue: issue.idReadable, summary: issue.summary || '', project: issue.project ? issue.project.shortName : '', date, times: [], yt: [], counts: {}, states: [], reviews: [], blocks: [] };
      groups.set(key, g);
    }
    if (!g.summary && issue.summary) g.summary = issue.summary;
    return g;
  };
  for (const a of activities || []) {
    if (!a || !a.timestamp) continue;
    if (a.id) {
      if (seen.has(a.id)) continue; // the same activity can come back from two requests
      seen.add(a.id);
    }
    const issue = issueOf(a.target);
    if (!issue) continue;
    const date = localDate(a.timestamp);
    if (!dates.includes(date)) continue;
    const g = group(issue, date);
    g.times.push(a.timestamp);
    g.yt.push(a.timestamp);
    const cat = (a.category && a.category.id) || 'Other';
    g.counts[cat] = (g.counts[cat] || 0) + 1;
    const st = stateName(a);
    if (st) g.states.push(st);
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
    for (const [cat, k] of Object.entries(g.counts)) {
      if (ONE_OFF[cat]) { parts.push(ONE_OFF[cat]); continue; }
      if (cat === 'CustomFieldCategory' && g.states.length) {
        const rest = k - g.states.length;
        if (rest > 0) parts.push(rest + ' other ' + (rest === 1 ? 'field change' : 'field changes'));
        continue;
      }
      const label = LABELS[cat] || ['change', 'changes'];
      parts.push(k + ' ' + (k === 1 ? label[0] : label[1]));
    }
    for (const list of byPr.values()) parts.push(reviewText(list));
    if (g.blocks.length === 1) parts.push('meeting: ' + (g.blocks[0].title || 'untitled'));
    else if (g.blocks.length > 1) parts.push(g.blocks.length + ' meetings');

    const ytCount = g.times.length - g.reviews.length;
    let typeHint = null;
    if (g.blocks.length && est.meetings >= est.activity) typeHint = MEETING_TYPES;
    else if (g.reviews.length && g.reviews.length >= ytCount) typeHint = REVIEW_TYPES;

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

module.exports = { buildSuggestions, estimateMinutes, estimate, issueOf, clock, MEETING_TYPES, REVIEW_TYPES };
