'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { GitHub, GitHubError } = require('../lib/github');

// A stand-in for GitHub that answers every request with whatever the test sets next.
async function fakeGitHub() {
  let next = null;
  const server = http.createServer((req, res) => {
    res.writeHead(next.status, Object.assign({ 'Content-Type': 'application/json' }, next.headers));
    res.end(JSON.stringify(next.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    api: `http://127.0.0.1:${server.address().port}`,
    answer(a) { next = Object.assign({ status: 200, headers: {}, body: {} }, a); },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("GitHub's refusals say how far they reach and what to do", async () => {
  const fake = await fakeGitHub();
  const gh = new GitHub({ token: 't', api: fake.api });
  const refused = async (answer) => {
    fake.answer(answer);
    try { await gh.reviews('acme/web', 1); } catch (e) { assert.ok(e instanceof GitHubError); return e; }
    throw new Error('GitHub was expected to refuse');
  };
  try {
    let e = await refused({ status: 403, headers: { 'X-GitHub-SSO': 'required; url=https://github.com/orgs/acme/sso?authorization_request=abc' }, body: { message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.' } });
    assert.equal(e.scope, 'org');
    assert.equal(e.message, 'The acme organization uses single sign-on. Authorize the token for it at https://github.com/orgs/acme/sso?authorization_request=abc, then reload.');
    e = await refused({ status: 403, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '4000' }, body: { message: 'You have exceeded a secondary rate limit.' } });
    assert.equal(e.scope, 'limit');
    assert.match(e.message, /slow down/);
    e = await refused({ status: 403, headers: { 'X-RateLimit-Remaining': '0' }, body: { message: 'API rate limit exceeded.' } });
    assert.equal(e.scope, 'limit');
    assert.match(e.message, /hourly limit/);
    e = await refused({ status: 403, body: { message: 'Repository access blocked' } });
    assert.equal(e.scope, 'repo');
    assert.equal(e.message, 'GitHub refused access to acme/web: Repository access blocked.');
    e = await refused({ status: 404, body: { message: 'Not Found' } });
    assert.equal(e.scope, 'repo');
    e = await refused({ status: 401, body: { message: 'Bad credentials' } });
    assert.equal(e.scope, 'token');
    e = await refused({ status: 502, body: { message: 'Server Error' } });
    assert.equal(e.scope, undefined);
    assert.equal(e.message, 'GitHub answered 502: Server Error.');
  } finally {
    await fake.close();
  }
});
