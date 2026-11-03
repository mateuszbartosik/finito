'use strict';

// Starts Finito inside the browser against the same sample YouTrack, calendar and GitHub as
// `npm run demo`. Mirrors scripts/demo.js; web-demo/http.js does the networking.

const fs = require('fs');
const http = require('http');
const { createMockYouTrack } = require('../test/mock-youtrack');
const { createMockSources } = require('../test/mock-sources');
const { createApp } = require('../lib/app');

window.finitoDemo = (async () => {
  const mock = createMockYouTrack({ token: 'demo-token' });
  const ytUrl = await mock.start(0);
  // Shown in links and Settings, so it reads like a YouTrack address rather than a port.
  http.alias('youtrack.example.com', Number(new URL(ytUrl).port));
  const sources = createMockSources({ email: mock.me.email });
  const src = await sources.start(0);
  const dataDir = '/data-demo';
  fs.writeFileSync(dataDir + '/config.json', JSON.stringify({
    youtrackUrl: 'https://youtrack.example.com', token: 'demo-token',
    calendarUrl: src.calendarUrl, calendarName: mock.me.email,
    githubToken: sources.token, githubLogin: sources.login, githubApi: src.githubApi,
  }));
  const app = createApp({ port: 5178, dataDir });
  http.routeApi(await app.start());
})();
