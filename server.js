#!/usr/bin/env node
'use strict';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`Spent needs Node.js 18.17 or newer. This computer has ${process.version}.`);
  console.error('Get the LTS version from https://nodejs.org and run Spent again.');
  process.exit(1);
}

const path = require('path');
const { createApp, openBrowser } = require('./lib/app');

const port = Number(process.env.SPENT_PORT || 5178);
const app = createApp({ port, dataDir: process.env.SPENT_DATA_DIR || path.join(__dirname, 'data') });
const shouldOpen = process.argv.includes('--open');

app.start().then((p) => {
  const url = `http://localhost:${p}`;
  console.log(`\n  Spent is running at ${url}`);
  console.log('  Keep this window open while you use it. Ctrl+C stops it.\n');
  if (shouldOpen) openBrowser(url);
}).catch((e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use, so Spent is probably running already.`);
    console.error(`  Open http://localhost:${port}, or start it with another port: set SPENT_PORT=5179\n`);
    if (shouldOpen) openBrowser(`http://localhost:${port}`);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});

function shutdown() {
  app.stop().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
