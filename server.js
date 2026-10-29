#!/usr/bin/env node
'use strict';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Finito needs Node.js 20 or newer. This computer has ${process.version}.`);
  console.error('Get the LTS version from https://nodejs.org and run Finito again.');
  process.exit(1);
}

const path = require('path');
const { createApp, openBrowser } = require('./lib/app');

const port = Number(process.env.FINITO_PORT || 5178);
const app = createApp({ port, dataDir: process.env.FINITO_DATA_DIR || path.join(__dirname, 'data') });
const shouldOpen = process.argv.includes('--open');

app.start().then((p) => {
  const url = `http://localhost:${p}`;
  console.log(`\n  Finito is running at ${url}`);
  console.log('  Keep this window open while you use it. Ctrl+C stops it.\n');
  if (shouldOpen) openBrowser(url);
}).catch((e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${port} is already in use, so Finito is probably running already.`);
    console.error(`  Open http://localhost:${port}, or start it with another port: set FINITO_PORT=5179\n`);
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
