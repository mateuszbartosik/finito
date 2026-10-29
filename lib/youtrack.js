'use strict';

// A thin client for the parts of YouTrack's REST API that Finito uses.
// Docs: https://www.jetbrains.com/help/youtrack/devportal/youtrack-rest-api.html

const ISSUE_FIELDS = 'id,idReadable,summary,resolved,project(id,shortName,name)';
const ITEM_FIELDS = 'id,date,created,duration(minutes,presentation),text,type(id,name),author(id,login),issue(' + ISSUE_FIELDS + ')';

class YouTrackError extends Error {
  constructor(message, status, transient) {
    super(message);
    this.name = 'YouTrackError';
    this.status = status;
    this.transient = !!transient;
  }
}

function errorText(json, text, fallback) {
  if (json && typeof json === 'object') {
    return json.error_description || json.error_developer_message || json.error || fallback;
  }
  if (text && text.length < 300 && !/<html/i.test(text)) return text.trim();
  return fallback;
}

class YouTrack {
  constructor({ url, token, timeoutMs = 20000 }) {
    this.base = String(url || '').replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, { query, body } = {}) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const headers = { Authorization: 'Bearer ' + this.token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      const code = (e.cause && (e.cause.code || e.cause.message)) || e.message;
      throw new YouTrackError(timedOut ? 'YouTrack took too long to answer.' : `Couldn't reach YouTrack (${code}).`, 0, true);
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* not JSON */ }

    if (!res.ok) {
      const msg = errorText(json, text, res.statusText || 'request failed');
      throw new YouTrackError(`YouTrack ${res.status}: ${msg}`, res.status, res.status >= 500 || res.status === 429);
    }
    return json;
  }

  me() {
    return this.request('GET', '/api/users/me', { query: { fields: 'id,login,fullName,email' } });
  }

  // All of my work items between two dates (inclusive), across projects.
  async workItems(startDate, endDate) {
    const out = [];
    const top = 500;
    for (let skip = 0; skip < 10000; skip += top) {
      const page = await this.request('GET', '/api/workItems', {
        query: { author: 'me', startDate, endDate, fields: ITEM_FIELDS, $top: top, $skip: skip },
      });
      if (!Array.isArray(page) || !page.length) break;
      out.push(...page);
      if (page.length < top) break;
    }
    return out;
  }

  issueWorkItems(issueId) {
    return this.request('GET', `/api/issues/${encodeURIComponent(issueId)}/timeTracking/workItems`, {
      query: { fields: ITEM_FIELDS, $top: 1000 },
    });
  }

  issue(id) {
    return this.request('GET', `/api/issues/${encodeURIComponent(id)}`, { query: { fields: ISSUE_FIELDS } });
  }

  searchIssues(query, top = 10) {
    return this.request('GET', '/api/issues', { query: { query, fields: ISSUE_FIELDS, $top: top } });
  }

  // Work item types for a project. Needs the project's database id (e.g. 0-3).
  async projectTypes(projectId) {
    try {
      const s = await this.request('GET', `/api/admin/projects/${encodeURIComponent(projectId)}/timeTrackingSettings`, {
        query: { fields: 'enabled,workItemTypes(id,name)' },
      });
      return { enabled: !s || s.enabled !== false, types: ((s && s.workItemTypes) || []).map((t) => ({ id: t.id, name: t.name })) };
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e;
      const all = await this.request('GET', '/api/admin/timeTrackingSettings/workItemTypes', { query: { fields: 'id,name' } });
      return { enabled: true, types: (all || []).map((t) => ({ id: t.id, name: t.name })), global: true };
    }
  }

  createWorkItem(issueId, { date, minutes, typeId, text }) {
    const body = { date, duration: { minutes } };
    if (text) body.text = text;
    if (typeId) body.type = { id: typeId };
    return this.request('POST', `/api/issues/${encodeURIComponent(issueId)}/timeTracking/workItems`, {
      query: { fields: ITEM_FIELDS },
      body,
    });
  }

  updateWorkItem(issueId, itemId, patch) {
    return this.request('POST', `/api/issues/${encodeURIComponent(issueId)}/timeTracking/workItems/${encodeURIComponent(itemId)}`, {
      query: { fields: ITEM_FIELDS },
      body: patch,
    });
  }

  deleteWorkItem(issueId, itemId) {
    return this.request('DELETE', `/api/issues/${encodeURIComponent(issueId)}/timeTracking/workItems/${encodeURIComponent(itemId)}`);
  }

  // Projects I can see. Used to tell issue IDs apart from look-alikes such as UTF-8 in free text.
  projects() {
    return this.request('GET', '/api/admin/projects', { query: { fields: 'id,shortName,name', $top: 2000 } });
  }

  // My activity (comments, field changes, …) in a time window, oldest first.
  activities({ start, end, categories, fields, top = 2000 }) {
    return this.request('GET', '/api/activities', {
      query: { categories, author: 'me', start, end, reverse: 'false', fields, $top: top },
    });
  }
}

module.exports = { YouTrack, YouTrackError, ISSUE_FIELDS, ITEM_FIELDS };
