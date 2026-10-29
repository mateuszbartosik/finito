'use strict';

// Stand-ins for a calendar's secret iCal address and for GitHub's REST API, with a week of
// sample meetings and reviews. Used by the tests and by `npm run demo`.

const http = require('http');
const D = require('../lib/dates');

const stamp = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
};
const dayStamp = (date) => date.replace(/-/g, '');

function createMockSources({ token = 'gh-token', login = 'sample-user', email = 'sample@example.com', monday = D.mondayOf(D.localDate()) } = {}) {
  const day = (k) => D.addDays(monday, k);
  const at = (k, h, m) => D.localMidnightMs(day(k)) + (h * 60 + m) * 60000;
  const iso = (ms) => new Date(ms).toISOString();
  const me = `ATTENDEE;CN=Sample User;PARTSTAT=ACCEPTED:mailto:${email}`;
  const sam = 'ATTENDEE;CN=Sam Lee;PARTSTAT=ACCEPTED:mailto:sam@example.com';

  // Times without a zone are "floating": they read as this computer's local time.
  const events = [
    ['UID:standup', 'SUMMARY:Daily standup', `DTSTART:${stamp(at(-7, 9, 30))}`, `DTEND:${stamp(at(-7, 9, 45))}`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', me, sam],
    ['UID:review-1221', 'SUMMARY:Design review APP-1221', `DTSTART:${stamp(at(1, 15, 0))}`, `DTEND:${stamp(at(1, 15, 30))}`, me, sam],
    ['UID:one-on-one', 'SUMMARY:1:1 with Sam', `DTSTART:${stamp(at(-5, 13, 0))}`, `DTEND:${stamp(at(-5, 13, 30))}`, 'RRULE:FREQ=WEEKLY', me, sam],
    ['UID:lunch', 'SUMMARY:Lunch', `DTSTART:${stamp(at(-7, 12, 0))}`, `DTEND:${stamp(at(-7, 12, 30))}`, 'RRULE:FREQ=DAILY'],
    ['UID:vendor', 'SUMMARY:Vendor call', `DTSTART:${stamp(at(1, 11, 0))}`, `DTEND:${stamp(at(1, 12, 0))}`,
      `ATTENDEE;PARTSTAT=DECLINED:mailto:${email}`, 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:vendor@example.org'],
    ['UID:all-hands', 'SUMMARY:Company all-hands', `DTSTART:${stamp(at(3, 16, 0))}`, `DTEND:${stamp(at(3, 17, 0))}`, 'TRANSP:TRANSPARENT', me, sam],
    ['UID:conf', 'SUMMARY:Conference', `DTSTART;VALUE=DATE:${dayStamp(day(4))}`, `DTEND;VALUE=DATE:${dayStamp(day(5))}`, me, sam],
  ];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finito//Mock//EN', `X-WR-CALNAME:${email}`,
    ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

  const user = (l) => ({ login: l, id: l.length });
  const pulls = [
    {
      repo: 'acme/web', number: 42, title: 'DS-41: focus ring for buttons', body: 'Follows the new tokens.', branch: 'ds-41-focus-ring', author: 'sam',
      reviews: [
        { user: user(login), state: 'APPROVED', submitted_at: iso(at(2, 10, 40)), html_url: 'https://github.example.com/acme/web/pull/42#pullrequestreview-1' },
        { user: user('alex'), state: 'COMMENTED', submitted_at: iso(at(2, 11, 0)), html_url: 'https://github.example.com/acme/web/pull/42#pullrequestreview-2' },
      ],
      comments: [
        { user: user(login), created_at: iso(at(2, 10, 5)), html_url: 'https://github.example.com/acme/web/pull/42#discussion_r1' },
        { user: user(login), created_at: iso(at(2, 10, 20)), html_url: 'https://github.example.com/acme/web/pull/42#discussion_r2' },
      ],
      talk: [],
    },
    {
      repo: 'acme/api', number: 7, title: 'Refactor date helpers', body: 'No ticket, just tidying.', branch: 'refactor/dates', author: 'alex',
      reviews: [{ user: user(login), state: 'CHANGES_REQUESTED', submitted_at: iso(at(3, 14, 0)), html_url: 'https://github.example.com/acme/api/pull/7#pullrequestreview-3' }],
      comments: [{ user: user(login), created_at: iso(at(3, 13, 50)), html_url: 'https://github.example.com/acme/api/pull/7#discussion_r3' }],
      talk: [{ user: user(login), created_at: iso(at(3, 14, 5)), html_url: 'https://github.example.com/acme/api/pull/7#issuecomment-1' }],
    },
  ];
  const state = { calls: [] };

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    state.calls.push(p + url.search);
    if (p === '/calendar.ics') {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      return res.end(ics);
    }
    if (!p.startsWith('/github/')) return json(res, 404, { message: 'Not Found' });
    if (req.headers.authorization !== 'Bearer ' + token) return json(res, 401, { message: 'Bad credentials' });
    const g = p.slice('/github'.length);
    let m;
    if (g === '/user') return json(res, 200, { login, name: 'Sample User' });
    if (g === '/search/issues') {
      const q = url.searchParams.get('q') || '';
      if (!q.includes('reviewed-by:' + login)) return json(res, 200, { total_count: 0, items: [] });
      return json(res, 200, {
        total_count: pulls.length,
        items: pulls.map((pr) => ({
          number: pr.number, title: pr.title, body: pr.body, html_url: `https://github.example.com/${pr.repo}/pull/${pr.number}`,
          repository_url: `https://api.github.com/repos/${pr.repo}`, pull_request: { url: '' }, user: user(pr.author),
        })),
      });
    }
    const find = (o, r, n) => pulls.find((x) => x.repo === `${o}/${r}` && x.number === Number(n));
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/reviews$/.exec(g))) { const pr = find(m[1], m[2], m[3]); return pr ? json(res, 200, pr.reviews) : json(res, 404, {}); }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/.exec(g))) { const pr = find(m[1], m[2], m[3]); return pr ? json(res, 200, pr.comments) : json(res, 404, {}); }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/.exec(g))) { const pr = find(m[1], m[2], m[3]); return pr ? json(res, 200, pr.talk) : json(res, 404, {}); }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(g))) { const pr = find(m[1], m[2], m[3]); return pr ? json(res, 200, { number: pr.number, head: { ref: pr.branch } }) : json(res, 404, {}); }
    return json(res, 404, { message: 'Not Found' });
  });

  return {
    state,
    token,
    login,
    start(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
        const base = `http://127.0.0.1:${server.address().port}`;
        resolve({ base, calendarUrl: base + '/calendar.ics', githubApi: base + '/github' });
      }));
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createMockSources };
