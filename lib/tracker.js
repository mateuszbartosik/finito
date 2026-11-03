'use strict';

// What Finito needs from an issue tracker, whichever one it is. YouTrack is the first
// adapter (lib/youtrack.js). Everything past an adapter sees only these shapes: no
// tracker's own field names and no tracker's own date encoding.
//
// @typedef {{ key: string, name: string, dbId: string|null }} Project
//   key: the short name issue keys start with, e.g. "APP".
// @typedef {{ key: string, dbId: string|null, title: string, resolved: boolean,
//             project: Project|null, url: string }} Issue
//   key: e.g. "APP-1207". dbId: the tracker's internal id, when it has one.
// @typedef {{ id: string, name: string }} WorkType
// @typedef {{ id: string, issue: Issue|null, date: string, minutes: number,
//             type: WorkType|null, note: string, author: { id: string, login: string }|null,
//             createdAt: number|null }} WorkItem
//   date: the local calendar day, 'YYYY-MM-DD'.
// @typedef {{ id: string, at: number, issue: Issue, kind: string, state: string|null }} Activity
//   kind: comment, attachment, field, description, title, link, tag, commit, pull-request,
//   created, resolved or other. state: the new state's name when a field change moved one.
// @typedef {{ id: string, login: string, name: string, email: string }} User
//
// An adapter is a class with:
//   static label, static async connect(url, token) -> { base, user }
//   base, me(), getIssue(key), searchIssues(text, limit), myOpenIssues(limit), projectKeys(),
//   workItems(fromDate, toDate), issueWorkItems(issue),
//   createWorkItem(issue, { date, minutes, type, note }), updateWorkItem(issue, id, patch),
//   deleteWorkItem(issue, id), workTypes(project) -> { enabled, types },
//   activities(fromMs, toMs) -> { items: Activity[], errors: string[] }
// `issue` arguments take an Issue, or anything with a key or dbId.

class TrackerError extends Error {
  constructor(message, status, transient) {
    super(message);
    this.name = 'TrackerError';
    this.status = status;
    this.transient = !!transient;
  }
}

module.exports = { TrackerError };
