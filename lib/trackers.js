'use strict';

// The trackers Finito can log time to. Each is an adapter as described in lib/tracker.js.

const { YouTrack } = require('./youtrack');
const { JiraCloud } = require('./jira');

// The first one is offered when nothing is connected yet.
const TRACKERS = [YouTrack, JiraCloud];

function trackerClass(id, list = TRACKERS) {
  return list.find((T) => T.id === id) || null;
}

// Every required field has a value.
function credsComplete(T, creds) {
  return !!T && T.credentials.every((f) => !f.required || (creds && creds[f.name]));
}

// What the connect form needs to know, without anything secret.
function describeTrackers(list = TRACKERS) {
  return list.map((T) => ({
    id: T.id,
    label: T.label,
    fields: T.credentials.map((f) => ({ name: f.name, label: f.label, placeholder: f.placeholder || '', secret: !!f.secret, required: !!f.required })),
    help: T.help || null,
  }));
}

// What the page needs to word itself and decide what to show, for a connected tracker.
function describeTracker(T, client) {
  const caps = T.capabilities || {};
  return {
    id: T.id,
    label: T.label,
    workTypes: !!caps.workTypes,
    activity: !!caps.activity,
    links: client && client.links ? client.links() : { issue: null, timesheets: null },
  };
}

module.exports = { TRACKERS, trackerClass, credsComplete, describeTrackers, describeTracker };
