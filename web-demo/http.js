'use strict';

// Browser stand-in for Node's http module. A "server" is a request handler kept in a
// table by port, and window.fetch is wrapped so requests to those ports, and the page's
// own /api/ calls, go straight to the handlers. Nothing leaves the browser: any other
// address fails the way a blocked network request would.

const servers = new Map();
const hosts = new Map(); // made-up host names (the demo's YouTrack address) -> port
let nextPort = 40000;
let apiPort = null;
let markReady;
const ready = new Promise((r) => { markReady = r; });
const realFetch = window.fetch.bind(window);

function createServer(handler) {
  let port = null;
  return {
    listen(wanted, host, cb) {
      port = wanted || nextPort++;
      servers.set(port, handler);
      if (cb) queueMicrotask(cb);
      return this;
    },
    address() { return { port }; },
    close(cb) { servers.delete(port); if (cb) queueMicrotask(cb); },
    once() { return this; },
    on() { return this; },
    removeListener() { return this; },
  };
}

// The page's fetch('/api/…') goes to the app; `name` makes https://name/… reach a mock.
function routeApi(port) { apiPort = port; markReady(); }
function alias(name, port) { hosts.set(name, port); }

function target(url) {
  if (url.origin === location.origin && url.pathname.startsWith('/api/') && apiPort) return { port: apiPort, host: `127.0.0.1:${apiPort}` };
  if (url.hostname === '127.0.0.1' && servers.has(Number(url.port))) return { port: Number(url.port), host: url.host };
  if (hosts.has(url.hostname)) return { port: hosts.get(url.hostname), host: url.host };
  return null;
}

async function fetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
  // The page can ask before the demo has started; hold its first calls until it has.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) await ready;
  const t = target(url);
  if (!t) {
    // Same-origin files (fonts, scripts) still load normally; everything else is out of reach.
    if (url.origin === location.origin) return realFetch(input, init);
    throw new TypeError('The demo runs offline, so it can\'t reach ' + url.host + '.');
  }
  const headers = {};
  new Headers(init.headers || (typeof input === 'object' && input.headers) || {}).forEach((v, k) => { headers[k] = v; });
  headers.host = t.host;
  const listeners = {};
  const req = {
    method: (init.method || 'GET').toUpperCase(),
    url: url.pathname + url.search,
    headers,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return this; },
    destroy() {},
  };
  const body = init.body == null ? '' : String(init.body);
  return new Promise((resolve, reject) => {
    let status = 200;
    const out = {};
    const res = {
      headersSent: false,
      writeHead(s, h) { status = s; Object.assign(out, h || {}); this.headersSent = true; return this; },
      setHeader(k, v) { out[k] = v; },
      end(text) {
        this.headersSent = true;
        const ok = !(status === 204 || status === 304);
        resolve(new Response(ok ? (text == null ? '' : text) : null, { status, headers: out }));
      },
    };
    try {
      Promise.resolve(servers.get(t.port)(req, res)).catch(reject);
    } catch (e) { reject(e); }
    // Bodies arrive after the handler has had a chance to listen, as they would from a socket.
    setTimeout(() => {
      if (body) (listeners.data || []).forEach((fn) => fn(body));
      (listeners.end || []).forEach((fn) => fn());
    }, 0);
  });
}

window.fetch = fetch;

module.exports = { createServer, routeApi, alias };
