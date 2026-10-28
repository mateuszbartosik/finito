import { html, render, useState, useEffect, useLayoutEffect, useRef, useCallback } from './vendor/preact-htm.js';
import { parseQuick, parseDuration, fmt, addDays, weekdayIndex, localDateOf, resolveTypeName, pad } from './parse.js';
import { useGlass, useSheen } from './glass.js';

// ---------- helpers ----------

const enc = encodeURIComponent;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (date) => Number(date.slice(8, 10));
const monthName = (date) => MONTHS[Number(date.slice(5, 7)) - 1];
const dayLabel = (date) => `${DOW[weekdayIndex(date)]} ${dayNum(date)} ${monthName(date)}`;
const shortDay = (date) => `${DOW[weekdayIndex(date)]} ${dayNum(date)}`;
const mondayOf = (date) => addDays(date, -weekdayIndex(date));
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const cellId = (issue, date) => `cell-${issue}-${date}`;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function focusEditor() {
  const el = document.querySelector('.popover .ed-input') || document.querySelector('.popover');
  if (el) el.focus();
}

function rangeLabel(dates) {
  const a = dates[0];
  const b = dates[6];
  const left = a.slice(5, 7) === b.slice(5, 7) ? `${dayNum(a)}` : `${dayNum(a)} ${monthName(a)}`;
  return `${left} – ${dayNum(b)} ${monthName(b)} ${b.slice(0, 4)}`;
}

function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 3600)}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

function localDateTimeMs(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = String(time || '18:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: Object.assign({ 'X-Spent': '1' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    const err = new Error("Spent's local server isn't answering. Is its window still open?");
    err.status = 0;
    throw err;
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status}).`);
    err.status = res.status;
    err.ytStatus = data.ytStatus;
    throw err;
  }
  return data;
}

// A number that glides to its new value.
function useTween(value, ms = 420) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduceMotion() || from.current === value) { from.current = value; setShown(value); return undefined; }
    const start = performance.now();
    const a = from.current;
    let frame = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * e);
      if (k < 1) frame = requestAnimationFrame(step); else from.current = value;
    });
    return () => { cancelAnimationFrame(frame); from.current = value; };
  }, [value]);
  return shown;
}

// ---------- icons ----------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.8-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  sparkle: '<path d="M12 3.5l1.6 4.6a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L12 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3L4.5 11l4.6-1.6a2 2 0 0 0 1.3-1.3z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  enter: '<path d="M19 6v5a3 3 0 0 1-3 3H6M10 10l-4 4 4 4"/>',
  warn: '<path d="M12 4.5L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

function Icon({ name, size = 16, stroke = 2 }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: ICONS[name] }}></svg>`;
}

// A piece of the control layer: frosted everywhere, refracting where the browser can.
function Glass({ as = 'div', refract = true, radius, bezel, scale, blur, sheen, innerRef, class: cls = '', children, ...rest }) {
  const own = useRef(null);
  const ref = innerRef || own;
  useGlass(ref, refract ? { radius, bezel, scale, blur } : null);
  const Tag = as;
  return html`<${Tag} ref=${ref} class=${'glass ' + cls} ...${rest}>${sheen ? html`<${Sheen} target=${ref} />` : null}${children}<//>`;
}
function Sheen({ target }) { useSheen(target); return null; }

function Mark({ size = 28 }) {
  return html`<span class="mark" style=${{ width: size + 'px', height: size + 'px' }} aria-hidden="true">
    <svg viewBox="0 0 32 32" width=${size} height=${size}><circle cx="16" cy="17" r="10.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M16 17V11.5M13 3.5h6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>
  </span>`;
}

// ---------- app shell ----------

function App() {
  const [status, setStatus] = useState(null);
  const [reconnect, setReconnect] = useState(false);
  useEffect(() => {
    api('GET', '/status').then(setStatus).catch((e) => setStatus({ configured: false, error: e.message, offline: true }));
  }, []);
  const onReconnect = useCallback(() => setReconnect(true), []);
  const onUnauthorized = useCallback(() => setStatus((s) => ({ ...s, ytStatus: 401 })), []);
  if (!status) return html`<div class="boot"><span class="spinner" aria-label="Loading"></span></div>`;
  if (status.offline) return html`<div class="boot"><div class="panel boot-card"><p>${status.error}</p></div></div>`;
  const tokenDead = status.configured && status.ytStatus === 401;
  if (!status.configured || tokenDead || reconnect) {
    return html`<${Setup}
      status=${status}
      canCancel=${status.configured && !tokenDead && reconnect}
      onCancel=${() => setReconnect(false)}
      onDone=${(s) => { setStatus(s); setReconnect(false); }}
    />`;
  }
  return html`<${Main} status=${status} onReconnect=${onReconnect} onUnauthorized=${onUnauthorized} />`;
}

function Setup({ status, canCancel, onCancel, onDone }) {
  const [url, setUrl] = useState(status.url || '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(status.ytStatus === 401 ? 'YouTrack no longer accepts the saved token. Paste a new one.' : status.error || '');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('POST', '/setup', { url, token });
      onDone({ configured: true, url: r.url, user: r.user });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  let origin = null;
  try { origin = new URL(/^https?:/i.test(url) ? url : 'https://' + url).origin; } catch (_) { /* not yet a URL */ }
  return html`<div class="setup-wrap">
    <${Glass} as="form" class="setup glass-strong" radius=${30} bezel=${22} scale=${26} blur=${12} onSubmit=${submit}>
      <${Mark} size=${40} />
      <h1>Connect YouTrack</h1>
      <p class="sub">Spent runs on this computer and logs time as you. Your token stays here.</p>
      <label class="field">
        <span>Address</span>
        <input id="url" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://youtrack.example.com" required />
      </label>
      <label class="field">
        <span>Permanent token</span>
        <input id="token" type="password" value=${token} onInput=${(e) => setToken(e.target.value)} placeholder=${status.configured ? 'Leave empty to keep the saved one' : 'perm:…'} autocomplete="off" />
      </label>
      <details class="howto">
        <summary>Where do I get a token?</summary>
        <ol>
          <li>In YouTrack: your avatar → <b>Profile</b> → <b>Account Security</b>.</li>
          <li><b>New token…</b>, name it “Spent”, scope <b>YouTrack</b>.</li>
          <li>Copy it now (YouTrack shows it once) and paste it here.</li>
        </ol>
        ${origin ? html`<a href=${origin + '/users/me'} target="_blank" rel="noopener noreferrer">Open my YouTrack profile <${Icon} name="external" size=${12} /></a>` : null}
      </details>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : null}
      <div class="actions">
        ${canCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Cancel</button>` : null}
        <button class="btn btn-accent" disabled=${busy}>${busy ? 'Checking…' : 'Connect'}</button>
      </div>
    <//>
  </div>`;
}

// ---------- main screen ----------

function Main({ status, onReconnect, onUnauthorized }) {
  const [week, setWeek] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [mine, setMine] = useState([]);
  const [sugg, setSugg] = useState({ loading: true, items: [], errors: [], monday: null });
  const [edit, setEdit] = useState(null);
  const [timerPop, setTimerPop] = useState(false);
  const [toast, setToast] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState('');
  const [lookups, setLookups] = useState({});
  const toastTimer = useRef(null);
  const weekRef = useRef(null);
  const editorRef = useRef(null);
  const askedAboutTimer = useRef(false);
  const lastSugg = useRef(0);
  const queue = useRef(Promise.resolve());
  const inflight = useRef(new Set());
  const dockBusy = useRef(false);
  if (week) weekRef.current = week;

  const flash = useCallback((msg, kind = 'info', action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind, action, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 7000 : action ? 6000 : 3200);
  }, []);

  // Only the latest request for the week (or its suggestions) may land.
  const weekSeq = useRef(0);
  const suggSeq = useRef(0);
  const load = useCallback(async (start, fresh) => {
    const n = ++weekSeq.current;
    try {
      const w = await api('GET', `/week?start=${start || ''}${fresh ? '&fresh=1' : ''}`);
      if (n !== weekSeq.current) return null;
      weekRef.current = w;
      setWeek(w);
      setLoadError(null);
      return w;
    } catch (e) {
      if (n !== weekSeq.current) return null;
      if (e.status === 401) { onUnauthorized(); return null; }
      setLoadError(e.message);
      return null;
    }
  }, [onUnauthorized]);

  const loadSugg = useCallback(async (start) => {
    const n = ++suggSeq.current;
    lastSugg.current = Date.now();
    setSugg((s) => ({ ...s, loading: true, monday: start }));
    try {
      const r = await api('GET', `/suggestions?start=${start}`);
      if (n === suggSeq.current) setSugg({ loading: false, items: r.suggestions || [], errors: r.errors || [], monday: start });
    } catch (e) {
      if (n === suggSeq.current) setSugg({ loading: false, items: [], errors: [e.message], monday: start });
    }
  }, []);

  useEffect(() => {
    load(null).then((w) => w && loadSugg(w.monday));
    api('GET', '/issues/mine').then((r) => setMine(r.issues || [])).catch(() => {});
  }, []);

  // Coming back to the tab picks up what changed in YouTrack meanwhile.
  useEffect(() => {
    const onVis = () => {
      const w = weekRef.current;
      if (document.visibilityState !== 'visible' || !w) return;
      load(w.monday);
      if (Date.now() - lastSugg.current > 5 * 60 * 1000) loadSugg(w.monday);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const timerStart = week && week.timer ? week.timer.startedAt : null;
  useEffect(() => {
    if (!timerStart) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timerStart]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('.scrim')) {
        e.preventDefault();
        const el = document.getElementById('qe');
        if (el) el.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Look up an issue ID typed in the dock that we don't know yet.
  useEffect(() => {
    const w = weekRef.current;
    if (!w || !q.trim()) return undefined;
    const m = q.match(/(?:^|\s)([A-Za-z][\w]*-\d+)(?=\s|$)/);
    if (!m) return undefined;
    const id = m[1];
    const k = id.toLowerCase();
    if (lookups[k] || Object.keys(w.issues).some((x) => x.toLowerCase() === k)) return undefined;
    const t = setTimeout(() => {
      api('GET', '/issue/' + enc(id))
        .then((r) => setLookups((l) => ({ ...l, [k]: { ok: true, issue: r.issue } })))
        .catch((e) => setLookups((l) => ({ ...l, [k]: { ok: false, error: e.message } })));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // A timer left running overnight asks what to do, once.
  const longRunCheck = week && week.timer && (localDateOf(week.timer.startedAt) < week.today || Date.now() - week.timer.startedAt > 10 * 3600 * 1000);
  useEffect(() => {
    if (longRunCheck && !askedAboutTimer.current) { askedAboutTimer.current = true; setTimerPop(true); }
  }, [longRunCheck]);

  if (!week) {
    return html`<div class="boot">${loadError
      ? html`<div class="panel boot-card"><p>${loadError}</p><button class="btn" onClick=${() => load(null)}>Try again</button></div>`
      : html`<span class="spinner" aria-label="Loading your week"></span>`}</div>`;
  }

  // ---- derived data ----
  const { dates, today, entries, issues, projects, settings } = week;
  const target = settings.dailyTargetMinutes;
  const isWorkDay = (d) => settings.workDays.includes((weekdayIndex(d) + 1) % 7);
  const cells = new Map();
  for (const e of entries) {
    const k = e.issue + '|' + e.date;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(e);
  }
  const cellEntries = (issue, date) => cells.get(issue + '|' + date) || [];
  const liveOf = (list) => (list || []).filter((e) => e.status !== 'deleted');
  const sum = (list) => list.reduce((a, e) => a + e.minutes, 0);
  const dayTotals = dates.map((d) => sum(liveOf(entries.filter((e) => e.date === d))));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const timer = week.timer;
  const timerMin = timer ? Math.max(0, (now - timer.startedAt) / 60000) : 0;
  const timerDate = timer ? localDateOf(timer.startedAt) : null;
  const timerPieces = [];
  if (timer) {
    for (let from = timer.startedAt; from < now;) {
      const d = localDateOf(from);
      const to = Math.min(now, localDateTimeMs(addDays(d, 1), '00:00'));
      timerPieces.push({ date: d, minutes: (to - from) / 60000 });
      from = to;
    }
  }
  const runningOn = (date) => { const piece = timerPieces.find((x) => x.date === date); return piece ? piece.minutes : 0; };
  const thisMonday = mondayOf(today);
  const isThisWeek = week.monday === thisMonday;
  const suggestions = sugg.monday === week.monday ? sugg.items.filter((s) => dates.includes(s.date)) : [];

  const rowIds = [];
  const pushRow = (id) => { if (id && !rowIds.includes(id)) rowIds.push(id); };
  week.rows.forEach(pushRow);
  [...entries].sort((a, b) => (a.date === b.date ? a.issue.localeCompare(b.issue) : a.date < b.date ? -1 : 1)).forEach((e) => pushRow(e.issue));
  if (timer && timerPieces.some((x) => dates.includes(x.date))) pushRow(timer.issue);
  const ghostIds = [];
  for (const s of suggestions) if (!rowIds.includes(s.issue) && !ghostIds.includes(s.issue)) ghostIds.push(s.issue);
  const suggAt = (issue, date) => suggestions.find((s) => s.issue === issue && s.date === date);

  // Days off stay hidden unless something happened on them.
  let cols = dates.filter((d, i) => isWorkDay(d) || dayTotals[i] > 0 || entries.some((e) => e.date === d)
    || runningOn(d) > 0 || suggestions.some((s) => s.date === d));
  if (!cols.length) cols = dates;

  const known = [];
  const seenIds = new Set();
  for (const i of Object.values(issues)) {
    if (i && i.idReadable && !i.missing) { known.push(Object.assign({}, i, { preferred: true })); seenIds.add(i.idReadable); }
  }
  for (const l of Object.values(lookups)) if (l.ok && !seenIds.has(l.issue.idReadable)) { known.push(l.issue); seenIds.add(l.issue.idReadable); }
  for (const i of mine) if (!seenIds.has(i.idReadable)) { known.push(i); seenIds.add(i.idReadable); }
  for (const s of suggestions) {
    if (seenIds.has(s.issue)) continue;
    const project = typeof s.project === 'string' ? (projects[s.project] || { shortName: s.project, name: s.project }) : s.project || null;
    known.push({ idReadable: s.issue, summary: s.summary, project });
    seenIds.add(s.issue);
  }

  const issueInfo = (id) => issues[id] || known.find((i) => i.idReadable === id) || { idReadable: id, summary: '' };
  const projectOf = (id) => { const i = issueInfo(id); return i.project ? projects[i.project.shortName] || i.project : null; };
  const typesFor = (id) => { const p = projectOf(id); return p && Array.isArray(p.types) ? p.types : null; };
  const defaultTypeFor = (id) => { const p = projectOf(id); return p ? settings.typeDefaults[p.shortName] || null : null; };
  const ytLink = (id) => `${week.url}/issue/${enc(id)}`;

  // ---- actions ----
  const reload = () => load(week.monday);
  const go = async (start) => {
    setEdit(null);
    setAdding(false);
    const w = await load(start);
    if (w) loadSugg(w.monday);
  };
  const run = async (fn, message) => {
    try {
      const r = await fn();
      await reload();
      if (message) {
        const m = typeof message === 'function' ? message(r) : message;
        if (m) Array.isArray(m) ? flash(...m) : flash(m);
      }
      return r || true;
    } catch (e) {
      if (e.status === 401) { onUnauthorized(); return null; }
      flash(e.message, 'error');
      await reload();
      return null;
    }
  };
  // Writes go one at a time, each against the latest week.
  const serial = (fn) => {
    const next = queue.current.then(fn, fn);
    queue.current = next.catch(() => {});
    return next;
  };

  const baseOf = (e) => Object.assign({ issue: e.issue, issueDbId: e.issueDbId, date: e.date }, e.base || { minutes: e.minutes, type: e.type, text: e.text });
  const patchRaw = (e, changes) => api('PATCH', '/entries/' + enc(e.key), Object.assign({}, changes, { base: baseOf(e) }));
  const removeRaw = (e) => api('POST', `/entries/${enc(e.key)}/remove`, { snapshot: baseOf(e) });
  const restoreRaw = (e) => api('POST', `/entries/${enc(e.key)}/restore`, {});
  const undoDrafts = (keys) => async () => {
    setToast(null);
    await run(async () => { for (const k of keys) await api('POST', `/entries/${enc('d:' + k)}/remove`, {}); }, 'Undone');
  };
  const forgetSugg = (list) => setSugg((st) => ({ ...st, items: st.items.filter((x) => !list.some((s) => s.id === x.id)) }));

  // Write a cell's total. Returns false when the text can't be read.
  const commitCell = (issue, date, text, extra = {}) => {
    const min = parseDuration(text);
    if (min === null || min > 1440) { flash(`Couldn't read “${text}”. Try 1.5, 1h30 or 90m.`, 'error'); return Promise.resolve(false); }
    const s = suggAt(issue, date);
    return serial(() => writeCell(issue, date, min, extra, s));
  };
  const writeCell = async (issue, date, min, extra, s) => {
    const latest = weekRef.current || week;
    const here = latest.entries.filter((e) => e.issue === issue && e.date === date);
    const lv = liveOf(here);
    const cur = sum(lv);
    if (min === cur) return true;
    await run(async () => {
      if (min === 0) { for (const e of lv) await removeRaw(e); return null; }
      if (!lv.length) {
        const gone = here.find((e) => e.status === 'deleted');
        if (gone) { await restoreRaw(gone); await patchRaw(gone, { minutes: min }); return null; }
        const body = { issue, dates: [date], minutes: min };
        if (extra.type !== undefined) body.type = extra.type;
        if (extra.text) body.text = extra.text;
        const r = await api('POST', '/entries', body);
        if (s) forgetSugg([s]);
        return r;
      }
      const last = lv[lv.length - 1];
      const nm = last.minutes + (min - cur);
      if (nm <= 0) throw new Error('This cell holds several work items. Change them one by one.');
      await patchRaw(last, { minutes: nm });
      return null;
    });
    return true;
  };

  const nextCell = (issue, date, key, shift) => {
    const all = [...rowIds, ...ghostIds];
    const di = cols.indexOf(date);
    const ri = all.indexOf(issue);
    if (key === 'Tab') {
      const nd = di + (shift ? -1 : 1);
      if (nd >= 0 && nd < cols.length) return { issue, date: cols[nd] };
      const nr = ri + (shift ? -1 : 1);
      if (nr >= 0 && nr < all.length) return { issue: all[nr], date: cols[shift ? cols.length - 1 : 0] };
      return null;
    }
    const nr = ri + (key === 'ArrowDown' ? 1 : -1);
    return nr >= 0 && nr < all.length ? { issue: all[nr], date } : null;
  };

  const openEditor = (issue, date, initial) => {
    setTimerPop(false);
    setEdit({ issue, date, initial: initial === undefined ? null : initial, n: Date.now() });
  };
  // Give focus back to the cell, unless it has already gone somewhere on purpose.
  const focusCell = (c) => setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const n = document.getElementById(cellId(c.issue, c.date));
    if (n) n.focus();
  }, 0);
  const closeEditor = async (commit = true, refocus = false) => {
    const ed = editorRef.current;
    const was = edit;
    setEdit(null);
    if (refocus && was) focusCell(was);
    if (ed) await (commit ? ed.commit() : ed.cancel());
  };

  const timerMessage = (r) => {
    const logged = (r.stopped || []).map((s) => `${fmt(s.minutes)} to ${s.issue}${s.date !== today ? ' on ' + shortDay(s.date) : ''}`).join(', ');
    const keys = (r.stopped || []).map((s) => s.key).filter(Boolean);
    if (r.timer) return logged ? [`Logged ${logged} · timer on ${r.timer.issue}`, 'info', keys.length ? { label: 'Undo', fn: undoDrafts(keys) } : null] : `Timer started on ${r.timer.issue}`;
    return logged ? [`Logged ${logged}`, 'info', keys.length ? { label: 'Undo', fn: undoDrafts(keys) } : null] : 'Timer discarded';
  };
  const startTimer = (issue, extra = {}) => serial(() => run(() => api('POST', '/timer/start', Object.assign({ issue }, extra)), timerMessage));
  const stopTimer = (body = {}) => { setTimerPop(false); return serial(() => run(() => api('POST', '/timer/stop', body), timerMessage)); };

  const acceptSuggestions = async (all) => {
    const list = all.filter((s) => !inflight.current.has(s.id));
    if (!list.length) return;
    for (const s of list) inflight.current.add(s.id);
    forgetSugg(list);
    const r = await serial(() => run(async () => {
      const keys = [];
      for (const s of list) {
        const res = await api('POST', '/entries', { issue: s.issue, dates: [s.date], minutes: s.minutes });
        keys.push(...(res.keys || []));
      }
      return keys;
    }, (keys) => [`Added ${fmt(list.reduce((a, s) => a + s.minutes, 0))}${list.length > 1 ? ` from ${list.length} suggestions` : ` to ${list[0].issue}`}`, 'info', { label: 'Undo', fn: undoDrafts(keys) }]));
    for (const s of list) inflight.current.delete(s.id);
    if (!r) loadSugg(week.monday);
  };
  const dismissSuggestion = (s) => {
    forgetSugg([s]);
    api('POST', '/suggestions/dismiss', { id: s.id }).catch(() => {});
  };

  // ---- dock: one line in, one action out ----
  const parsed = parseQuick(q, { dates, today, issues: known });
  const tokens = [];
  let action = null;
  let qType;
  let canonical = null;
  if (parsed) {
    const lk = parsed.issue && !parsed.issueKnown ? lookups[parsed.issue.toLowerCase()] : null;
    const issueOk = !!parsed.issue && (parsed.issueKnown || (lk && lk.ok));
    canonical = parsed.issue && lk && lk.ok ? lk.issue.idReadable : parsed.issue;
    const summary = parsed.summary || (lk && lk.ok ? lk.issue.summary : '');
    if (!parsed.issue) tokens.push({ label: 'Which issue?', sub: parsed.ambiguous ? 'several titles match' : 'an ID or words from its title', cls: 'err' });
    else if (issueOk) tokens.push({ label: canonical, sub: summary, cls: 'issue', mono: true });
    else if (lk && !lk.ok) tokens.push({ label: parsed.issue, sub: lk.error, cls: 'err', mono: true });
    else tokens.push({ label: parsed.issue, sub: 'looking it up…', cls: '', mono: true });

    const hasTime = parsed.minutes > 0 && parsed.minutes <= 1440;
    if (hasTime) tokens.push({ label: fmt(parsed.minutes), sub: parsed.range || '', cls: 'ok' });

    if (parsed.dayError) tokens.push({ label: 'Which day?', sub: parsed.dayError, cls: 'err' });
    else if (hasTime) {
      const ds = parsed.dates;
      const label = ds.length > 1 ? `${DOW[weekdayIndex(ds[0])]}–${DOW[weekdayIndex(ds[ds.length - 1])]}` : ds[0] === today ? 'Today' : ds[0] === addDays(today, -1) ? 'Yesterday' : shortDay(ds[0]);
      const outside = ds.some((d) => !dates.includes(d));
      tokens.push({ label, sub: ds.length > 1 ? plural(ds.length, 'item', 'items') : outside ? 'another week' : '', cls: outside ? 'warn' : '' });
    }

    let typeErr = false;
    if (issueOk) {
      const types = typesFor(canonical);
      if (parsed.type) {
        const t = resolveTypeName(parsed.type, types);
        if (t.error) { typeErr = true; tokens.push({ label: `#${parsed.type}`, sub: t.error, cls: 'err' }); } else { qType = t.name; tokens.push({ label: t.name, sub: '', cls: '' }); }
      } else {
        const def = defaultTypeFor(canonical);
        if (def) tokens.push({ label: def, sub: '', cls: 'quiet' });
      }
    }
    if (parsed.note) tokens.push({ label: `“${parsed.note}”`, sub: '', cls: 'quiet' });
    if (issueOk && hasTime && parsed.dates) {
      const dup = parsed.dates.filter((d) => sum(liveOf(cellEntries(canonical, d))) > 0);
      if (dup.length) tokens.push({ label: `adds to ${dup.map((d) => DOW[weekdayIndex(d)]).join(', ')}`, sub: '', cls: 'warn' });
    }
    if (issueOk && !typeErr && !parsed.dayError && hasTime && parsed.dates) action = 'log';
    else if (issueOk && !typeErr && !parsed.minutes && !parsed.range) action = 'start';
  }

  const submitDock = async () => {
    if (!parsed || dockBusy.current) return;
    const p = parsed;
    if (action !== 'log' && action !== 'start') {
      const bad = tokens.find((t) => t.cls === 'err');
      flash(bad ? `${bad.label} ${bad.sub}` : 'Add a time, like 1h30 or 90m.', 'error');
      return;
    }
    dockBusy.current = true;
    const line = q;
    setQ('');
    let r;
    if (action === 'start') {
      const extra = {};
      if (p.note) extra.text = p.note;
      if (qType) extra.type = qType;
      r = await startTimer(canonical, extra);
    } else {
      const body = { issue: canonical, dates: p.dates, minutes: p.minutes, text: p.note };
      if (qType) body.type = qType;
      r = await serial(() => run(() => api('POST', '/entries', body), (res) => {
        const outside = p.dates.some((d) => !dates.includes(d));
        return [`Logged ${fmt(p.minutes)}${p.dates.length > 1 ? ` × ${p.dates.length}` : ''} to ${res.issue.idReadable}${outside ? ' (another week)' : ''}`, 'info', { label: 'Undo', fn: undoDrafts(res.keys || []) }];
      }));
    }
    dockBusy.current = false;
    if (!r) setQ((cur) => cur || line); // give the line back if it didn't go through
  };

  // ---- week figures ----
  const weekTitle = isThisWeek ? 'This week'
    : week.monday === addDays(thisMonday, -7) ? 'Last week'
      : week.monday === addDays(thisMonday, 7) ? 'Next week'
        : `${dayNum(week.monday)} ${monthName(week.monday)}`;
  const weekTarget = target * dates.filter(isWorkDay).length;
  const longRun = timer && (timerDate < today || now - timer.startedAt > 10 * 3600 * 1000);
  // A forgotten timer can stop at the end of the day it started, or at midnight if it started later.
  let trim = null;
  if (timer) {
    const dayEnd = localDateTimeMs(timerDate, settings.dayEnds);
    const day = timerDate === today ? '' : ` ${DOW[weekdayIndex(timerDate)]}`;
    if (dayEnd > timer.startedAt && dayEnd < now) trim = { at: dayEnd, label: `Stop at ${settings.dayEnds}${day}` };
    else if (timerDate < today) trim = { at: localDateTimeMs(addDays(timerDate, 1), '00:00'), label: `Stop at midnight${day}` };
  }

  const heads = cols.map((d) => {
    const i = dates.indexOf(d);
    const t = dayTotals[i];
    const shown = t + runningOn(d);
    let st = 'future';
    let title = '';
    if (!isWorkDay(d)) { st = 'off'; title = 'Day off'; } else if (d === today) { st = 'today'; title = `${fmt(shown)} so far of ${fmt(target)}`; } else if (d < today) {
      if (t >= target) { st = 'ok'; title = `${fmt(t)} · target reached`; } else { st = 'under'; title = `${fmt(t)} of ${fmt(target)} · ${fmt(target - t)} short`; }
    }
    const pct = target ? Math.min(100, Math.round((shown / target) * 100)) : 0;
    return { d, st, title, pct, total: t, shown };
  });

  return html`<div class="app">
    <header class="top">
      <${Glass} class="seg weeknav" bezel=${14} scale=${26}>
        <button class="seg-btn" aria-label="Previous week" onClick=${() => go(addDays(week.monday, -7))}><${Icon} name="left" size=${18} /></button>
        <button class="seg-btn seg-label" onClick=${() => go(today)} disabled=${isThisWeek} title=${isThisWeek ? rangeLabel(dates) : 'Back to this week'}>${weekTitle}</button>
        <button class="seg-btn" aria-label="Next week" onClick=${() => go(addDays(week.monday, 7))}><${Icon} name="right" size=${18} /></button>
      <//>
      <span class="grow"></span>
      <${Glass} as="button" class="round" bezel=${12} scale=${22} aria-label="Settings" title="Settings" onClick=${() => setSheet('settings')}><${Icon} name="gear" size=${18} /><//>
    </header>

    <main class="page">
      <${Hero} total=${weekTotal} target=${weekTarget} range=${rangeLabel(dates)} pending=${week.pending} ytError=${week.ytError}
        onRetry=${() => load(week.monday, true)} />

      <section class="paper" aria-label="Week">
        <${WeekGrid}
          cols=${cols} heads=${heads} today=${today} rowIds=${rowIds} ghostIds=${ghostIds}
          isWorkDay=${isWorkDay} cellEntries=${cellEntries} liveOf=${liveOf} sum=${sum} runningOn=${runningOn}
          issueInfo=${issueInfo} ytLink=${ytLink} timer=${timer}
          suggAt=${suggAt} suggestions=${suggestions} edit=${edit} rows=${week.rows}
          onOpen=${openEditor}
          onAccept=${acceptSuggestions} onDismiss=${dismissSuggestion}
          onTimer=${(id) => (timer && timer.issue === id ? stopTimer({}) : startTimer(id))}
          onRemoveRow=${(id) => run(() => api('POST', '/rows', { monday: week.monday, action: 'remove', issue: id }))}
          adding=${adding} setAdding=${setAdding}
          onAddRow=${(i) => { setAdding(false); run(() => api('POST', '/rows', { monday: week.monday, action: 'add', issue: i.idReadable }), `${i.idReadable} added`); }}
          onCopyLast=${isThisWeek || week.monday > thisMonday ? () => run(
            () => api('POST', '/rows', { monday: week.monday, action: 'copy-previous' }),
            (r) => (r.added.length ? `Added ${r.added.join(', ')}` : 'Nothing new to copy') + (r.skipped.length ? ` · skipped ${r.skipped.join(', ')} (resolved)` : ''),
          ) : null}
        />
        ${sugg.errors.length ? html`<p class="paper-note">Couldn't read all of your YouTrack activity: ${sugg.errors[0]}</p>` : null}
      </section>
    </main>

    <div class="edge" aria-hidden="true"></div>

    <${Dock}
      q=${q} setQ=${setQ} tokens=${tokens} action=${action} onSubmit=${submitDock}
      timer=${timer} now=${now} longRun=${longRun} issueInfo=${issueInfo}
      pending=${week.pending} onSubmitWeek=${() => { setEdit(null); setSheet('submit'); }}
      timerPop=${timerPop} setTimerPop=${(v) => { if (v) setEdit(null); setTimerPop(v); }}
      onStop=${stopTimer} trim=${trim} timerDate=${timerDate} today=${today}
    />

    ${edit ? html`<${Popover} key=${edit.issue + edit.date} anchorId=${cellId(edit.issue, edit.date)} onDismiss=${() => closeEditor(true)} onEscape=${() => closeEditor(false, true)}>
      <${CellEditor}
        api=${editorRef}
        issue=${edit.issue} date=${edit.date} initial=${edit.initial}
        info=${issueInfo(edit.issue)} ytLink=${ytLink(edit.issue)}
        entries=${cellEntries(edit.issue, edit.date)} liveOf=${liveOf} sum=${sum}
        types=${typesFor(edit.issue) || []} defType=${defaultTypeFor(edit.issue)}
        suggestion=${suggAt(edit.issue, edit.date)}
        timerHere=${!!timer && timer.issue === edit.issue}
        onCommit=${(text, extra) => commitCell(edit.issue, edit.date, text, extra)}
        onMove=${(key, shift, text, extra) => {
          const cur = edit;
          const next = nextCell(cur.issue, cur.date, key, shift);
          if (next) openEditor(next.issue, next.date);
          else { setEdit(null); focusCell(cur); }
          return commitCell(cur.issue, cur.date, text, extra);
        }}
        onClose=${(commit) => closeEditor(commit, true)}
        onPatch=${(e, c) => serial(() => run(() => patchRaw(e, c)))}
        onRemove=${(e) => serial(() => run(() => removeRaw(e), e.status === 'draft' ? 'Removed' : 'Will be removed when you submit'))}
        onRestore=${(e) => serial(() => run(() => restoreRaw(e), 'Kept'))}
        onTimer=${() => { setEdit(null); startTimer(edit.issue); }}
      />
    <//>` : null}

    ${sheet === 'submit' ? html`<${SubmitSheet}
      week=${week} heads=${heads} target=${target} timer=${timer} timerMin=${timerMin}
      typesFor=${typesFor} issueInfo=${issueInfo} suggestions=${suggestions}
      onStopTimer=${() => api('POST', '/timer/stop', {})}
      onAcceptSuggestions=${() => { setSheet(null); acceptSuggestions(suggestions); }}
      onClose=${() => setSheet(null)}
      onFinished=${() => { reload(); loadSugg(week.monday); }}
      onUnauthorized=${onUnauthorized}
    />` : null}
    ${sheet === 'settings' ? html`<${SettingsSheet}
      week=${week} status=${status}
      onClose=${() => setSheet(null)}
      onSaved=${() => { setSheet(null); reload(); flash('Settings saved'); }}
      onReload=${async () => { setSheet(null); await api('POST', '/refresh').catch(() => {}); await load(week.monday, true); loadSugg(week.monday); flash('Reloaded from YouTrack'); }}
      onReconnect=${() => { setSheet(null); onReconnect(); }}
    />` : null}
    ${toast ? html`<div class="toast-wrap" key=${toast.id}>
      <${Glass} class=${'toast' + (toast.kind === 'error' ? ' err' : '')} refract=${false} role="status">
        <span>${toast.msg}</span>
        ${toast.action ? html`<button class="toast-act" onClick=${toast.action.fn}>${toast.action.label}</button>` : null}
      <//>
    </div>` : null}
  </div>`;
}

// ---------- hero ----------

function Hero({ total, target, range, pending, ytError, onRetry }) {
  const shown = useTween(total);
  const pct = target ? Math.min(100, (total / target) * 100) : 0;
  return html`<section class="hero" aria-label="Week total">
    <div class="hero-range">${range}</div>
    <div class="hero-total" aria-live="polite">
      <span class="hero-num">${fmt(Math.round(shown))}</span>
      ${target ? html`<span class="hero-of">of ${fmt(target)}</span>` : null}
    </div>
    <div class="hero-meter" aria-hidden="true"><i style=${{ width: pct + '%' }}></i></div>
    ${ytError
      ? html`<div class="hero-note warn"><${Icon} name="warn" size=${14} /> YouTrack didn't answer, so you see drafts only. <button class="link" onClick=${onRetry}>Try again</button></div>`
      : !pending && total > 0 ? html`<div class="hero-note ok"><${Icon} name="check" size=${14} stroke=${2.4} /> All in YouTrack</div>` : null}
  </section>`;
}

// ---------- the week ----------

function WeekGrid(p) {
  const { cols, heads, today, rowIds, ghostIds, isWorkDay, cellEntries, liveOf, sum, issueInfo, ytLink, timer, runningOn, suggAt, suggestions, edit } = p;
  const template = {
    '--cols': `minmax(var(--issue-w, 200px), 1fr) repeat(${cols.length}, minmax(var(--day-w, 78px), 108px)) var(--total-w, 80px)`,
    '--min': `calc(var(--issue-w, 200px) + ${cols.length} * var(--day-w, 78px) + var(--total-w, 80px))`,
  };
  const empty = !rowIds.length && !ghostIds.length;

  const cell = (id, d, ghostRow) => {
    const here = cellEntries(id, d);
    const lv = liveOf(here);
    const min = sum(lv);
    const pending = here.some((e) => e.status !== 'synced');
    const failed = here.some((e) => e.error);
    const removed = here.length && !lv.length;
    const running = timer && timer.issue === id && runningOn(d) > 0;
    const s = !min && !removed ? suggAt(id, d) : null;
    const isEdit = edit && edit.issue === id && edit.date === d;
    const cls = ['cell', d === today ? 'today' : '', isWorkDay(d) ? '' : 'off', isEdit ? 'editing' : ''].join(' ');
    const keys = (e) => {
      if (/^[0-9.:]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Already open: move focus into the editor so this keystroke lands there.
        if (isEdit) { focusEditor(); return; }
        e.preventDefault();
        p.onOpen(id, d, e.key);
        return;
      }
      const ks = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
      if (!ks) return;
      const all = [...rowIds, ...ghostIds];
      const r = all.indexOf(id) + ks[0];
      const c = cols.indexOf(d) + ks[1];
      if (r < 0 || r >= all.length || c < 0 || c >= cols.length) return;
      const n = document.getElementById(cellId(all[r], cols[c]));
      if (n) { e.preventDefault(); n.focus(); }
    };
    if (s) {
      return html`<div class=${cls + ' has-ghost'} key=${d} role="gridcell">
        <button id=${cellId(id, d)} class="ghost" onClick=${() => p.onAccept([s])}
          onKeyDown=${keys}
          title=${`Suggested from ${s.title} (${s.when}). Click to add.`}
          aria-label=${`${id}, ${dayLabel(d)}: suggested ${fmt(s.minutes)} from ${s.title}. Press to add.`}>
          <${Icon} name="sparkle" size=${11} stroke=${2} />${fmt(s.minutes)}
        </button>
        <button class="ghost-x" aria-label=${`Dismiss the suggestion for ${id} on ${dayLabel(d)}`} title="Dismiss" onClick=${() => p.onDismiss(s)}><${Icon} name="x" size=${11} stroke=${2.4} /></button>
      </div>`;
    }
    const label = min > 0 ? fmt(min) : removed ? fmt(sum(here)) : '';
    const aria = `${id}, ${dayLabel(d)}: ${min > 0 ? fmt(min) : 'no time'}${pending && !removed ? ', not sent yet' : ''}${removed ? ', will be removed' : ''}${failed ? ', last send failed' : ''}`;
    return html`<div class=${cls} key=${d} role="gridcell">
      <button id=${cellId(id, d)} class=${'cbtn' + (pending && min > 0 ? ' pending' : '') + (removed ? ' removed' : '') + (failed ? ' failed' : '') + (ghostRow ? ' quiet' : '')}
        onClick=${() => (isEdit ? focusEditor() : p.onOpen(id, d))} aria-label=${aria}
        onKeyDown=${keys}>
        ${running && !label ? html`<span class="run"><span class="pulse" aria-hidden="true"></span>${fmt(Math.max(1, Math.round(runningOn(d))))}</span>` : null}
        ${running && label ? html`<span class="pulse" aria-hidden="true"></span>` : null}
        ${label ? html`<span class="v">${label}</span>` : running ? null : html`<span class="plus" aria-hidden="true">+</span>`}
        ${(pending && min > 0) || failed ? html`<i class=${'mark-dot' + (failed ? ' err' : '')} aria-hidden="true"></i>` : null}
      </button>
    </div>`;
  };

  const row = (id, ghost) => {
    const info = issueInfo(id);
    const timerHere = !!timer && timer.issue === id;
    let total = 0;
    let hasItems = false;
    for (const d of cols) { const here = cellEntries(id, d); if (here.length) hasItems = true; total += sum(liveOf(here)); }
    const removable = !ghost && p.rows.includes(id) && !hasItems && !timerHere;
    return html`<div class=${'wrow' + (ghost ? ' ghost-row' : '') + (timerHere ? ' timing' : '')} key=${id} role="row">
      <div class="issue" role="rowheader">
        <button class=${'play' + (timerHere ? ' on' : '')} onClick=${() => p.onTimer(id)}
          aria-label=${timerHere ? `Stop the timer on ${id}` : `Start a timer on ${id}`} title=${timerHere ? 'Stop the timer' : 'Start a timer'}>
          <${Icon} name=${timerHere ? 'stop' : 'play'} size=${12} />
        </button>
        <div class="imeta">
          <a class="ikey" href=${ytLink(id)} target="_blank" rel="noopener noreferrer" title="Open in YouTrack">${id}</a>
          <span class="isum" title=${info.summary}>${info.summary || (info.missing ? "Can't open this issue" : '—')}</span>
        </div>
        ${removable ? html`<button class="row-x" aria-label=${`Remove ${id} from this week`} title="Remove row" onClick=${() => p.onRemoveRow(id)}><${Icon} name="x" size=${12} stroke=${2.2} /></button>` : null}
      </div>
      ${cols.map((d) => cell(id, d, ghost))}
      <div class="rtotal">${total ? fmt(total) : ''}</div>
    </div>`;
  };

  const ghostTotal = suggestions.reduce((a, s) => a + s.minutes, 0);

  return html`<div class="wgrid-scroll">
    <div class="wgrid" role="grid" aria-label="Time per issue and day" style=${template}>
      <div class="wrow ghead" role="row">
        <div class="hcell" role="columnheader"><span class="sr">Issue</span></div>
        ${heads.map((h) => html`<div key=${h.d} class=${`dh st-${h.st}`} role="columnheader" title=${h.title}
          aria-label=${`${dayLabel(h.d)}${h.st === 'today' ? ', today' : ''}. ${h.title || fmt(h.total)}`}>
          <div class="dh-name"><span>${DOW[weekdayIndex(h.d)]}</span> ${dayNum(h.d)}</div>
          <div class="dh-total">${h.st === 'off' && !h.total ? 'off' : h.shown ? fmt(Math.round(h.shown)) : '–'}${h.st === 'ok' ? html` <${Icon} name="check" size=${11} stroke=${2.6} />` : null}</div>
          ${h.st !== 'off' ? html`<div class="meter" aria-hidden="true"><i style=${{ width: h.pct + '%' }}></i></div>` : html`<div class="meter none" aria-hidden="true"></div>`}
        </div>`)}
        <div class="hcell end" role="columnheader">Total</div>
      </div>
      ${rowIds.map((id) => row(id, false))}
      ${ghostIds.length ? html`<div class="wrow section" role="row" key="sugg-head">
        <div class="section-label" role="rowheader"><${Icon} name="sparkle" size=${13} /> From your YouTrack activity</div>
        <div class="section-act">
          <button class="link" onClick=${() => p.onAccept(suggestions)}>Add all · ${fmt(ghostTotal)}</button>
        </div>
      </div>` : null}
      ${ghostIds.map((id) => row(id, true))}
      <div class="wrow addline" role="row" key="add">
        ${p.adding
          ? html`<${AddIssue} onClose=${() => p.setAdding(false)} onPick=${p.onAddRow} exclude=${rowIds} />`
          : html`<button class="add-btn" onClick=${() => p.setAdding(true)}><${Icon} name="plus" size=${14} /> Add issue</button>`}
      </div>
    </div>
    ${empty ? html`<div class="empty">
      <p>Nothing logged this week yet.</p>
      <div class="empty-acts">
        ${p.onCopyLast ? html`<button class="btn" onClick=${p.onCopyLast}><${Icon} name="copy" size=${14} /> Start from last week's issues</button>` : null}
      </div>
      <p class="hint">Or type below: <span class="mono">APP-1207 1h30 review</span></p>
    </div>` : null}
  </div>`;
}

function AddIssue({ onClose, onPick, exclude }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.focus(); }, []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api('GET', '/issues/search?q=' + enc(q.trim()))
        .then((r) => { if (alive) { setList((r.issues || []).filter((i) => !exclude.includes(i.idReadable))); setErr(''); setHi(0); } })
        .catch((e) => { if (alive) setErr(e.message); });
    }, q ? 280 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const items = (list || []).slice(0, 8);
  return html`<div class="addissue">
    <div class="addissue-field">
      <${Icon} name="search" size=${15} />
      <input id="rowq" ref=${ref} value=${q} placeholder="Find an issue: ID or a few words" autocomplete="off" aria-label="Find an issue to add"
        onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, items.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); } else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); onPick(items[hi]); }
        }} />
      <button class="btn btn-quiet btn-sm" onClick=${onClose}>Cancel</button>
    </div>
    <div class="results" role="listbox" aria-label="Issues">
      ${err ? html`<div class="err-line">${err}</div>` : null}
      ${list === null ? html`<div class="muted small pad">Searching…</div>`
        : items.length ? items.map((i, n) => html`<button key=${i.idReadable} role="option" aria-selected=${n === hi} class=${'result' + (n === hi ? ' hi' : '')} onClick=${() => onPick(i)} onMouseEnter=${() => setHi(n)}>
          <span class="mono">${i.idReadable}</span><span class="ell">${i.summary}</span></button>`)
          : html`<div class="muted small pad">No issues match.</div>`}
    </div>
  </div>`;
}

// ---------- popover + cell editor ----------

function Popover({ anchorId, onDismiss, onEscape, children, width = 340 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const posRef = useRef(null);
  const place = () => {
    const a = document.getElementById(anchorId);
    const el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 24);
    const h = el.offsetHeight;
    const dock = 104;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.round(Math.max(12, Math.min(left, window.innerWidth - w - 12)));
    let top = r.bottom + 8;
    let below = true;
    if (top + h > window.innerHeight - dock && r.top - h - 8 > 12) { top = r.top - h - 8; below = false; }
    const next = { left, top: Math.round(Math.max(12, top)), w, below, ox: Math.round(r.left + r.width / 2 - left) };
    const prev = posRef.current;
    if (prev && prev.left === next.left && prev.top === next.top && prev.w === next.w && prev.below === next.below) return;
    posRef.current = next;
    setPos(next);
  };
  // Re-place after every render: the cell can move when the week around it changes.
  useLayoutEffect(place);
  useLayoutEffect(() => {
    const onMove = () => requestAnimationFrame(place);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onMove) : null;
    if (ro) { if (ref.current) ro.observe(ref.current); const pg = document.querySelector('.page'); if (pg) ro.observe(pg); }
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      const a = document.getElementById(anchorId);
      if (a && a.contains(e.target)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    // Whatever the editor shows, keyboard focus starts inside it.
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('pointerdown', onDown, true);
      if (ro) ro.disconnect();
    };
  }, [anchorId]);
  const style = pos
    ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.w + 'px', transformOrigin: `${pos.ox}px ${pos.below ? '0' : '100%'}` }
    // Not visibility:hidden: the editor inside must be focusable before it's placed.
    : { opacity: 0, pointerEvents: 'none', left: '0px', top: '0px', width: width + 'px' };
  return html`<div class="popover glass glass-strong" ref=${ref} style=${style} role="dialog" aria-label="Edit time" tabindex="-1"
    onKeyDown=${(e) => { if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); } }}>${children}</div>`;
}

const STATUS_TEXT = { synced: 'In YouTrack', draft: 'Not sent yet', edited: 'Changed · not sent yet', deleted: 'Will be removed when you submit' };
const BAD_TIME = 'Use 1.5, 1h30, 90m or 1:30.';

function CellEditor(props) {
  const { issue, date, initial, info, ytLink, entries, liveOf, sum, types, defType, timerHere } = props;
  const lv = liveOf(entries);
  const cur = sum(lv);
  const single = entries.length <= 1;
  const item = single ? entries[0] || null : null;
  const hasInitial = initial !== null && initial !== undefined;
  // Frozen when the editor opens: a suggestion that disappears later must not turn into a log.
  const [suggestion] = useState(props.suggestion || null);
  const [offered] = useState(() => !item && !!suggestion && !hasInitial);
  const [start] = useState(() => (hasInitial ? initial : cur ? fmt(cur) : offered ? fmt(suggestion.minutes) : ''));
  const [text, setText] = useState(start);
  const [type, setType] = useState(item ? item.type || '' : '');
  const [note, setNote] = useState(item ? item.text || '' : '');
  const [err, setErr] = useState('');
  const textRef = useRef(text);
  const typeRef = useRef(type);
  const noteRef = useRef(note);
  textRef.current = text;
  typeRef.current = type;
  noteRef.current = note;
  const done = useRef(false);
  const cancelled = useRef(false);
  const touched = useRef(false);
  const typeTouched = useRef(false);
  const explicit = useRef(false);
  const savedNote = useRef(item ? item.text || '' : '');
  const flushers = useRef(new Set());
  const input = useRef(null);

  // New time: '' keeps the project's default, '-' means no type.
  const typeValue = () => {
    if (!typeTouched.current) return undefined;
    if (typeRef.current === '-') return null;
    if (typeRef.current === '') return defType ? undefined : null;
    return typeRef.current;
  };
  const extra = () => (item ? {} : { type: typeValue(), text: noteRef.current.trim() });
  // A suggested value only counts once you touch it or press Enter.
  const value = () => (offered && !touched.current && !explicit.current ? '' : textRef.current);
  const validate = () => {
    const m = parseDuration(value());
    if (m === null || m > 1440) { setErr(BAD_TIME); if (input.current) input.current.focus(); return false; }
    return true;
  };
  const flushNote = () => {
    if (!item || item.status === 'deleted' || cancelled.current) return;
    if (noteRef.current === savedNote.current) return;
    savedNote.current = noteRef.current;
    props.onPatch(item, { text: noteRef.current });
  };
  const commit = async () => {
    if (done.current) return true;
    done.current = true;
    if (!single) { for (const f of flushers.current) f(); return true; }
    flushNote();
    if (item && item.status === 'deleted') return true;
    return props.onCommit(value(), extra());
  };
  const cancel = () => { cancelled.current = true; done.current = true; };
  props.api.current = { commit, cancel };

  useLayoutEffect(() => {
    const el = input.current;
    if (el) { el.focus(); if (hasInitial) { const n = el.value.length; el.setSelectionRange(n, n); } else el.select(); }
  }, []);

  const keys = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      explicit.current = true;
      if (validate()) props.onClose(true);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); props.onClose(false); return; }
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!validate()) return;
      done.current = true;
      flushNote();
      props.onMove(e.key, e.shiftKey, value(), extra());
    }
  };
  const bump = (d) => {
    const m = parseDuration(text);
    const nm = Math.max(0, (m || 0) + d);
    touched.current = true;
    setErr('');
    setText(nm ? fmt(nm) : '0');
    if (input.current) input.current.focus();
  };

  const head = html`<div class="ed-head">
    <div class="ed-title">
      <a class="ikey" href=${ytLink} target="_blank" rel="noopener noreferrer">${issue}</a>
      <span class="ed-day">${dayLabel(date)}</span>
    </div>
    <button class="icon-btn" aria-label="Close" onClick=${() => props.onClose(true)}><${Icon} name="x" size=${14} stroke=${2.2} /></button>
  </div>
  ${info.summary ? html`<div class="ed-sum">${info.summary}</div>` : null}`;

  if (!single) {
    const register = (f) => { flushers.current.add(f); return () => flushers.current.delete(f); };
    return html`<div class="editor">
      ${head}
      <div class="ed-list">
        ${entries.map((e) => html`<${ItemRow} key=${e.key} e=${e} types=${types} cancelled=${cancelled} register=${register}
          onPatch=${props.onPatch} onRemove=${props.onRemove} onRestore=${props.onRestore} />`)}
      </div>
      <div class="ed-foot">
        <span class="muted small">${plural(lv.length, 'work item', 'work items')} · ${fmt(cur)}</span>
        <span class="grow"></span>
        <button class="btn btn-sm" onClick=${props.onTimer} disabled=${timerHere}><${Icon} name="play" size=${12} /> Timer</button>
      </div>
    </div>`;
  }

  const removed = item && item.status === 'deleted';
  return html`<div class="editor">
    ${head}
    ${removed
      ? html`<div class="ed-removed"><s>${fmt(item.minutes)}</s> ${STATUS_TEXT.deleted}. <button class="link" onClick=${() => { cancel(); props.onRestore(item); props.onClose(false); }}>Keep it</button></div>`
      : html`
        <div class="ed-time">
          <input ref=${input} class=${'ed-input' + (err ? ' bad' : '')} value=${text} aria-label="Time" placeholder="0h" aria-invalid=${!!err}
            onInput=${(e) => { touched.current = true; setErr(''); setText(e.target.value); }} onKeyDown=${keys} autocomplete="off" spellcheck=${false} />
          <div class="stepper" role="group" aria-label="Adjust by 15 minutes">
            <button class="icon-btn" aria-label="15 minutes less" onClick=${() => bump(-15)}>−</button>
            <button class="icon-btn" aria-label="15 minutes more" onClick=${() => bump(15)}>+</button>
          </div>
        </div>
        ${err ? html`<div class="err-line" role="alert">${err}</div>` : null}
        ${offered ? html`<div class="ed-hint"><${Icon} name="sparkle" size=${12} /> Suggested from ${suggestion.title}, ${suggestion.when}. Enter adds it.</div>` : null}
        ${types.length ? html`<label class="ed-row"><span>Type</span>
          <select value=${type} onChange=${(e) => {
            typeTouched.current = true;
            setType(e.target.value);
            if (item) props.onPatch(item, { type: e.target.value || null });
          }}>
            ${item
              ? html`<option value="">No type</option>`
              : defType ? html`<option value="">${defType} (default)</option><option value="-">No type</option>` : html`<option value="">No type</option>`}
            ${types.map((t) => html`<option value=${t}>${t}</option>`)}
          </select></label>` : null}
        <label class="ed-row"><span>Note</span>
          <input value=${note} placeholder="What did you do?" onInput=${(e) => setNote(e.target.value)}
            onKeyDown=${(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              explicit.current = true;
              if (validate()) props.onClose(true);
            }}
            onBlur=${() => { if (!done.current) flushNote(); }} />
        </label>
        ${item && item.error ? html`<div class="err-line">Couldn't send: ${item.error}</div>` : null}
        <div class="ed-foot">
          <span class=${'ed-status s-' + (item ? item.status : 'new')}>${item ? STATUS_TEXT[item.status] : 'Enter to log · Tab for the next day'}</span>
          <span class="grow"></span>
          ${item ? html`<button class="btn btn-sm btn-quiet danger" onClick=${() => { cancel(); props.onRemove(item); props.onClose(false); }}>Remove</button>` : null}
          <button class="btn btn-sm" onClick=${props.onTimer} disabled=${timerHere} title="Start a timer on this issue"><${Icon} name="play" size=${12} /> Timer</button>
        </div>`}
  </div>`;
}

function ItemRow({ e, types, cancelled, register, onPatch, onRemove, onRestore }) {
  const [t, setT] = useState(fmt(e.minutes));
  const [note, setNote] = useState(e.text || '');
  const tRef = useRef(t);
  const noteRef = useRef(note);
  tRef.current = t;
  noteRef.current = note;
  const saved = useRef({ minutes: e.minutes, text: e.text || '' });
  useEffect(() => {
    setT(fmt(e.minutes));
    setNote(e.text || '');
    saved.current = { minutes: e.minutes, text: e.text || '' };
  }, [e.key, e.minutes, e.text]);
  const saveTime = () => {
    if (cancelled.current || e.status === 'deleted') return;
    const m = parseDuration(tRef.current);
    if (m === null || m > 1440) { setT(fmt(e.minutes)); return; }
    if (m === saved.current.minutes) return;
    saved.current.minutes = m;
    if (m === 0) onRemove(e); else onPatch(e, { minutes: m });
  };
  const saveNote = () => {
    if (cancelled.current || e.status === 'deleted') return;
    if (noteRef.current === saved.current.text) return;
    saved.current.text = noteRef.current;
    onPatch(e, { text: noteRef.current });
  };
  useEffect(() => register(() => { saveTime(); saveNote(); }), []);
  if (e.status === 'deleted') {
    return html`<div class="item removed"><s>${fmt(e.minutes)}</s><span class="muted small ell">${e.text || e.type || ''}</span><button class="link" onClick=${() => onRestore(e)}>Keep</button></div>`;
  }
  return html`<div class=${'item' + (e.error ? ' failed' : '')}>
    <input class="item-t" value=${t} aria-label="Time" onInput=${(ev) => setT(ev.target.value)} onBlur=${saveTime} onKeyDown=${(ev) => { if (ev.key === 'Enter') ev.target.blur(); }} />
    ${types.length ? html`<select class="item-type" value=${e.type || ''} aria-label="Type" onChange=${(ev) => onPatch(e, { type: ev.target.value || null })}>
      <option value="">No type</option>${types.map((x) => html`<option value=${x}>${x}</option>`)}</select>` : null}
    <input class="item-note" value=${note} placeholder="Note" aria-label="Note" onInput=${(ev) => setNote(ev.target.value)} onBlur=${saveNote} />
    <button class="icon-btn" aria-label="Remove this work item" onClick=${() => onRemove(e)}><${Icon} name="x" size=${12} stroke=${2.2} /></button>
    ${e.status !== 'synced' ? html`<i class=${'mark-dot' + (e.error ? ' err' : '')} title=${e.error || STATUS_TEXT[e.status]}></i>` : null}
  </div>`;
}

// ---------- the dock ----------

function Dock(p) {
  const { q, setQ, tokens, action, timer, now, longRun, issueInfo, pending } = p;
  const dockRef = useRef(null);
  const chipRef = useRef(null);
  const label = action === 'start' ? 'Start' : 'Log';
  return html`<footer class="dock-wrap">
    ${q.trim() ? html`<div class="preview glass glass-strong" aria-live="polite">
      ${tokens.map((t, i) => html`<span key=${i} class=${'tok ' + t.cls}>${t.mono ? html`<span class="mono">${t.label}</span>` : t.label}${t.sub ? html`<span class="tok-sub">${t.sub}</span>` : null}</span>`)}
    </div>` : null}
    ${p.timerPop && timer ? html`<${TimerPop} ...${p} />` : null}
    <div class="dock-row">
      <${Glass} innerRef=${dockRef} class=${'dock' + (timer ? ' has-timer' : '')} bezel=${18} scale=${36} blur=${5} sheen=${true}>
        ${timer
          ? html`<div class=${'chip' + (longRun ? ' long' : '')} ref=${chipRef}>
              <button class="chip-main" onClick=${() => p.setTimerPop(!p.timerPop)} aria-expanded=${p.timerPop} aria-label=${`Timer on ${timer.issue}: ${clock(now - timer.startedAt)}. Options`}>
                <span class="pulse" aria-hidden="true"></span>
                <span class="chip-clock" role="timer">${clock(now - timer.startedAt)}</span>
                <span class="chip-issue mono">${timer.issue}</span>
              </button>
              <button class="chip-stop" aria-label="Stop the timer" title="Stop" onClick=${() => p.onStop({})}><${Icon} name="stop" size=${12} /></button>
            </div>`
          : html`<span class="dock-glyph" aria-hidden="true"><${Icon} name="clock" size=${19} stroke=${1.8} /></span>`}
        <label for="qe" class="sr">Log time: issue, time, day, #type, note</label>
        <input id="qe" class="dock-input" value=${q} autocomplete="off" spellcheck=${false}
          placeholder=${timer ? 'Log something else…' : 'What did you work on?'}
          onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); p.onSubmit(); } else if (e.key === 'Escape') setQ(''); }} />
        ${q.trim()
          ? html`<button class=${'dock-act' + (action ? ' ready' : '')} onClick=${p.onSubmit} disabled=${!action}>
              <span class="act-label">${label}</span> <${Icon} name=${action === 'start' ? 'play' : 'enter'} size=${13} />
            </button>`
          : html`<kbd class="dock-kbd" aria-hidden="true">/</kbd>`}
      <//>
      ${pending ? html`<${Glass} as="button" class="submit" bezel=${16} scale=${30} sheen=${true} onClick=${p.onSubmitWeek} aria-label=${`Submit ${plural(pending, 'change', 'changes')} to YouTrack`}>
        <span class="submit-label">Submit</span> <span class="count">${pending}</span>
      <//>` : null}
    </div>
  </footer>`;
}

function TimerPop(p) {
  const { timer, now, issueInfo, trim, timerDate, today, longRun } = p;
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.chip')) p.setTimerPop(false); };
    const onKey = (e) => { if (e.key === 'Escape') p.setTimerPop(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, []);
  const ran = (now - timer.startedAt) / 60000;
  const since = timerDate === today ? hhmm(timer.startedAt) : `${dayLabel(timerDate)}, ${hhmm(timer.startedAt)}`;
  return html`<div class="timerpop glass glass-strong" ref=${ref} role="dialog" aria-label="Timer">
    <div class="tp-head"><span class="mono ikey">${timer.issue}</span><span class="ell">${issueInfo(timer.issue).summary}</span></div>
    <div class=${'tp-since' + (longRun ? ' warn' : '')}>${longRun ? html`<${Icon} name="warn" size=${13} /> ` : null}Running since ${since}${timer.text ? html` · “${timer.text}”` : null}</div>
    <div class="tp-acts">
      ${trim ? html`<button class="btn btn-accent" onClick=${() => p.onStop({ endAt: trim.at })}>${trim.label} · ${fmt(Math.max(1, (trim.at - timer.startedAt) / 60000))}</button>` : null}
      <button class=${'btn' + (trim ? '' : ' btn-accent')} onClick=${() => p.onStop({})}>Stop · ${fmt(Math.max(1, ran))}</button>
      <button class="btn btn-quiet danger" onClick=${() => p.onStop({ discard: true })}>Discard</button>
    </div>
  </div>`;
}

// ---------- sheets ----------

function Sheet({ title, sub, onClose, canClose = true, children, footer, wide }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const prev = document.activeElement;
    if (ref.current) ref.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && canClose) { onClose(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      // Keep keyboard focus inside the sheet while it's open.
      const items = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((n) => !n.disabled && n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const a = document.activeElement;
      if (e.shiftKey && (a === first || a === ref.current)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); } else if (!ref.current.contains(a)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, [canClose]);
  return html`<div class="scrim" onClick=${(e) => { if (e.target === e.currentTarget && canClose) onClose(); }}>
    <div class=${'sheet glass glass-strong' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1" ref=${ref}>
      <div class="sheet-head">
        <div class="grow"><h2 id="sheet-title">${title}</h2>${sub ? html`<div class="sheet-sub">${sub}</div>` : null}</div>
        ${canClose ? html`<button class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="x" size=${16} stroke=${2.2} /></button>` : null}
      </div>
      <div class="sheet-body">${children}</div>
      ${footer ? html`<div class="sheet-foot">${footer}</div>` : null}
    </div>
  </div>`;
}

function SubmitSheet({ week, heads, target, timer, timerMin, typesFor, issueInfo, suggestions, onStopTimer, onAcceptSuggestions, onClose, onFinished, onUnauthorized }) {
  const [st, setSt] = useState({ phase: 'loading', items: [], summaries: {}, results: {}, idx: -1, error: null });
  const loadPending = () => api('GET', '/pending')
    .then((r) => setSt((s) => ({ ...s, phase: 'review', items: r.items || [], summaries: r.summaries || {} })))
    .catch((e) => setSt((s) => ({ ...s, phase: 'error', error: e.message })));
  useEffect(() => { loadPending(); }, []);
  const { phase, items, results, idx } = st;

  const write = async () => {
    const res = {};
    setSt((s) => ({ ...s, phase: 'writing', idx: 0, results: res }));
    for (let i = 0; i < items.length; i++) {
      setSt((s) => ({ ...s, idx: i }));
      let r;
      try {
        r = await api('POST', '/submit/' + enc(items[i].key));
      } catch (e) {
        r = { ok: false, error: e.message };
        if (e.status === 401) { res[items[i].key] = r; setSt((s) => ({ ...s, phase: 'done', results: { ...res } })); onUnauthorized(); return; }
      }
      res[items[i].key] = r;
      setSt((s) => ({ ...s, results: { ...res } }));
    }
    setSt((s) => ({ ...s, phase: 'done', idx: items.length, results: { ...res } }));
    onFinished();
  };

  const checks = [];
  if (phase === 'review') {
    const short = heads.filter((h) => h.st === 'under');
    if (short.length) {
      checks.push({
        kind: 'warn',
        text: `Under ${fmt(target)} on ${short.map((h) => `${DOW[weekdayIndex(h.d)]} (${fmt(h.total)})`).join(', ')}`,
        action: suggestions.length ? `Add ${plural(suggestions.length, 'suggestion', 'suggestions')}` : null,
        act: onAcceptSuggestions,
      });
    }
    if (timer) checks.push({ kind: 'info', text: `Timer running on ${timer.issue} · ${fmt(Math.max(1, timerMin))}`, action: 'Stop and include', act: async () => { await onStopTimer(); onFinished(); loadPending(); } });
    const noType = items.filter((it) => it.change !== 'remove' && !it.type && (typesFor(it.issue) || []).length);
    if (noType.length) checks.push({ kind: 'info', text: `${plural(noType.length, 'item has', 'items have')} no work type` });
    const failedBefore = items.filter((it) => it.error);
    if (failedBefore.length) checks.push({ kind: 'err', text: `${plural(failedBefore.length, 'change', 'changes')} failed last time and will be retried` });
  }

  const okCount = Object.values(results).filter((r) => r && r.ok).length;
  const failCount = Object.values(results).filter((r) => r && !r.ok).length;
  const retried = Object.values(results).filter((r) => r && r.retried).length;
  const n = items.length;
  const minutes = items.filter((i) => i.change !== 'remove').reduce((a, i) => a + i.minutes, 0);

  let title = 'Send to YouTrack';
  let sub = phase === 'review' ? (n ? `${plural(n, 'change', 'changes')} · ${fmt(minutes)}` : 'Nothing to send') : '';
  if (phase === 'writing') { title = 'Sending…'; sub = `${Math.min(idx + 1, n)} of ${n}`; }
  if (phase === 'done') { title = failCount ? 'Sent, with problems' : 'Sent'; sub = failCount ? `${okCount} of ${n} in YouTrack` : `All ${plural(n, 'change', 'changes')} are in YouTrack`; }

  const footer = html`
    ${phase === 'review' ? html`<button class="btn btn-quiet" onClick=${onClose}>Not now</button><button class="btn btn-accent" onClick=${write} disabled=${!n}>Send ${plural(n, 'change', 'changes')}</button>` : null}
    ${phase === 'writing' ? html`<button class="btn btn-accent" disabled>Sending…</button>` : null}
    ${phase === 'done' || phase === 'error' ? html`<a class="btn btn-quiet" href=${week.url + '/timesheets'} target="_blank" rel="noopener noreferrer">YouTrack timesheets <${Icon} name="external" size=${12} /></a><button class="btn btn-accent" onClick=${onClose}>Done</button>` : null}`;

  return html`<${Sheet} title=${title} sub=${sub} onClose=${onClose} canClose=${phase !== 'writing'} footer=${footer} wide>
    ${phase === 'loading' ? html`<div class="pad center"><span class="spinner"></span></div>` : null}
    ${phase === 'error' ? html`<p class="err-line">${st.error}</p>` : null}
    ${phase === 'done' ? html`<div class=${'donebox' + (failCount ? ' warn' : '')}>
      <span class="done-ic"><${Icon} name=${failCount ? 'warn' : 'check'} size=${18} stroke=${2.4} /></span>
      <div>${failCount ? 'Failed changes stay here with the reason. Fix them and send again.' : 'Your week is in YouTrack.'}${retried ? ` ${plural(retried, 'write was', 'writes were')} retried after a network error, without duplicates.` : ''}</div>
    </div>` : null}
    ${phase === 'writing' ? html`<div class="progress"><i style=${{ width: Math.round((Math.min(idx, n) / Math.max(1, n)) * 100) + '%' }}></i></div>` : null}
    ${checks.length ? html`<div class="checks">${checks.map((c, i) => html`<div class=${'check c-' + c.kind} key=${i}>
      <span class="check-dot" aria-hidden="true"></span>
      <span class="grow">${c.text}</span>
      ${c.action ? html`<button class="btn btn-sm" onClick=${c.act}>${c.action}</button>` : null}
    </div>`)}</div>` : null}
    ${n ? html`<div class="changes">
      ${items.map((it, i) => {
        const r = results[it.key];
        let state = 'queued';
        if (r) state = r.ok ? 'done' : 'failed';
        else if (phase === 'writing' && i === idx) state = 'writing';
        const summary = st.summaries[it.issue] || issueInfo(it.issue).summary || '';
        return html`<div class=${'change s-' + state} key=${it.key}>
          <span class="change-state" aria-label=${{ queued: 'Waiting', writing: 'Sending', done: 'Sent', failed: 'Failed' }[state]}>
            ${state === 'writing' ? html`<span class="spinner sm"></span>` : state === 'done' ? html`<${Icon} name="check" size=${14} stroke=${2.6} />` : state === 'failed' ? html`<${Icon} name="x" size=${14} stroke=${2.6} />` : html`<i></i>`}
          </span>
          <span class="change-main">
            <span class="ell"><span class="mono">${it.issue}</span> <span class="muted">${it.text || summary}</span></span>
            ${state === 'failed' ? html`<span class="err-text">${r.error}</span>` : !r && it.error ? html`<span class="err-text">Last time: ${it.error}</span>` : null}
            ${r && r.dropped ? html`<span class="muted small">Already deleted in YouTrack, so the edit was dropped</span>` : null}
          </span>
          <span class="change-day">${shortDay(it.date)}</span>
          <span class="change-min">${it.change === 'remove' ? html`<s>${fmt(it.minutes)}</s>` : fmt(it.minutes)}</span>
          <span class=${'tag t-' + it.change}>${{ new: 'New', edit: 'Edit', remove: 'Remove' }[it.change]}</span>
        </div>`;
      })}
    </div>` : phase === 'review' ? html`<p class="muted">Drafts and edits show up here.</p>` : null}
  <//>`;
}

function SettingsSheet({ week, status, onClose, onSaved, onReload, onReconnect }) {
  const s = week.settings;
  const [target, setTarget] = useState(fmt(s.dailyTargetMinutes));
  const [workDays, setWorkDays] = useState(s.workDays);
  const [rounding, setRounding] = useState(String(s.timerRounding));
  const [dayEnds, setDayEnds] = useState(s.dayEnds);
  const [defs, setDefs] = useState(Object.assign({}, s.typeDefaults));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const projectList = Object.values(week.projects).filter((p) => (p.types || []).length);
  for (const k of Object.keys(s.typeDefaults)) if (!week.projects[k]) projectList.push({ shortName: k, name: k, types: [s.typeDefaults[k]], unknown: true });
  const DAYS = [[1, 'M', 'Monday'], [2, 'T', 'Tuesday'], [3, 'W', 'Wednesday'], [4, 'T', 'Thursday'], [5, 'F', 'Friday'], [6, 'S', 'Saturday'], [0, 'S', 'Sunday']];
  const save = async () => {
    const mins = parseDuration(target);
    if (mins === null || mins > 1440) { setErr('The daily target should look like 8h or 7.5.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api('PUT', '/settings', { dailyTargetMinutes: mins, workDays, timerRounding: Number(rounding), dayEnds, typeDefaults: defs });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  let host = week.url;
  try { host = new URL(week.url).host; } catch (_) { /* keep */ }
  const footer = html`<button class="btn btn-quiet" onClick=${onClose}>Cancel</button><button class="btn btn-accent" onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save'}</button>`;
  return html`<${Sheet} title="Settings" onClose=${onClose} footer=${footer}>
    <div class="group">
      <div class="group-title">Week</div>
      <label class="srow"><span>Daily target</span><input id="s-target" class="in-sm" value=${target} onInput=${(e) => setTarget(e.target.value)} /></label>
      <div class="srow"><span>Work days</span>
        <div class="daypick" role="group" aria-label="Work days">${DAYS.map(([n, l, full]) => html`<button key=${n} type="button" class=${'daybtn' + (workDays.includes(n) ? ' on' : '')} aria-pressed=${workDays.includes(n)} aria-label=${full}
          onClick=${() => setWorkDays(workDays.includes(n) ? workDays.filter((x) => x !== n) : [...workDays, n])}>${l}</button>`)}</div>
      </div>
      <label class="srow"><span>My day ends at</span><input id="s-end" type="time" class="in-sm" value=${dayEnds} onInput=${(e) => setDayEnds(e.target.value)} /></label>
      <label class="srow"><span>Round timers to</span>
        <select id="s-round" class="in-sm" value=${rounding} onChange=${(e) => setRounding(e.target.value)}>
          ${['1', '5', '10', '15', '30'].map((v) => html`<option value=${v}>${v === '1' ? 'the minute' : v + ' min'}</option>`)}
        </select></label>
    </div>
    <div class="group">
      <div class="group-title">Default work type</div>
      ${projectList.length ? projectList.map((p) => html`<label class="srow" key=${p.shortName}>
        <span><span class="mono">${p.shortName}</span>${p.name && p.name !== p.shortName ? html` <span class="muted small">${p.name}</span>` : null}</span>
        <select id=${'t-' + p.shortName} class="in-md" value=${defs[p.shortName] || ''} onChange=${(e) => setDefs(Object.assign({}, defs, { [p.shortName]: e.target.value }))}>
          <option value="">None</option>
          ${(p.types || []).map((t) => html`<option value=${t}>${t}</option>`)}
        </select>
      </label>`) : html`<div class="srow muted small">Projects appear here once you've logged on them.</div>`}
    </div>
    <div class="group">
      <div class="group-title">YouTrack</div>
      <div class="srow"><span>${status.user ? status.user.fullName || status.user.login : 'Connected'}<span class="muted small block">${host}</span></span>
        <span class="srow-acts"><button class="btn btn-sm" onClick=${onReload}>Reload</button><button class="btn btn-sm" onClick=${onReconnect}>Change</button></span></div>
    </div>
    ${err ? html`<p class="form-error" role="alert">${err}</p>` : null}
  <//>`;
}

render(html`<${App} />`, document.getElementById('root'));
