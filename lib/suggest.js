'use strict';

const { localDate, pad } = require('./dates');

// Turns my YouTrack activity into suggested time: one suggestion per issue per day,
// for issue-days that have no time yet.

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

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;

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
  const span = Math.round((last - first) / 60000);
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil(span / 15) * 15));
}

function stateName(a) {
  if (!a || !a.category || a.category.id !== 'CustomFieldCategory') return null;
  const fieldName = (a.field && (a.field.name || a.field.presentation)) || a.targetMember || '';
  if (!/state/i.test(fieldName)) return null;
  const v = Array.isArray(a.added) ? a.added[0] : a.added;
  return v && typeof v === 'object' && v.name ? v.name : null;
}

function buildSuggestions(activities, { dates, existing = new Set(), dismissed = {} }) {
  const groups = new Map();
  const seen = new Set();
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
    const key = issue.idReadable + '|' + date;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        issue: issue.idReadable,
        summary: issue.summary || '',
        project: issue.project ? issue.project.shortName : '',
        date,
        first: a.timestamp,
        last: a.timestamp,
        counts: {},
        states: [],
      };
      groups.set(key, g);
    }
    g.first = Math.min(g.first, a.timestamp);
    g.last = Math.max(g.last, a.timestamp);
    const cat = (a.category && a.category.id) || 'Other';
    g.counts[cat] = (g.counts[cat] || 0) + 1;
    const st = stateName(a);
    if (st) g.states.push(st);
  }

  const out = [];
  for (const g of groups.values()) {
    if (existing.has(g.key) || dismissed[g.key]) continue;
    const n = Object.values(g.counts).reduce((x, y) => x + y, 0);
    const minutes = estimateMinutes(g.first, g.last, n);
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
    out.push({
      id: g.key,
      issue: g.issue,
      summary: g.summary,
      project: g.project,
      date: g.date,
      minutes,
      estimate: true,
      title: parts.join(', '),
      when: n > 1 ? clock(g.first) + '–' + clock(g.last) : clock(g.first),
      why: n > 1 ? 'Estimate: first to last activity, rounded up to 15 min, at most 4h.' : 'Estimate: a single touch counts as 15 min.',
    });
  }
  out.sort((a, b) => (a.date === b.date ? b.minutes - a.minutes : a.date < b.date ? -1 : 1));
  return out;
}

module.exports = { buildSuggestions, estimateMinutes, issueOf };
