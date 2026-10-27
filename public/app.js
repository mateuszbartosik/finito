import { html, render, useState, useEffect, useLayoutEffect, useRef, useCallback } from './vendor/preact-htm.js';
import { parseQuick, parseDuration, fmt, addDays, weekdayIndex, localDateOf, resolveTypeName, pad } from './parse.js';

// ---------- small helpers ----------

const enc = encodeURIComponent;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (date) => Number(date.slice(8, 10));
const monthName = (date) => MONTHS[Number(date.slice(5, 7)) - 1];
const dayLabel = (date) => `${DOW[weekdayIndex(date)]} ${dayNum(date)} ${monthName(date)}`;
const mondayOf = (date) => addDays(date, -weekdayIndex(date));
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

const PALETTE = ['#2563eb', '#7c3aed', '#0f8a7e', '#c2410c', '#be185d', '#4d7c0f', '#0369a1', '#a16207'];
function projectColor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
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

// ---------- icons ----------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  bang: '<path d="M12 6v8M12 18h.01"/>',
  info: '<path d="M12 11v7M12 6.5h.01"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  watch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M9.5 2.5h5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function Icon({ name, size = 16, stroke = 2 }) {
  return html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" dangerouslySetInnerHTML=${{ __html: ICONS[name] }}></svg>`;
}

// ---------- app shell ----------

function App() {
  const [status, setStatus] = useState(null);
  const [reconnect, setReconnect] = useState(false);
  useEffect(() => {
    api('GET', '/status').then(setStatus).catch((e) => setStatus({ configured: false, error: e.message, offline: true }));
  }, []);
  const onReconnect = useCallback(() => setReconnect(true), []);
  if (!status) return html`<div class="boot">Loading…</div>`;
  if (status.offline) return html`<div class="boot"><div class="card boot-card"><p>${status.error}</p></div></div>`;
  const tokenDead = status.configured && status.ytStatus === 401;
  if (!status.configured || tokenDead || reconnect) {
    return html`<${Setup}
      status=${status}
      canCancel=${status.configured && !tokenDead && reconnect}
      onCancel=${() => setReconnect(false)}
      onDone=${(s) => { setStatus(s); setReconnect(false); }}
    />`;
  }
  return html`<${Main} status=${status} onReconnect=${onReconnect} />`;
}

function Brand() {
  return html`<span class="brand"><span class="glyph"><${Icon} name="watch" size=${15} stroke=${2.2} /></span><strong>Spent</strong></span>`;
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
    <form class="card setup" onSubmit=${submit}>
      <${Brand} />
      <h1>Connect YouTrack</h1>
      <p class="muted">Spent runs on this computer and talks to YouTrack as you, with a permanent token. The token stays in Spent's <code>data</code> folder and never reaches the browser.</p>
      <label for="url">YouTrack address</label>
      <input id="url" class="field" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://youtrack.example.com" required />
      <label for="token">Permanent token</label>
      <input id="token" class="field" type="password" value=${token} onInput=${(e) => setToken(e.target.value)} placeholder=${status.configured ? 'Leave empty to keep the saved token' : 'perm:…'} autocomplete="off" />
      <details class="howto">
        <summary>How to get a token</summary>
        <ol>
          <li>In YouTrack, open your avatar, then <b>Profile</b> → <b>Account Security</b>.</li>
          <li>Under <b>Tokens</b>, choose <b>New token…</b>, call it “Spent” and give it the <b>YouTrack</b> scope.</li>
          <li>Copy it straight away (YouTrack shows it once) and paste it here.</li>
        </ol>
        ${origin ? html`<p><a href=${origin + '/users/me'} target="_blank" rel="noopener noreferrer">Open my YouTrack profile <${Icon} name="external" size=${12} /></a></p>` : null}
      </details>
      ${error ? html`<p class="form-error" role="alert">${error}</p>` : null}
      <div class="row-end">
        ${canCancel ? html`<button type="button" class="btn" onClick=${onCancel}>Cancel</button>` : null}
        <button class="btn btn-primary" disabled=${busy}>${busy ? 'Checking…' : 'Connect'}</button>
      </div>
    </form>
  </div>`;
}

// ---------- main screen ----------

function Main({ status, onReconnect }) {
  const [week, setWeek] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [mine, setMine] = useState([]);
  const [sugg, setSugg] = useState({ loading: true, items: [], errors: [] });
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const [sel, setSel] = useState(null);
  const [rail, setRail] = useState('suggest');
  const [toast, setToast] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [addRow, setAddRow] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState('');
  const [lookups, setLookups] = useState({});
  const toastTimer = useRef(null);
  const weekRef = useRef(null);
  weekRef.current = week;

  const setEditing = (v) => { editingRef.current = v; setEditingState(v); };

  const flash = useCallback((msg, kind = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), kind === 'error' ? 7000 : 3500);
  }, []);

  const load = useCallback(async (start, fresh) => {
    try {
      const w = await api('GET', `/week?start=${start || ''}${fresh ? '&fresh=1' : ''}`);
      setWeek(w);
      setLoadError(null);
      return w;
    } catch (e) {
      if (e.status === 401) { onReconnect(); return null; }
      setLoadError(e.message);
      return null;
    }
  }, [onReconnect]);

  const loadSugg = useCallback(async (start) => {
    setSugg((s) => ({ ...s, loading: true }));
    try {
      const r = await api('GET', `/suggestions?start=${start}`);
      setSugg({ loading: false, items: r.suggestions || [], errors: r.errors || [] });
    } catch (e) {
      setSugg({ loading: false, items: [], errors: [e.message] });
    }
  }, []);

  useEffect(() => {
    load(null).then((w) => w && loadSugg(w.monday));
    api('GET', '/issues/mine').then((r) => setMine(r.issues || [])).catch(() => {});
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
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const el = document.getElementById('qe');
        if (el) el.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Look up an issue ID typed in quick entry that we don't know yet.
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

  if (!week) {
    return html`<div class="boot">${loadError
      ? html`<div class="card boot-card"><p>${loadError}</p><button class="btn" onClick=${() => load(null)}>Try again</button></div>`
      : 'Loading your week…'}</div>`;
  }

  // ---- derived data ----
  const { dates, today, entries, issues, projects, settings } = week;
  const target = settings.dailyTargetMinutes;
  const isWorkDay = (d) => settings.workDays.includes((weekdayIndex(d) + 1) % 7);
  const workDayCount = dates.filter(isWorkDay).length;
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
  const thisMonday = mondayOf(today);
  const isThisWeek = week.monday === thisMonday;

  const rowIds = [];
  const pushRow = (id) => { if (id && !rowIds.includes(id)) rowIds.push(id); };
  week.rows.forEach(pushRow);
  [...entries].sort((a, b) => (a.date === b.date ? a.issue.localeCompare(b.issue) : a.date < b.date ? -1 : 1)).forEach((e) => pushRow(e.issue));
  if (timer && dates.includes(timerDate)) pushRow(timer.issue);

  const known = [];
  const seenIds = new Set();
  for (const i of Object.values(issues)) {
    if (i && i.idReadable && !i.missing) { known.push(Object.assign({}, i, { preferred: true })); seenIds.add(i.idReadable); }
  }
  for (const l of Object.values(lookups)) if (l.ok && !seenIds.has(l.issue.idReadable)) { known.push(l.issue); seenIds.add(l.issue.idReadable); }
  for (const i of mine) if (!seenIds.has(i.idReadable)) { known.push(i); seenIds.add(i.idReadable); }

  const issueInfo = (id) => issues[id] || known.find((i) => i.idReadable === id) || { idReadable: id, summary: '' };
  const projectOf = (id) => { const i = issueInfo(id); return i.project ? projects[i.project.shortName] || i.project : null; };
  const typesFor = (id) => { const p = projectOf(id); return p && Array.isArray(p.types) ? p.types : null; };
  const defaultTypeFor = (id) => { const p = projectOf(id); return p ? settings.typeDefaults[p.shortName] || null : null; };
  const ytLink = (id) => `${week.url}/issue/${enc(id)}`;

  // ---- actions ----
  const reload = () => load(week.monday);
  const go = async (start) => {
    setEditing(null);
    setSel(null);
    setAddRow(false);
    const w = await load(start);
    if (w) loadSugg(w.monday);
  };
  const run = async (fn, message) => {
    try {
      const r = await fn();
      await reload();
      if (message) flash(typeof message === 'function' ? message(r) : message);
      return r || true;
    } catch (e) {
      if (e.status === 401) { onReconnect(); return null; }
      flash(e.message, 'error');
      await reload();
      return null;
    }
  };

  const baseOf = (e) => Object.assign({ issue: e.issue, issueDbId: e.issueDbId, date: e.date }, e.base || { minutes: e.minutes, type: e.type, text: e.text });
  const patchRaw = (e, changes) => api('PATCH', '/entries/' + enc(e.key), Object.assign({}, changes, { base: baseOf(e) }));
  const removeRaw = (e) => api('POST', `/entries/${enc(e.key)}/remove`, { snapshot: baseOf(e) });
  const restoreRaw = (e) => api('POST', `/entries/${enc(e.key)}/restore`, {});

  const startEdit = (issue, date) => {
    const cur = sum(liveOf(cellEntries(issue, date)));
    setEditing({ issue, date, text: cur ? fmt(cur) : '' });
    setSel({ issue, date });
    setRail('details');
  };

  const commitEdit = async (next) => {
    const ed = editingRef.current;
    if (!ed) return;
    if (next) {
      const cur = sum(liveOf(cellEntries(next.issue, next.date)));
      setEditing({ issue: next.issue, date: next.date, text: cur ? fmt(cur) : '' });
      setSel(next);
    } else setEditing(null);
    const min = parseDuration(ed.text);
    if (min === null || min > 1440) { flash(`Couldn't read “${ed.text}”. Try 1.5, 1h30 or 90m.`, 'error'); return; }
    const here = cellEntries(ed.issue, ed.date);
    const lv = liveOf(here);
    const cur = sum(lv);
    if (min === cur) return;
    await run(async () => {
      if (min === 0) { for (const e of lv) await removeRaw(e); return; }
      if (!lv.length) {
        const gone = here.find((e) => e.status === 'deleted');
        if (gone) { await restoreRaw(gone); await patchRaw(gone, { minutes: min }); return; }
        await api('POST', '/entries', { issue: ed.issue, dates: [ed.date], minutes: min });
        return;
      }
      const last = lv[lv.length - 1];
      const nm = last.minutes + (min - cur);
      if (nm <= 0) throw new Error('This cell holds several work items. Change them one by one in Details.');
      await patchRaw(last, { minutes: nm });
    });
  };

  const nextCell = (issue, date, key, shift) => {
    const di = dates.indexOf(date);
    const ri = rowIds.indexOf(issue);
    if (key === 'Tab') {
      const nd = di + (shift ? -1 : 1);
      if (nd >= 0 && nd < 7) return { issue, date: dates[nd] };
      const nr = ri + (shift ? -1 : 1);
      if (nr >= 0 && nr < rowIds.length) return { issue: rowIds[nr], date: dates[shift ? 6 : 0] };
      return null;
    }
    const nr = ri + (key === 'ArrowDown' ? 1 : -1);
    return nr >= 0 && nr < rowIds.length ? { issue: rowIds[nr], date } : null;
  };

  const onCellKey = (e, issue, date) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(null); return; }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null); return; }
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const next = nextCell(issue, date, e.key, e.shiftKey);
      if (next) e.preventDefault();
      commitEdit(next);
    }
  };

  const timerMessage = (r) => {
    const logged = (r.stopped || []).map((s) => `${fmt(s.minutes)} to ${s.issue}${s.date !== today ? ' on ' + dayLabel(s.date) : ''}`).join(', ');
    if (r.timer) return logged ? `Logged ${logged} as a draft · timer started on ${r.timer.issue}` : `Timer started on ${r.timer.issue}`;
    return logged ? `Logged ${logged} as a draft` : 'Timer discarded';
  };
  const toggleTimer = (issue) => run(
    () => (timer && timer.issue === issue ? api('POST', '/timer/stop', {}) : api('POST', '/timer/start', { issue })),
    timerMessage,
  );
  const stopTimer = (body = {}) => run(() => api('POST', '/timer/stop', body), timerMessage);

  const acceptSuggestions = async (list) => {
    const r = await run(async () => {
      for (const s of list) await api('POST', '/entries', { issue: s.issue, dates: [s.date], minutes: s.minutes });
    }, () => `Added ${fmt(list.reduce((a, s) => a + s.minutes, 0))} from ${plural(list.length, 'suggestion', 'suggestions')} as drafts`);
    if (r) setSugg((st) => ({ ...st, items: st.items.filter((x) => !list.some((s) => s.id === x.id)) }));
  };
  const dismissSuggestion = (s) => {
    setSugg((st) => ({ ...st, items: st.items.filter((x) => x.id !== s.id) }));
    api('POST', '/suggestions/dismiss', { id: s.id }).catch(() => {});
  };

  // ---- quick entry ----
  const parsed = parseQuick(q, { dates, today, issues: known });
  let chips = [];
  let qValid = false;
  let qHint = '';
  let qType;
  if (parsed) {
    const lk = parsed.issue && !parsed.issueKnown ? lookups[parsed.issue.toLowerCase()] : null;
    const issueOk = !!parsed.issue && (parsed.issueKnown || (lk && lk.ok));
    const canonical = parsed.issue && lk && lk.ok ? lk.issue.idReadable : parsed.issue;
    const summary = parsed.summary || (lk && lk.ok ? lk.issue.summary : '');
    if (!parsed.issue) chips.push({ label: 'Issue?', sub: parsed.ambiguous ? 'several titles match; add the ID' : 'type an ID or words from its title', cls: 'err' });
    else if (issueOk) chips.push({ label: canonical, sub: summary + (parsed.by ? ` · matched “${parsed.by}”` : ''), cls: 'ok' });
    else if (lk && !lk.ok) chips.push({ label: parsed.issue, sub: lk.error, cls: 'err' });
    else chips.push({ label: parsed.issue, sub: 'checking…', cls: '' });

    chips.push(parsed.minutes && parsed.minutes <= 1440
      ? { label: fmt(parsed.minutes), sub: parsed.range || '', cls: 'ok' }
      : { label: 'Time?', sub: 'e.g. 1.5, 1h30, 90m, 9:00–10:30', cls: 'err' });

    if (parsed.dayError) chips.push({ label: 'Day?', sub: parsed.dayError, cls: 'err' });
    else {
      const ds = parsed.dates;
      const label = ds.length > 1
        ? `${DOW[weekdayIndex(ds[0])]}–${DOW[weekdayIndex(ds[ds.length - 1])]}`
        : dayLabel(ds[0]) + (ds[0] === today ? ' · today' : ds[0] === addDays(today, -1) ? ' · yesterday' : '');
      const outside = ds.some((d) => !dates.includes(d));
      chips.push({ label, sub: ds.length > 1 ? plural(ds.length, 'work item', 'work items') : outside ? 'not in this week' : '', cls: outside ? 'warn' : 'ok' });
    }

    let typeErr = false;
    if (issueOk) {
      const types = typesFor(canonical);
      if (parsed.type) {
        const t = resolveTypeName(parsed.type, types);
        if (t.error) { typeErr = true; chips.push({ label: 'Type?', sub: t.error, cls: 'err' }); } else { qType = t.name; chips.push({ label: t.name, sub: t.unchecked ? 'checked when added' : 'work type', cls: 'ok' }); }
      } else {
        const def = defaultTypeFor(canonical);
        chips.push(def ? { label: def, sub: 'your default here', cls: '' } : { label: 'No type', sub: 'set a default in Settings', cls: '' });
      }
    }
    if (parsed.note) chips.push({ label: `“${parsed.note}”`, sub: 'note', cls: '' });
    if (issueOk && parsed.dates) {
      const dup = parsed.dates.filter((d) => sum(liveOf(cellEntries(canonical, d))) > 0);
      if (dup.length) chips.push({ label: `Adds to time already on ${dup.map((d) => DOW[weekdayIndex(d)]).join(', ')}`, sub: '', cls: 'warn' });
    }
    qValid = issueOk && parsed.minutes > 0 && parsed.minutes <= 1440 && !!parsed.dates && !typeErr;
    qHint = qValid ? 'Enter adds it as a draft' : '';
    if (issueOk) parsed.issue = canonical;
  }

  const addFromQuick = async () => {
    if (!qValid) return;
    const p = parsed;
    const body = { issue: p.issue, dates: p.dates, minutes: p.minutes, text: p.note };
    if (qType) body.type = qType;
    const r = await run(() => api('POST', '/entries', body), (res) => {
      const outside = p.dates.some((d) => !dates.includes(d));
      return `Added ${fmt(p.minutes)}${p.dates.length > 1 ? ` × ${p.dates.length} days` : ''} to ${res.issue.idReadable} as a draft${res.type ? ' · ' + res.type : ''}${outside ? ' (in another week)' : ''}`;
    });
    if (r) {
      setQ('');
      if (dates.includes(p.dates[0])) setSel({ issue: r.issue.idReadable, date: p.dates[0] });
    }
  };

  // ---- pieces ----
  const weekTitle = isThisWeek ? 'This week'
    : week.monday === addDays(thisMonday, -7) ? 'Last week'
      : week.monday === addDays(thisMonday, 7) ? 'Next week'
        : `Week of ${dayNum(week.monday)} ${monthName(week.monday)}`;
  const weekTarget = target * workDayCount;
  const pct = weekTarget ? Math.min(100, Math.round((weekTotal / weekTarget) * 100)) : 0;
  const longRun = timer && (timerDate < today || now - timer.startedAt > 10 * 3600 * 1000);
  const trimAt = timer ? localDateTimeMs(timerDate, settings.dayEnds) : 0;
  const showTrim = timer && trimAt > timer.startedAt && trimAt < now;

  const header = html`<div class="topline">
    <div class="weeknav">
      <button class="btn btn-ghost btn-icon" aria-label="Previous week" onClick=${() => go(addDays(week.monday, -7))}><${Icon} name="left" /></button>
      <div class="weektitle">
        <h1>${weekTitle}</h1>
        <div class="muted small">${rangeLabel(dates)}${isThisWeek ? ` · today is ${dayLabel(today)}` : ''}</div>
      </div>
      <button class="btn btn-ghost btn-icon" aria-label="Next week" onClick=${() => go(addDays(week.monday, 7))}><${Icon} name="right" /></button>
      ${!isThisWeek ? html`<button class="btn btn-sm" onClick=${() => go(today)}>Back to this week</button>` : null}
    </div>
    <div class="weektotal">
      <div class="weektotal-line">
        <span><strong>${fmt(weekTotal)}</strong> <span class="muted">of ${fmt(weekTarget)}</span></span>
        ${week.pending
          ? html`<span class="status status-warn">${plural(week.pending, 'change', 'changes')} not in YouTrack yet</span>`
          : html`<span class="status status-ok">Everything is in YouTrack</span>`}
      </div>
      <div class="track" aria-hidden="true"><div class="fill" style=${{ width: pct + '%' }}></div></div>
    </div>
    <span class="grow1"></span>
    ${timer
      ? html`<div class="timer on">
          <span class="pulse" aria-hidden="true"></span>
          <div class="timer-text">
            <span class="small"><a class="ikey" href=${ytLink(timer.issue)} target="_blank" rel="noopener noreferrer">${timer.issue}</a> <span class="muted">${issueInfo(timer.issue).summary}</span></span>
            <span class="clock" role="timer" aria-label="Time on the running timer">${clock(now - timer.startedAt)}</span>
          </div>
          <button class="btn btn-sm" onClick=${() => stopTimer({})}><${Icon} name="stop" size=${12} />Stop</button>
        </div>`
      : html`<div class="timer"><span class="muted small">No timer running. ▶ on a row starts one.</span></div>`}
    <button class="btn btn-icon" aria-label="Settings" title="Settings" onClick=${() => setSheet('settings')}><${Icon} name="gear" /></button>
    <button class="btn btn-primary btn-tall" onClick=${() => setSheet('submit')} disabled=${!week.pending}>${week.pending ? `Submit · ${week.pending}` : 'Up to date'}</button>
  </div>`;

  const quick = html`<section class="card quick" aria-label="Log time">
    <div class="quick-line">
      <div class="qe-wrap">
        <span class="qe-icon"><${Icon} name="plus" /></span>
        <label for="qe" class="sr">Log time in one line</label>
        <input id="qe" class="qe" value=${q}
          onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addFromQuick(); } else if (e.key === 'Escape') setQ(''); }}
          placeholder="Log time in one line: issue, time, day, #type, note   (press / to jump here)"
          autocomplete="off" spellcheck="false" />
      </div>
      <button class="btn btn-primary" onClick=${addFromQuick} disabled=${!qValid}>Add draft</button>
    </div>
    ${parsed
      ? html`<div class="chips">
          ${chips.map((c) => html`<span class=${'pchip ' + c.cls}><strong>${c.label}</strong>${c.sub ? html`<span class="sub">${c.sub}</span>` : null}</span>`)}
          ${qHint ? html`<span class="muted small">${qHint}</span>` : null}
        </div>`
      : html`<div class="chips">
          <span class="muted small">Try:</span>
          ${[
            `${rowIds[0] || 'APP-1234'} 1h30 review copy`,
            `${rowIds[1] || rowIds[0] || 'APP-1234'} 2h #dev yesterday`,
            '9:00–10:30 design review',
            `${rowIds[0] || 'APP-1234'} 15m mon-fri standup`,
          ].map((t) => html`<button class="ex mono" onClick=${() => { setQ(t); const el = document.getElementById('qe'); if (el) el.focus(); }}>${t}</button>`)}
        </div>`}
  </section>`;

  const dayHeads = dates.map((d, i) => {
    const t = dayTotals[i];
    const shown = t + (timer && d === timerDate ? timerMin : 0);
    let st = 'future';
    let note = t ? fmt(t) : '–';
    let title = '';
    if (!isWorkDay(d)) { st = 'off'; note = t ? fmt(t) : 'off'; title = 'Not a work day'; } else if (d === today) { st = 'today'; note = fmt(shown); title = `Today: ${fmt(shown)} so far of ${fmt(target)}`; } else if (d < today) {
      if (t >= target) { st = 'ok'; note = `${fmt(t)} ✓`; title = `${fmt(t)}, target reached`; } else { st = 'under'; note = fmt(t); title = `${fmt(t)} of ${fmt(target)}: ${fmt(target - t)} short`; }
    }
    const barPct = isWorkDay(d) && target ? Math.min(100, Math.round((shown / target) * 100)) : 0;
    return { d, st, note, title, barPct, total: t, isToday: d === today };
  });

  const rowView = (id) => {
    const info = issueInfo(id);
    const color = info.project ? projectColor(info.project.shortName) : 'var(--line2)';
    const timerHere = !!timer && timer.issue === id;
    let rowTotal = 0;
    let rowHasItems = false;
    const cellViews = dates.map((d) => {
      const here = cellEntries(id, d);
      if (here.length) rowHasItems = true;
      const lv = liveOf(here);
      const min = sum(lv);
      rowTotal += min;
      const pending = here.some((e) => e.status !== 'synced');
      const failed = here.some((e) => e.error);
      let kind = 'empty';
      if (here.length && !lv.length) kind = 'deleted';
      else if (min > 0 && pending) kind = 'draft';
      else if (min > 0) kind = 'synced';
      const running = timerHere && d === timerDate;
      const isEditing = editing && editing.issue === id && editing.date === d;
      const isSel = sel && sel.issue === id && sel.date === d;
      const aria = `${id}, ${dayLabel(d)}: ${min > 0 ? fmt(min) : 'no time'}${kind === 'draft' ? ', not submitted' : kind === 'deleted' ? ', will be removed' : ''}`;
      if (isEditing) {
        return html`<div class="cellwrap" key=${d}>
          <${CellInput}
            value=${editing.text}
            label=${aria}
            onInput=${(e) => setEditing(Object.assign({}, editingRef.current, { text: e.target.value }))}
            onKeyDown=${(e) => onCellKey(e, id, d)}
            onBlur=${() => { const ed = editingRef.current; if (ed && ed.issue === id && ed.date === d) commitEdit(null); }}
          />
        </div>`;
      }
      const label = min > 0 ? fmt(min) : kind === 'deleted' ? fmt(sum(here)) : '';
      return html`<button key=${d}
        class=${`cell k-${kind}${isWorkDay(d) ? '' : ' weekend'}${isSel ? ' sel' : ''}${failed ? ' failed' : ''}${d === today ? ' today' : ''}`}
        onClick=${() => startEdit(id, d)} aria-label=${aria}>
        ${label ? html`<span class="val">${label}</span>` : null}
        ${!label && !running ? html`<span class="plus" aria-hidden="true">+</span>` : null}
        ${running ? html`<span class="run"><span class="pulse" aria-hidden="true"></span>${fmt(Math.max(1, timerMin))}</span>` : null}
      </button>`;
    });
    const removable = week.rows.includes(id) && !rowHasItems && !timerHere;
    return html`<div class="grow" key=${id} role="row">
      <div class="icell">
        <button class=${'play' + (timerHere ? ' on' : '')} onClick=${() => toggleTimer(id)}
          aria-label=${timerHere ? `Stop the timer on ${id}` : `Start a timer on ${id}`} title=${timerHere ? 'Stop the timer' : 'Start a timer'}>
          <${Icon} name=${timerHere ? 'stop' : 'play'} size=${11} />
        </button>
        <span class="pdot" style=${{ background: color }} aria-hidden="true"></span>
        <div class="imeta">
          <span class="ikeyline">
            <a class="ikey" href=${ytLink(id)} target="_blank" rel="noopener noreferrer" title="Open in YouTrack">${id}</a>
            ${info.project ? html`<span class="iproj">${info.project.name}</span>` : null}
            ${info.missing ? html`<span class="iproj err">can't open</span>` : null}
            ${info.resolved ? html`<span class="iproj">resolved</span>` : null}
          </span>
          <span class="isum" title=${info.summary}>${info.summary || '—'}</span>
        </div>
        ${removable ? html`<button class="xbtn" aria-label=${`Remove the ${id} row`} title="Remove row"
          onClick=${() => run(() => api('POST', '/rows', { monday: week.monday, action: 'remove', issue: id }))}><${Icon} name="x" size=${12} /></button>` : null}
      </div>
      ${cellViews}
      <div class="tc">${rowTotal ? fmt(rowTotal) : '–'}</div>
    </div>`;
  };

  const grid = html`<section class="card gridcard" aria-label="Week grid">
    <div class="gridbar">
      <div class="legend">
        <span><span class="lg lg-synced" aria-hidden="true"></span>In YouTrack</span>
        <span><span class="lg lg-draft" aria-hidden="true"></span>Draft, not submitted</span>
        <span><span class="lg lg-del" aria-hidden="true"></span>Will be removed</span>
      </div>
      <span class="grow1"></span>
      <button class="btn btn-sm" onClick=${() => setAddRow(!addRow)} aria-expanded=${addRow}><${Icon} name="plus" size=${13} />Add row</button>
      <button class="btn btn-sm" onClick=${() => run(
        () => api('POST', '/rows', { monday: week.monday, action: 'copy-previous' }),
        (r) => (r.added.length ? `Added ${r.added.join(', ')}` : 'Nothing new to copy') + (r.skipped.length ? ` · skipped ${r.skipped.join(', ')} (resolved)` : ''),
      )}><${Icon} name="copy" size=${13} />Copy last week's rows</button>
      <button class="btn btn-sm btn-ghost" title="Reload from YouTrack" aria-label="Reload from YouTrack" onClick=${async () => { await api('POST', '/refresh').catch(() => {}); await load(week.monday, true); loadSugg(week.monday); }}><${Icon} name="refresh" size=${14} /></button>
    </div>
    ${addRow ? html`<${AddRow}
      onClose=${() => setAddRow(false)}
      onPick=${(i) => { setAddRow(false); run(() => api('POST', '/rows', { monday: week.monday, action: 'add', issue: i.idReadable }), `Added ${i.idReadable} as a row`); }}
    />` : null}
    <div class="gridscroll">
      <div class="gridinner" role="grid" aria-label="Time per issue and day">
        <div class="grow ghead" role="row">
          <div class="hc">Issue</div>
          ${dayHeads.map((h) => html`<div key=${h.d} class=${`dh st-${h.st}${h.isToday ? ' today' : ''}`} role="columnheader" title=${h.title} aria-label=${`${dayLabel(h.d)}${h.isToday ? ', today' : ''}. ${h.title || h.note}`}>
            <div class="dh-top"><span class="dh-day">${DOW[weekdayIndex(h.d)]}</span><span class="dh-num">${dayNum(h.d)}</span></div>
            <div class="dn">${h.note}</div>
            <div class="dt"><div class="df" style=${{ width: h.barPct + '%' }}></div></div>
          </div>`)}
          <div class="hc end">Total</div>
        </div>
        ${rowIds.length ? rowIds.map(rowView) : html`<div class="emptyweek">Nothing logged this week yet. Type a line above, add a row, or take a suggestion.</div>`}
        <div class="grow gtot" role="row">
          <div class="icell strong">Day total</div>
          ${dayHeads.map((h) => html`<div key=${h.d} class=${'dtot' + (h.st === 'under' ? ' under' : h.st === 'ok' ? ' ok' : '')}>${h.total ? fmt(h.total) : '–'}</div>`)}
          <div class="dtot strong">${fmt(weekTotal)}</div>
        </div>
      </div>
    </div>
    <div class="gridfoot muted small">Click a cell and type 1.5, 1h30, 90m or 1:30. Enter saves, Tab moves a day, ↑ ↓ move a row, Esc cancels, 0 removes the time.</div>
  </section>`;

  // Suggestions rail
  const visibleSugg = sugg.items.filter((s) => dates.includes(s.date));
  const shortDays = dayHeads.filter((h) => h.st === 'under');
  const suggestionsView = html`<div class="rail-body" key="suggest">
    <p class="muted small nomargin" key="intro">Drafted from your YouTrack activity: comments, field changes, attachments, commits. Nothing is logged until you add it.</p>
    ${shortDays.length
      ? html`<div class="gapcard" key="gap-warn">
          <div class="gaphead warn"><${Icon} name="warn" /><span>${plural(shortDays.length, 'day is', 'days are')} under ${fmt(target)}</span></div>
          ${shortDays.map((h) => {
            const list = visibleSugg.filter((s) => s.date === h.d);
            const tot = list.reduce((a, s) => a + s.minutes, 0);
            const short = target - h.total;
            return html`<div class="gaprow" key=${h.d}>
              <div class="grow1"><div class="strong">${dayLabel(h.d)}</div><div class="muted small">${fmt(short)} short${list.length ? ` · ${plural(list.length, 'suggestion covers', 'suggestions cover')} ${fmt(tot)}` : ' · no suggestions'}</div></div>
              ${list.length ? html`<button class="btn btn-sm" onClick=${() => acceptSuggestions(list)}><${Icon} name="sparkle" size=${13} />${
                list.length === 1 ? `Add ${fmt(tot)}` : tot >= short && tot <= short + 30 ? `Fill to ${fmt(target)}` : `Add all ${list.length} · ${fmt(tot)}`
              }</button>` : null}
            </div>`;
          })}
        </div>`
      : dates[0] < today
        ? html`<div class="gapcard" key="gap-ok"><div class="gaphead ok"><${Icon} name="check" /><span>Every past work day reaches ${fmt(target)}</span></div></div>`
        : null}
    ${sugg.loading ? html`<div class="muted small" key="loading">Reading your activity…</div>` : null}
    ${[...new Set(visibleSugg.map((s) => s.date))].map((d) => html`<div class="sgroup" key=${d}>
      <div class="glabel">${dayLabel(d)}</div>
      ${visibleSugg.filter((s) => s.date === d).map((s) => html`<article class="sugg" key=${s.id}>
        <div class="sugg-top">
          <span class="src" aria-hidden="true"><${Icon} name="activity" size=${15} /></span>
          <div class="grow1">
            <div class="strong">${s.title}</div>
            <div class="muted small">YouTrack · ${s.when}</div>
          </div>
          <span class="dur">${fmt(s.minutes)} est.</span>
        </div>
        <div class="map">→ <a class="ikey" href=${ytLink(s.issue)} target="_blank" rel="noopener noreferrer">${s.issue}</a> ${s.summary}${defaultTypeFor(s.issue) ? ` · ${defaultTypeFor(s.issue)}` : ''}</div>
        <div class="muted small">${s.why}</div>
        <div class="row-end">
          <button class="btn btn-sm btn-ghost" onClick=${() => dismissSuggestion(s)}>Dismiss</button>
          <button class="btn btn-sm" onClick=${() => acceptSuggestions([s])}>Add ${fmt(s.minutes)}</button>
        </div>
      </article>`)}
    </div>`)}
    ${!sugg.loading && !visibleSugg.length ? html`<div class="empty-note" key="empty">No suggestions for this week.</div>` : null}
    ${sugg.errors.length ? html`<div class="err-line" key="errors">Couldn't read all of your activity: ${sugg.errors[0]}</div>` : null}
    <div class="row-end" key="again"><button class="btn btn-sm btn-ghost" onClick=${() => loadSugg(week.monday)}><${Icon} name="refresh" size=${13} />Look again</button></div>
  </div>`;

  // Details rail
  let detailsView;
  if (!sel) detailsView = html`<div class="empty-note">Pick a cell to see its work items, type and note.</div>`;
  else {
    const info = issueInfo(sel.issue);
    const here = cellEntries(sel.issue, sel.date);
    const types = typesFor(sel.issue) || [];
    const p = projectOf(sel.issue);
    const def = defaultTypeFor(sel.issue);
    detailsView = html`<div class="rail-body" key="details">
      <div>
        <div class="small"><a class="ikey" href=${ytLink(sel.issue)} target="_blank" rel="noopener noreferrer">${sel.issue}</a> <span class="muted">· ${dayLabel(sel.date)}</span></div>
        <div class="dtitle">${info.summary}</div>
        ${info.project ? html`<div class="muted small">${info.project.name}</div>` : null}
      </div>
      ${!def && types.length && p ? html`<div class="hint">No default work type for ${p.shortName} yet. Set one in Settings and new time gets it automatically.</div>` : null}
      ${here.length ? null : html`<div class="muted small">No work items on this day yet.</div>`}
      ${here.map((e) => html`<${EntryCard} key=${e.key} entry=${e} types=${types}
        onPatch=${(c) => run(() => patchRaw(e, c))}
        onRemove=${() => run(() => removeRaw(e), e.status === 'draft' ? 'Draft removed' : 'It will be removed when you submit')}
        onRestore=${() => run(() => restoreRaw(e), 'Kept')} />`)}
      <div><button class="btn btn-sm" onClick=${() => run(() => api('POST', '/entries', { issue: sel.issue, dates: [sel.date], minutes: 30 }), 'Added 30m as a draft')}><${Icon} name="plus" size=${13} />Add another work item</button></div>
      <div class="muted small">Changes stay drafts until you submit.</div>
    </div>`;
  }

  const railView = html`<aside class="card rail" aria-label="Suggestions and details">
    <div class="tabs" role="tablist">
      <button class=${'tab' + (rail === 'suggest' ? ' on' : '')} role="tab" aria-selected=${rail === 'suggest'} onClick=${() => setRail('suggest')}>
        Suggestions${visibleSugg.length ? html`<span class="count">${visibleSugg.length}</span>` : null}
      </button>
      <button class=${'tab' + (rail === 'details' ? ' on' : '')} role="tab" aria-selected=${rail === 'details'} onClick=${() => setRail('details')}>Details</button>
    </div>
    ${rail === 'suggest' ? suggestionsView : detailsView}
  </aside>`;

  const host = (() => { try { return new URL(week.url).host; } catch (_) { return week.url; } })();

  return html`<div class="app">
    <header class="hostbar">
      <${Brand} />
      <span class="muted" aria-hidden="true">/</span>
      <span>My week</span>
      <span class="grow1"></span>
      <span class="muted small">${status.user ? `${status.user.fullName || status.user.login} · ` : ''}${host}</span>
      <button class="btn btn-sm btn-ghost" onClick=${onReconnect}>Change connection</button>
    </header>
    <main class="page">
      ${header}
      ${week.ytError ? html`<div class="banner err" role="alert"><${Icon} name="warn" /><span>YouTrack didn't answer: ${week.ytError} Showing your drafts only.</span><button class="btn btn-sm" onClick=${() => load(week.monday, true)}>Try again</button></div>` : null}
      ${longRun ? html`<div class="banner warn" role="alert">
        <${Icon} name="warn" />
        <span class="grow1">Your timer on <strong>${timer.issue}</strong> has run since ${timerDate === today ? hhmm(timer.startedAt) : `${dayLabel(timerDate)}, ${hhmm(timer.startedAt)}`} (${fmt(timerMin)}).</span>
        ${showTrim ? html`<button class="btn btn-sm" onClick=${() => stopTimer({ endAt: trimAt })}>Stop it at ${settings.dayEnds}${timerDate === today ? '' : ' on ' + dayLabel(timerDate)} (${fmt((trimAt - timer.startedAt) / 60000)})</button>` : null}
        <button class="btn btn-sm" onClick=${() => stopTimer({})}>Keep all ${fmt(timerMin)}</button>
        <button class="btn btn-sm btn-ghost" onClick=${() => stopTimer({ discard: true })}>Discard</button>
      </div>` : null}
      ${quick}
      <div class="mainrow">
        ${grid}
        ${railView}
      </div>
    </main>
    ${sheet === 'submit' ? html`<${SubmitSheet}
      week=${week} dayHeads=${dayHeads} target=${target} timer=${timer} timerMin=${timerMin}
      typesFor=${typesFor} issueInfo=${issueInfo}
      onStopTimer=${() => api('POST', '/timer/stop', {})}
      onShowSuggestions=${() => { setSheet(null); setRail('suggest'); }}
      onClose=${() => setSheet(null)}
      onFinished=${() => { reload(); loadSugg(week.monday); }}
      onUnauthorized=${onReconnect}
    />` : null}
    ${sheet === 'settings' ? html`<${SettingsSheet}
      week=${week} status=${status}
      onClose=${() => setSheet(null)}
      onSaved=${() => { setSheet(null); reload(); flash('Settings saved'); }}
      onReconnect=${() => { setSheet(null); onReconnect(); }}
    />` : null}
    ${toast ? html`<div class="toast-wrap"><div class=${'toast' + (toast.kind === 'error' ? ' err' : '')} role="status">${toast.msg}</div></div>` : null}
  </div>`;
}

function CellInput({ value, label, onInput, onKeyDown, onBlur }) {
  const ref = useRef(null);
  // Layout effect: focus before the next keystroke can land anywhere else.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); el.select(); }
  }, []);
  return html`<input ref=${ref} class="cell-input" value=${value} aria-label=${label} onInput=${onInput} onKeyDown=${onKeyDown} onBlur=${onBlur} autocomplete="off" spellcheck="false" />`;
}

function EntryCard({ entry: e, types, onPatch, onRemove, onRestore }) {
  const [note, setNote] = useState(e.text || '');
  useEffect(() => { setNote(e.text || ''); }, [e.key, e.text]);
  const editable = e.status !== 'deleted';
  const badge = { synced: 'In YouTrack', draft: 'Draft', edited: 'Edited, not submitted', deleted: 'Will be removed' }[e.status];
  const list = types && types.length ? types : e.type ? [e.type] : [];
  return html`<div class=${'entry' + (e.error ? ' failed' : '')}>
    <div class="entry-top">
      <span class="edur">${fmt(e.minutes)}</span>
      <span class=${'badge b-' + e.status}>${badge}</span>
      ${e.fromTimer ? html`<span class="badge b-synced">timer</span>` : null}
      <span class="grow1"></span>
      ${editable ? html`
        <button class="btn btn-sm btn-icon" aria-label="15 minutes less" disabled=${e.minutes <= 15} onClick=${() => onPatch({ minutes: e.minutes - 15 })}>−</button>
        <button class="btn btn-sm btn-icon" aria-label="15 minutes more" onClick=${() => onPatch({ minutes: e.minutes + 15 })}>+</button>` : null}
    </div>
    ${e.error ? html`<div class="err-line">Last submit failed: ${e.error}</div>` : null}
    ${list.length
      ? html`<div class="muted small">Work type</div>
        <div class="pills">${list.map((t) => html`<button key=${t} class=${'pill' + (t === e.type ? ' on' : '')} aria-pressed=${t === e.type} disabled=${!editable}
          onClick=${() => onPatch({ type: t === e.type ? null : t })}>${t}</button>`)}</div>`
      : html`<div class="muted small">This project has no work types.</div>`}
    ${editable
      ? html`<label class="muted small" for=${'n-' + e.key}>Note</label>
        <textarea id=${'n-' + e.key} class="note" rows="2" value=${note} placeholder="What did you do?"
          onInput=${(ev) => setNote(ev.target.value)}
          onBlur=${() => { if (note !== (e.text || '')) onPatch({ text: note }); }}></textarea>
        <div class="row-end"><button class="btn btn-sm btn-ghost btn-danger" onClick=${onRemove}>Remove this work item</button></div>`
      : html`<div class="small">${e.text || 'No note'}</div>
        <div class="row-end"><button class="btn btn-sm" onClick=${onRestore}>Keep it</button></div>`}
  </div>`;
}

function AddRow({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.focus(); }, []);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api('GET', '/issues/search?q=' + enc(q.trim()))
        .then((r) => { if (alive) { setList(r.issues || []); setErr(''); } })
        .catch((e) => { if (alive) setErr(e.message); });
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  return html`<div class="addrow">
    <label for="rowq" class="muted small">Add any issue as a row, even before you log time on it. Search by ID or words; empty shows your open issues.</label>
    <div class="addrow-line">
      <input id="rowq" ref=${ref} class="field" value=${q} placeholder="APP-1234 or a few words" autocomplete="off"
        onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); }} />
      <button class="btn btn-ghost" onClick=${onClose}>Close</button>
    </div>
    ${err ? html`<div class="err-line">${err}</div>` : null}
    <div class="results">
      ${list === null ? html`<span class="muted small">Searching…</span>`
        : list.length ? list.map((i) => html`<button key=${i.idReadable} class="result" onClick=${() => onPick(i)}><strong class="mono">${i.idReadable}</strong><span>${i.summary}</span></button>`)
          : html`<span class="muted small">No issues match.</span>`}
    </div>
  </div>`;
}

// ---------- sheets ----------

function Sheet({ title, sub, onClose, canClose = true, children, footer, wide }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const prev = document.activeElement;
    if (ref.current) ref.current.focus();
    const onKey = (e) => { if (e.key === 'Escape' && canClose) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, [canClose]);
  return html`<div class="scrim" onClick=${(e) => { if (e.target === e.currentTarget && canClose) onClose(); }}>
    <div class=${'card sheet' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1" ref=${ref}>
      <div class="sheet-head">
        <div class="grow1"><h2 id="sheet-title">${title}</h2>${sub ? html`<div class="muted">${sub}</div>` : null}</div>
        ${canClose ? html`<button class="btn btn-ghost btn-icon" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button>` : null}
      </div>
      <div class="sheet-body">${children}</div>
      ${footer ? html`<div class="sheet-foot">${footer}</div>` : null}
    </div>
  </div>`;
}

function SubmitSheet({ week, dayHeads, target, timer, timerMin, typesFor, issueInfo, onStopTimer, onShowSuggestions, onClose, onFinished, onUnauthorized }) {
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
    const short = dayHeads.filter((h) => h.st === 'under');
    if (short.length) {
      checks.push({ kind: 'warn', text: `${plural(short.length, 'day is', 'days are')} under ${fmt(target)} this week`, sub: short.map((h) => `${dayLabel(h.d)}: ${fmt(h.total)}`).join(' · ') + '. You can still submit.', action: 'Fill from suggestions', act: onShowSuggestions });
    } else if (dayHeads.some((h) => h.st === 'ok')) {
      checks.push({ kind: 'ok', text: `Every past work day this week reaches ${fmt(target)}` });
    }
    if (timer) {
      checks.push({ kind: 'info', text: `A timer is still running on ${timer.issue} (${fmt(Math.max(1, timerMin))})`, sub: 'Stop it to include that time in this submit.', action: 'Stop and include', act: async () => { await onStopTimer(); onFinished(); loadPending(); } });
    }
    const noType = items.filter((it) => it.change !== 'remove' && !it.type && (typesFor(it.issue) || []).length);
    if (noType.length) checks.push({ kind: 'info', text: `${plural(noType.length, 'work item has', 'work items have')} no work type`, sub: 'YouTrack accepts that. Set a default per project in Settings.' });
    const failedBefore = items.filter((it) => it.error);
    if (failedBefore.length) checks.push({ kind: 'err', text: `${plural(failedBefore.length, 'change', 'changes')} failed last time`, sub: `${failedBefore[0].error}${failedBefore.length > 1 ? ` (and ${failedBefore.length - 1} more)` : ''} They'll be tried again.` });
  }

  const okCount = Object.values(results).filter((r) => r && r.ok).length;
  const failCount = Object.values(results).filter((r) => r && !r.ok).length;
  const retried = Object.values(results).filter((r) => r && r.retried).length;
  const n = items.length;

  let title = 'Submit to YouTrack';
  let sub = '';
  if (phase === 'review') sub = n ? `${plural(n, 'change goes', 'changes go')} to YouTrack as work items` : 'Nothing to submit';
  if (phase === 'writing') { title = 'Writing to YouTrack…'; sub = `Writing ${Math.min(idx + 1, n)} of ${n}`; }
  if (phase === 'done') { title = failCount ? 'Submitted, with problems' : 'Submitted'; sub = `${plural(okCount, 'change', 'changes')} written${failCount ? `, ${failCount} failed` : ''}`; }

  const footer = html`
    <span class="muted small grow1">${phase === 'done' ? (failCount ? 'Failed changes stay as drafts with the reason. Fix them and submit again.' : 'Your week is in YouTrack.') : 'Spent writes straight to YouTrack. It keeps only drafts and your settings.'}</span>
    ${phase === 'review' ? html`<button class="btn" onClick=${onClose}>Keep editing</button><button class="btn btn-primary" onClick=${write} disabled=${!n}>Write ${plural(n, 'change', 'changes')}</button>` : null}
    ${phase === 'writing' ? html`<button class="btn btn-primary" disabled>Writing…</button>` : null}
    ${phase === 'done' || phase === 'error' ? html`<a class="btn" href=${week.url + '/timesheets'} target="_blank" rel="noopener noreferrer">Open YouTrack timesheets <${Icon} name="external" size=${12} /></a><button class="btn btn-primary" onClick=${onClose}>Done</button>` : null}`;

  return html`<${Sheet} title=${title} sub=${sub} onClose=${onClose} canClose=${phase !== 'writing'} footer=${footer} wide>
    ${phase === 'loading' ? html`<p class="muted">Gathering your changes…</p>` : null}
    ${phase === 'error' ? html`<p class="err-line">${st.error}</p>` : null}
    ${phase === 'done' ? html`<div class=${'donebox' + (failCount ? ' warn' : '')}>
      <${Icon} name=${failCount ? 'warn' : 'check'} size=${20} />
      <div><div class="strong">${failCount ? `${okCount} of ${n} changes are in YouTrack` : `All ${plural(n, 'change is', 'changes are')} in YouTrack`}</div>
      <div class="small">${retried ? `${plural(retried, 'write', 'writes')} hit a network error and ${retried === 1 ? 'was' : 'were'} retried without duplicating anything.` : ''}</div></div>
    </div>` : null}
    ${phase === 'writing' ? html`<div class="track"><div class="fill" style=${{ width: Math.round((Math.min(idx, n) / Math.max(1, n)) * 100) + '%' }}></div></div>` : null}
    ${checks.length ? html`<div class="checks">${checks.map((c, i) => html`<div class="chk" key=${i}>
      <span class=${'ci ci-' + c.kind}><${Icon} name=${{ ok: 'check', warn: 'bang', err: 'x', info: 'info' }[c.kind]} size=${13} stroke=${3} /></span>
      <div class="grow1"><div class="strong">${c.text}</div>${c.sub ? html`<div class="muted small">${c.sub}</div>` : null}</div>
      ${c.action ? html`<button class="btn btn-sm" onClick=${c.act}>${c.action}</button>` : null}
    </div>`)}</div>` : null}
    ${n ? html`<div class="chtable">
      <div class="chrow chhead"><span></span><span>Work item</span><span>Day</span><span>Time</span><span>Type</span><span>Change</span></div>
      ${items.map((it, i) => {
        const r = results[it.key];
        let state = 'queued';
        if (r) state = r.ok ? 'done' : 'failed';
        else if (phase === 'writing' && i === idx) state = 'writing';
        const summary = st.summaries[it.issue] || issueInfo(it.issue).summary || '';
        return html`<div class="chrow" key=${it.key}>
          <span class="chstate">
            ${state === 'queued' ? html`<span class="dotq" aria-label="Waiting"></span>` : null}
            ${state === 'writing' ? html`<span class="spin" aria-label="Writing"></span>` : null}
            ${state === 'done' ? html`<span class="okc" aria-label="Written"><${Icon} name="check" size=${15} stroke=${3} /></span>` : null}
            ${state === 'failed' ? html`<span class="errc" aria-label="Failed"><${Icon} name="x" size=${15} stroke=${3} /></span>` : null}
          </span>
          <span class="chmain">
            <span class="ell"><strong class="mono">${it.issue}</strong> <span class="muted">${it.text || summary}</span></span>
            ${state === 'failed' ? html`<span class="err-text">${r.error}</span>` : !r && it.error ? html`<span class="err-text">Last time: ${it.error}</span>` : null}
            ${r && r.retried ? html`<span class="muted small">Retried after a network error</span>` : null}
            ${r && r.dropped ? html`<span class="muted small">Already deleted in YouTrack, so the edit was dropped</span>` : null}
          </span>
          <span>${dayLabel(it.date)}</span>
          <span class="strong num">${fmt(it.minutes)}</span>
          <span>${it.type || html`<span class="muted">—</span>`}</span>
          <span class=${'chg chg-' + it.change}>${{ new: 'New', edit: 'Edited', remove: 'Remove' }[it.change]}</span>
        </div>`;
      })}
    </div>` : phase === 'review' ? html`<p class="muted">There's nothing to submit. Drafts and edits appear here.</p>` : null}
  <//>`;
}

function SettingsSheet({ week, status, onClose, onSaved, onReconnect }) {
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
  const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
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
  const footer = html`<span class="grow1"></span><button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save'}</button>`;
  return html`<${Sheet} title="Settings" sub="Stored on this computer, in Spent's data folder." onClose=${onClose} footer=${footer}>
    <div class="form">
      <section>
        <h3>YouTrack</h3>
        <p class="small">Connected as <strong>${status.user ? status.user.fullName || status.user.login : 'you'}</strong> at <span class="mono">${week.url}</span>.</p>
        <button class="btn btn-sm" onClick=${onReconnect}>Change address or token</button>
      </section>
      <section>
        <h3>Your work week</h3>
        <div class="frow"><label for="s-target">Daily target</label><input id="s-target" class="field narrow" value=${target} onInput=${(e) => setTarget(e.target.value)} /></div>
        <div class="frow"><span>Work days</span><div class="days">${DAYS.map(([n, label]) => html`<label class="daybox" key=${n}><input type="checkbox" checked=${workDays.includes(n)} onChange=${(e) => setWorkDays(e.target.checked ? [...workDays, n] : workDays.filter((x) => x !== n))} />${label}</label>`)}</div></div>
        <div class="frow"><label for="s-round">Round timers to</label>
          <select id="s-round" class="field narrow" value=${rounding} onChange=${(e) => setRounding(e.target.value)}>
            ${['1', '5', '10', '15', '30'].map((v) => html`<option value=${v}>${v === '1' ? 'the minute' : v + ' minutes'}</option>`)}
          </select></div>
        <div class="frow"><label for="s-end">My day ends at</label><input id="s-end" type="time" class="field narrow" value=${dayEnds} onInput=${(e) => setDayEnds(e.target.value)} /></div>
        <p class="muted small">The day end is used to trim a timer you forgot to stop.</p>
      </section>
      <section>
        <h3>Default work type per project</h3>
        <p class="muted small">New time gets this type unless you pick another one (or type <span class="mono">#review</span> in quick entry). Projects show up here once they're in a week you've opened.</p>
        ${projectList.length ? projectList.map((p) => html`<div class="frow" key=${p.shortName}>
          <label for=${'t-' + p.shortName}><span class="mono">${p.shortName}</span> <span class="muted small">${p.name !== p.shortName ? p.name : ''}</span></label>
          <select id=${'t-' + p.shortName} class="field" value=${defs[p.shortName] || ''} onChange=${(e) => setDefs(Object.assign({}, defs, { [p.shortName]: e.target.value }))}>
            <option value="">No default</option>
            ${(p.types || []).map((t) => html`<option value=${t}>${t}</option>`)}
          </select>
        </div>`) : html`<p class="muted small">No projects with work types in this week yet.</p>`}
      </section>
      ${err ? html`<p class="form-error" role="alert">${err}</p>` : null}
    </div>
  <//>`;
}

render(html`<${App} />`, document.getElementById('root'));
