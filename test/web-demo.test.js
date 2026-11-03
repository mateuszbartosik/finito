'use strict';

// The web demo bundles lib/ for the browser, with stand-ins for the Node modules it uses.
// This fails when the server code starts needing a module the demo has no stand-in for.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('the web demo builds, and its page loads the demo backend before the app', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'finito-web-demo-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-web-demo.js'), out], { stdio: 'pipe' });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(html.indexOf('finito-demo.js') > -1 && html.indexOf('finito-demo.js') < html.indexOf('app.js'));
    const bundle = fs.readFileSync(path.join(out, 'finito-demo.js'), 'utf8');
    for (const rel of ['lib/app.js', 'test/mock-youtrack.js', 'test/mock-sources.js', 'web-demo/http.js']) assert.ok(bundle.includes(JSON.stringify(rel)), rel);
    assert.ok(!fs.existsSync(path.join(out, 'package.json')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
