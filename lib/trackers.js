'use strict';

// The trackers Finito can log time to. Each is an adapter as described in lib/tracker.js.

const { YouTrack } = require('./youtrack');

const TRACKERS = [YouTrack];
const DEFAULT = YouTrack;

function trackerClass(id) {
  return TRACKERS.find((T) => T.id === id) || null;
}

// Every required field has a value.
function credsComplete(T, creds) {
  return !!T && T.credentials.every((f) => !f.required || (creds && creds[f.name]));
}

// What the connect form needs to know, without anything secret.
function describeTrackers() {
  return TRACKERS.map((T) => ({
    id: T.id,
    label: T.label,
    fields: T.credentials.map((f) => ({ name: f.name, label: f.label, placeholder: f.placeholder || '', secret: !!f.secret, required: !!f.required })),
    help: T.help || null,
  }));
}

module.exports = { TRACKERS, DEFAULT, trackerClass, credsComplete, describeTrackers };
