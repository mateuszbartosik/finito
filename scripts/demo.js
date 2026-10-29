'use strict';

// Runs Finito against a fake, in-memory YouTrack, calendar and GitHub, so you can try it
// without touching real data.

const fs = require('fs');
const path = require('path');
const { createMockYouTrack } = require('../test/mock-youtrack');
const { createMockSources } = require('../test/mock-sources');
const { createApp, openBrowser } = require('../lib/app');

(async () => {
  const mock = createMockYouTrack({ token: 'demo-token' });
  const ytUrl = await mock.start(0);
  const sources = createMockSources({ email: mock.me.email });
  const src = await sources.start(0);
  const dataDir = path.join(__dirname, '..', 'data-demo');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    youtrackUrl: ytUrl, token: 'demo-token',
    calendarUrl: src.calendarUrl, calendarName: mock.me.email,
    githubToken: sources.token, githubLogin: sources.login, githubApi: src.githubApi,
  }, null, 2));
  const app = createApp({ port: Number(process.env.FINITO_DEMO_PORT || 5179), dataDir });
  const port = await app.start();
  const url = `http://localhost:${port}`;
  console.log(`\n  Finito demo: ${url}`);
  console.log('  This uses a fake YouTrack, calendar and GitHub with sample data. Nothing real is read or written.');
  console.log('  Ctrl+C stops it; the demo starts fresh every time.\n');
  if (process.argv.includes('--open')) openBrowser(url);
})().catch((e) => {
  if (e.code === 'EADDRINUSE') console.error('The demo port is busy. Set FINITO_DEMO_PORT to another number.');
  else console.error(e);
  process.exit(1);
});
