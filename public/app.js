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
// Light or dark when picked in Settings, otherwise the system's. theme.js applies it before the first paint.
const THEME_KEY = 'theme';
const readTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; } };
const showTheme = (t) => { if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
const saveTheme = (t) => { try { if (t === 'light' || t === 'dark') localStorage.setItem(THEME_KEY, t); else localStorage.removeItem(THEME_KEY); } catch (e) { /* no storage: it lasts until the page reloads */ } };

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
      headers: Object.assign({ 'X-Finito': '1' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (_) {
    const err = new Error("Finito's local server isn't answering. Is its window still open?");
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
  chevron: '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  review: '<circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/><path d="M6.5 8.2v7.6M17.5 15.8V10a3 3 0 0 0-3-3h-4.5M12 4.5L9.5 7l2.5 2.5"/>',
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

// ---------- select ----------
// A designed select, after Arc UI's morph select: the trigger grows into the list, one highlight
// glides between options, and the value rolls when it changes. The open surface is drawn in a layer
// on <body>, so sheets and popovers can't clip it; focus stays on the trigger (aria-activedescendant).
// Keys: arrows, Home/End, PageUp/PageDown, type-ahead, Enter or Space picks, Alt+↑ picks and closes,
// Escape closes, Tab closes and moves on.

const OPEN_RADIUS = 22;
// Room kept clear of the bar at the bottom and the buttons at the top; the most a result list shows before it scrolls.
const DOCK_ROOM = 104;
const TOP_ROOM = 88;
const RESULTS_MAX = 212;
const QUARTERS = Array.from({ length: 96 }, (_, i) => pad(Math.floor(i / 4)) + ':' + pad((i % 4) * 15));
let selectCount = 0;

// Renders its children into a layer on <body>.
function Layer({ children }) {
  const host = useRef(null);
  if (!host.current) {
    host.current = document.createElement('div');
    host.current.className = 'sel-layer';
    host.current.dataset.layer = 'select';
  }
  useLayoutEffect(() => {
    document.body.appendChild(host.current);
    return () => { render(null, host.current); host.current.remove(); };
  }, []);
  useLayoutEffect(() => { render(children, host.current); });
  return null;
}

function Select({ id, value, options, onChange, labelledBy, label, shape = 'pill', fill = false, align = 'auto', minWidth = 0, maxListHeight = 296 }) {
  const [uid] = useState(() => id || 'sel-' + (++selectCount));
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // the surface exists, also while it folds back
  const [active, setActive] = useState(-1);
  const trig = useRef(null);
  const surf = useRef(null);
  const scroller = useRef(null);
  const hl = useRef(null);
  const geo = useRef(null);
  const keyNav = useRef(false);
  const typed = useRef({ s: '', t: 0 });
  const closeTimer = useRef(0);
  const settleTimer = useRef(0);
  const lastSel = useRef(null);
  const n = options.length;
  const sel = Math.max(0, options.findIndex((o) => o.value === value));
  const cur = options[sel] || { value: '', label: '' };
  const roll = lastSel.current === null || lastSel.current === sel ? '' : sel > lastSel.current ? ' roll-up' : ' roll-down';
  useEffect(() => { lastSel.current = sel; }, [sel]);
  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(settleTimer.current); }, []);

  // The closed trigger sizes to its label, and springs when the label changes.
  useLayoutEffect(() => {
    const t = trig.current;
    if (fill || !t) return;
    const cs = getComputedStyle(t);
    // offsetWidth, not getBoundingClientRect: a sheet still rising (scaled) would measure short and clip the label.
    const m = t.querySelector('.sel-measure').offsetWidth + 1;
    t.style.width = Math.max(minWidth, Math.ceil(m + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight))) + 'px';
  }, [cur.label, minWidth, fill]);

  const measure = () => {
    const t = trig.current;
    const list = surf.current.querySelector('.sel-list');
    const r = t.getBoundingClientRect();
    // fixed boxes measure from inside the scrollbars, so use the document's client size
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const m = 12;
    const want = r.height + 1 + Math.min(list.offsetHeight + 12, maxListHeight);
    const below = vh - r.top - m;
    const above = r.bottom - m;
    const up = want > below && above > below;
    const w = Math.min(Math.max(r.width, list.scrollWidth + 12, 168), vw - 2 * m);
    const radius = Math.min(parseFloat(getComputedStyle(t).borderTopLeftRadius) || 0, r.height / 2);
    // Grow toward the side that keeps the list inside its sheet or editor (and always on screen).
    const box = t.closest('.sheet, .popover');
    const cb = box ? box.getBoundingClientRect() : { left: 0, right: vw };
    const fitsStart = r.left + w <= Math.min(vw - m, cb.right - 8);
    const fitsEnd = r.right - w >= Math.max(m, cb.left + 8);
    const onScreenEnd = r.right - w >= m;
    const end = align === 'end' ? fitsEnd || (!fitsStart && onScreenEnd) : align === 'start' ? !fitsStart && fitsEnd : !fitsStart && onScreenEnd;
    return { r, w, h: Math.min(want, up ? above : below), up, end, radius };
  };
  const apply = (g, opened) => {
    const s = surf.current;
    const { r } = g;
    s.dataset.dir = g.up ? 'up' : 'down';
    s.style.setProperty('--sel-h', r.height + 'px');
    // Pin one edge on each axis and free the other ('auto'), or the stylesheet's left/top would win.
    s.style.left = g.end ? 'auto' : r.left + 'px';
    s.style.right = g.end ? document.documentElement.clientWidth - r.right + 'px' : 'auto';
    s.style.top = g.up ? 'auto' : r.top + 'px';
    s.style.bottom = g.up ? document.documentElement.clientHeight - r.bottom + 'px' : 'auto';
    s.style.width = (opened ? g.w : r.width) + 'px';
    s.style.height = (opened ? g.h : r.height) + 'px';
    s.style.borderRadius = (opened ? OPEN_RADIUS : g.radius) + 'px';
  };

  // Open: start on the trigger's box, then grow into the list.
  useLayoutEffect(() => {
    if (!shown || !open || !surf.current) return;
    clearTimeout(closeTimer.current);
    const s = surf.current;
    const g = measure();
    geo.current = g;
    s.style.transition = 'none';
    s.dataset.state = 'start';
    delete s.dataset.settled;
    apply(g, false);
    s.getBoundingClientRect();
    s.style.transition = '';
    s.dataset.state = 'open';
    apply(g, true);
    // The list may only scroll once the surface has finished growing; no scrollbar flashes on the way.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => { if (s.dataset.state === 'open') s.dataset.settled = '1'; }, reduceMotion() ? 130 : 560);
    // Show the chosen option, judged against the list's open height, not the height it starts from.
    const sc = scroller.current;
    const o = s.querySelector('[aria-selected="true"]');
    if (sc && o) {
      const view = g.h - g.r.height - 1;
      const y = o.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      sc.scrollTop = sc.scrollHeight <= view ? 0 : Math.max(0, Math.min(sc.scrollHeight - view, y - (view - o.offsetHeight) / 2));
    }
  }, [shown, open]);

  // Close: fold back onto the trigger, wherever it is now, then let it go.
  useLayoutEffect(() => {
    if (!shown || open) return;
    if (!surf.current || !geo.current || !trig.current) { setShown(false); return; }
    const g = Object.assign({}, geo.current, { r: trig.current.getBoundingClientRect() });
    clearTimeout(settleTimer.current);
    delete surf.current.dataset.settled;
    surf.current.dataset.state = 'closing';
    // With Reduce motion it just fades where it is.
    if (!reduceMotion()) apply(g, false);
    closeTimer.current = setTimeout(() => setShown(false), reduceMotion() ? 140 : 420);
  }, [open]);

  // One highlight glides to the active option; keyboard moves keep it in view.
  useLayoutEffect(() => {
    const h = hl.current;
    const s = surf.current;
    if (!h || !s) return;
    const o = active >= 0 ? s.querySelector('#' + CSS.escape(`${uid}-o${active}`)) : null;
    if (!o) { h.style.opacity = '0'; return; }
    const first = h.dataset.placed !== '1';
    if (first) h.style.transition = 'none';
    h.style.transform = `translateY(${o.offsetTop}px)`;
    h.style.height = o.offsetHeight + 'px';
    h.style.opacity = '1';
    if (first) { h.getBoundingClientRect(); h.style.transition = ''; h.dataset.placed = '1'; }
    const sc = scroller.current;
    if (sc && keyNav.current) {
      const pad = 6;
      const y = o.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      if (y < sc.scrollTop + pad) sc.scrollTop = y - pad;
      else if (y + o.offsetHeight > sc.scrollTop + sc.clientHeight - pad) sc.scrollTop = y + o.offsetHeight - sc.clientHeight + pad;
    }
  }, [active, shown]);

  // While open: a press elsewhere closes it; the surface follows its trigger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (surf.current && surf.current.contains(e.target)) return;
      if (trig.current && trig.current.contains(e.target)) return;
      setOpen(false);
    };
    const onMove = (e) => {
      if (e && e.target instanceof Node && surf.current && surf.current.contains(e.target)) return;
      if (!surf.current || !trig.current) return;
      const g = measure();
      geo.current = g;
      surf.current.style.transition = 'none';
      apply(g, true);
      surf.current.getBoundingClientRect();
      surf.current.style.transition = '';
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const openAt = (i, byKey) => {
    keyNav.current = byKey;
    setActive(i);
    setOpen(true);
    setShown(true);
  };
  const pick = (i) => {
    const o = options[i];
    if (o && !o.disabled && o.value !== value) onChange(o.value);
    setOpen(false);
  };
  const usable = (i) => i >= 0 && i < n && !options[i].disabled;
  const move = (from, d) => {
    let i = from;
    for (let k = 0; k < n; k++) {
      const next = Math.max(0, Math.min(n - 1, i + d));
      if (next === i) break;
      i = next;
      if (usable(i)) return i;
      d = Math.sign(d);
    }
    return usable(from) ? from : sel;
  };
  // Type-ahead: characters typed in quick succession narrow the match; one character repeated cycles.
  // Punctuation and spaces don't count, so 1730 finds 17:30.
  const plain = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const findByText = (ch, from) => {
    const now = Date.now();
    const t = typed.current;
    t.s = now - t.t > 700 ? ch : t.s + ch;
    t.t = now;
    const q = plain(t.s);
    if (!q) return -1;
    const cycling = [...q].every((c) => c === q[0]);
    const needle = cycling ? q[0] : q;
    const start = cycling ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < n; k++) {
      const i = (start + k + n) % n;
      if (usable(i) && plain(options[i].label).startsWith(needle)) return i;
    }
    return -1;
  };
  const onKey = (e) => {
    if (!n) return;
    const k = e.key;
    const printable = k.length === 1 && k !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); openAt(sel, true); } else if (k === 'Home') { e.preventDefault(); openAt(move(-1, 1), true); } else if (k === 'End') { e.preventDefault(); openAt(move(n, -1), true); } else if (printable) {
        const i = findByText(k, sel);
        if (i >= 0) { e.preventDefault(); openAt(i, true); }
      }
      return;
    }
    keyNav.current = true;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } else if (k === 'Tab') setOpen(false);
    else if (k === 'ArrowDown') { e.preventDefault(); setActive(move(active, 1)); } else if (k === 'ArrowUp') { e.preventDefault(); if (e.altKey) pick(active); else setActive(move(active, -1)); } else if (k === 'PageDown') { e.preventDefault(); setActive(move(active, 8)); } else if (k === 'PageUp') { e.preventDefault(); setActive(move(active, -8)); } else if (k === 'Home') { e.preventDefault(); setActive(move(-1, 1)); } else if (k === 'End') { e.preventDefault(); setActive(move(n, -1)); } else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); pick(usable(active) ? active : sel); } else if (printable) {
      const i = findByText(k, active);
      if (i >= 0) { e.preventDefault(); setActive(i); }
    }
  };
  const onBlur = () => {
    if (!open) return;
    setTimeout(() => { if (trig.current && document.activeElement !== trig.current) setOpen(false); }, 0);
  };

  const listId = uid + '-list';
  const chevron = html`<span class="sel-chev"><${Icon} name="chevron" size=${16} stroke=${1.75} /></span>`;
  const surface = shown ? html`<${Layer}>
    <div ref=${surf} class=${'glass glass-strong sel-surface' + (shape === 'field' ? ' field' : '')}>
      <div class="sel-head" aria-hidden="true" onPointerDown=${(e) => e.preventDefault()} onClick=${() => setOpen(false)}>
        <span class="sel-value">${cur.label}</span>${chevron}
      </div>
      <div class="sel-divider"></div>
      <div class="sel-scroll" ref=${scroller} style=${{ maxHeight: maxListHeight + 'px' }}>
        <div class="sel-list" id=${listId} role="listbox" aria-labelledby=${labelledBy || undefined} aria-label=${labelledBy ? undefined : label}>
          <div class="sel-hl" ref=${hl} aria-hidden="true"></div>
          ${options.map((o, i) => html`<div key=${o.value} id=${`${uid}-o${i}`} role="option"
            aria-selected=${i === sel ? 'true' : 'false'} aria-disabled=${o.disabled ? 'true' : undefined}
            class=${'sel-opt' + (i === active ? ' active' : '')}
            onPointerMove=${(e) => { if (e.pointerType === 'mouse' && i !== active && usable(i)) { keyNav.current = false; setActive(i); } }}
            onPointerDown=${(e) => e.preventDefault()}
            onClick=${() => { if (usable(i)) pick(i); }}>
            <span class="sel-label">${o.label}</span>${o.meta ? html`<span class="sel-meta">${o.meta}</span>` : null}
            <span class="sel-check"><${Icon} name="check" size=${15} stroke=${2} /></span>
          </div>`)}
        </div>
      </div>
    </div>
  <//>` : null;
  return html`<span class=${'sel' + (fill ? ' fill' : '')}>
    <button type="button" id=${uid} ref=${trig} class=${'sel-trigger' + (shape === 'field' ? ' field' : '')}
      role="combobox" aria-haspopup="listbox" aria-expanded=${open ? 'true' : 'false'}
      aria-controls=${shown ? listId : undefined}
      aria-activedescendant=${open && active >= 0 ? `${uid}-o${active}` : undefined}
      aria-labelledby=${labelledBy ? `${labelledBy} ${uid}` : undefined} aria-label=${labelledBy ? undefined : label}
      onClick=${(e) => { if (e.detail === 0) return; if (open) setOpen(false); else openAt(sel, false); }}
      onKeyDown=${onKey} onBlur=${onBlur}>
      <span class="sel-measure" aria-hidden="true">${cur.label}</span>
      <span key=${cur.value} class=${'sel-value' + roll}>${cur.label}</span>${chevron}
    </button>${surface}
  </span>`;
}

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
      <p class="sub">Finito runs on this computer and logs time as you. Your token stays here.</p>
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
          <li><b>New token…</b>, name it “Finito”, scope <b>YouTrack</b>.</li>
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
  const [sugg, setSugg] = useState({ loading: true, items: [], unsorted: [], errors: [], monday: null });
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
      if (n === suggSeq.current) setSugg({ loading: false, items: r.suggestions || [], unsorted: r.unsorted || [], errors: r.errors || [], monday: start });
    } catch (e) {
      if (n === suggSeq.current) setSugg({ loading: false, items: [], unsorted: [], errors: [e.message], monday: start });
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
  const unsorted = sugg.monday === week.monday ? (sugg.unsorted || []).filter((u) => dates.some((d) => u.cells[d])) : [];

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

  // One more work item in a cell that may already hold some (another type on the same day).
  const addEntry = (issue, date, minutes, extra = {}) => serial(() => run(() => {
    const body = { issue, dates: [date], minutes };
    if (extra.type !== undefined) body.type = extra.type;
    if (extra.text) body.text = extra.text;
    return api('POST', '/entries', body);
  }));

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
        const res = await api('POST', '/entries', { issue: s.issue, dates: [s.date], minutes: s.minutes, typeHint: s.typeHint || undefined });
        keys.push(...(res.keys || []));
      }
      return keys;
    }, (keys) => [`Added ${fmt(list.reduce((a, s) => a + s.minutes, 0))}${list.length > 1 ? ` from ${list.length} suggestions` : ` to ${list[0].issue}`}`, 'info', { label: 'Undo', fn: undoDrafts(keys) }]));
    for (const s of list) inflight.current.delete(s.id);
    if (!r) loadSugg(week.monday);
  };
  // Dismissing hides suggestions for good, so the toast offers Undo.
  const dismissSuggestions = (list) => {
    if (!list.length) return;
    forgetSugg(list);
    const ids = list.map((s) => s.id);
    api('POST', '/suggestions/dismiss', { ids }).catch(() => {});
    const what = list.length === 1 ? `${fmt(list[0].minutes)} on ${list[0].issue}` : `${plural(list.length, 'suggestion', 'suggestions')} for ${list[0].issue}`;
    flash(`Dismissed ${what}`, 'info', { label: 'Undo', fn: async () => {
      setToast(null);
      try { await api('POST', '/suggestions/restore', { ids }); } catch (e) { flash(e.message, 'error'); return; }
      if (weekRef.current) loadSugg(weekRef.current.monday);
    } });
  };
  const dismissSuggestion = (s) => dismissSuggestions([s]);

  // Meetings and reviews without an issue: choose one (remembered from then on), or ignore them.
  const forgetUnsorted = (key, date) => setSugg((st) => ({
    ...st,
    unsorted: st.unsorted
      .map((u) => (u.key !== key ? u : date ? { ...u, cells: Object.fromEntries(Object.entries(u.cells).filter(([d]) => d !== date)) } : null))
      .filter((u) => u && Object.keys(u.cells).length),
  }));
  const unmapLater = (key) => async () => {
    setToast(null);
    try { await api('POST', '/suggestions/unmap', { key }); } catch (e) { flash(e.message, 'error'); return; }
    if (weekRef.current) loadSugg(weekRef.current.monday);
  };
  const mapRow = async (u, issue) => {
    forgetUnsorted(u.key);
    try {
      await api('POST', '/suggestions/map', { key: u.key, issue: issue.idReadable, label: u.label });
    } catch (e) {
      flash(e.message, 'error');
      if (weekRef.current) loadSugg(weekRef.current.monday);
      return;
    }
    if (weekRef.current) loadSugg(weekRef.current.monday);
    flash(`${u.kind === 'meeting' ? `“${u.label}”` : u.sub} goes to ${issue.idReadable} from now on`, 'info', { label: 'Undo', fn: unmapLater(u.key) });
  };
  const ignoreRow = (u) => {
    forgetUnsorted(u.key);
    api('POST', '/suggestions/map', { key: u.key, ignore: true, label: u.label }).catch(() => {});
    flash(`${u.kind === 'meeting' ? `“${u.label}”` : u.sub} won't be suggested again`, 'info', { label: 'Undo', fn: unmapLater(u.key) });
  };
  const dismissCell = (u, date) => {
    const id = u.key + '|' + date;
    forgetUnsorted(u.key, date);
    api('POST', '/suggestions/dismiss', { ids: [id] }).catch(() => {});
    flash(`Dismissed ${fmt(u.cells[date].minutes)} of ${u.kind === 'meeting' ? `“${u.label}”` : u.sub}`, 'info', { label: 'Undo', fn: async () => {
      setToast(null);
      try { await api('POST', '/suggestions/restore', { ids: [id] }); } catch (e) { flash(e.message, 'error'); return; }
      if (weekRef.current) loadSugg(weekRef.current.monday);
    } });
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
          onDismissIssue=${(id) => dismissSuggestions(suggestions.filter((x) => x.issue === id))}
          unsorted=${unsorted} onMap=${mapRow} onIgnore=${ignoreRow} onDismissCell=${dismissCell}
          onTimer=${(id) => (timer && timer.issue === id ? stopTimer({}) : startTimer(id))}
          onRemoveRow=${(id) => run(() => api('POST', '/rows', { monday: week.monday, action: 'remove', issue: id }))}
          adding=${adding} setAdding=${setAdding}
          onAddRow=${(i) => { setAdding(false); run(() => api('POST', '/rows', { monday: week.monday, action: 'add', issue: i.idReadable }), `${i.idReadable} added`); }}
          onCopyLast=${isThisWeek || week.monday > thisMonday ? () => run(
            () => api('POST', '/rows', { monday: week.monday, action: 'copy-previous' }),
            (r) => (r.added.length ? `Added ${r.added.join(', ')}` : 'Nothing new to copy') + (r.skipped.length ? ` · skipped ${r.skipped.join(', ')} (resolved)` : ''),
          ) : null}
        />
        ${sugg.errors.length ? html`<p class="paper-note">Some suggestions are missing. ${sugg.errors.join(' · ')}</p>` : null}
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
        onAdd=${addEntry}
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
      onSources=${() => loadSugg(week.monday)}
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
  const unsorted = p.unsorted || [];
  const [picking, setPicking] = useState(null);
  // A busy calendar shouldn't bury the week: the longest few show, the rest on request.
  const [allSort, setAllSort] = useState(false);
  const SORT_SHOWN = 5;
  const shownSort = allSort || unsorted.length <= SORT_SHOWN + 1 ? unsorted : unsorted.slice(0, SORT_SHOWN);
  const template = {
    '--cols': `minmax(var(--issue-w, 200px), 1fr) repeat(${cols.length}, minmax(var(--day-w, 78px), 108px)) var(--total-w, 80px)`,
    // Rows in the suggestions panel sit inset by --sugg-in on both sides. The first and last columns give up
    // that inset, so the day columns stay exactly under the week's.
    '--cols-in': `minmax(calc(var(--issue-w, 200px) - var(--sugg-in)), 1fr) repeat(${cols.length}, minmax(var(--day-w, 78px), 108px)) calc(var(--total-w, 80px) - var(--sugg-in))`,
    '--min': `calc(var(--issue-w, 200px) + ${cols.length} * var(--day-w, 78px) + var(--total-w, 80px))`,
  };
  const empty = !rowIds.length && !ghostIds.length && !unsorted.length;

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
          <${Icon} name=${suggIcon(s)} size=${11} stroke=${2} />${fmt(s.minutes)}
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
        ${ghost ? html`<button class="row-x" aria-label=${`Dismiss the suggestions for ${id}`} title="Dismiss" onClick=${() => p.onDismissIssue(id)}><${Icon} name="x" size=${12} stroke=${2.2} /></button>` : null}
      </div>
      ${cols.map((d) => cell(id, d, ghost))}
      <div class="rtotal">${total ? fmt(total) : ''}</div>
    </div>`;
  };

  const ghostTotal = suggestions.reduce((a, s) => a + s.minutes, 0);

  // A meeting or a review that names no issue: choose one, or never see it again.
  const sortRow = (u) => {
    const what = u.kind === 'meeting' ? `the meeting “${u.label}”` : `the review of ${u.sub}`;
    return html`<div class=${'wrow ghost-row sort-row' + (picking === u.key ? ' picking' : '')} key=${u.key} role="row">
      <div class="issue" role="rowheader">
        <span class="src-icon" aria-hidden="true"><${Icon} name=${u.kind === 'meeting' ? 'calendar' : 'review'} size=${14} /></span>
        ${picking === u.key
          ? html`<${AddIssue} compact minWidth=${380} exclude=${[]} placeholder=${u.kind === 'meeting' ? `Log “${u.label}” to…` : `Log this review to…`}
              onClose=${() => setPicking(null)} onPick=${(i) => { setPicking(null); p.onMap(u, i); }} />`
          : html`<div class="imeta">
              ${webUrl(u.url) ? html`<a class="ikey" href=${webUrl(u.url)} target="_blank" rel="noopener noreferrer" title="Open on GitHub">${u.sub}</a>` : html`<span class="ikey">${u.sub}</span>`}
              <span class="isum" title=${u.label}>${u.label}</span>
            </div>
            <button class="pick-btn" onClick=${() => setPicking(u.key)} aria-label=${`Choose an issue for ${what}`}><${Icon} name="plus" size=${12} stroke=${2.4} /><span>Choose issue</span></button>
            <button class="row-x" aria-label=${`Don't suggest ${what} again`} title="Don't suggest again" onClick=${() => p.onIgnore(u)}><${Icon} name="x" size=${12} stroke=${2.2} /></button>`}
      </div>
      ${cols.map((d) => {
        const c = u.cells[d];
        const cls = ['cell', d === today ? 'today' : '', isWorkDay(d) ? '' : 'off', c ? 'has-ghost' : ''].join(' ');
        if (!c) return html`<div class=${cls} key=${d} role="gridcell"></div>`;
        return html`<div class=${cls} key=${d} role="gridcell">
          <button class="ghost sort" onClick=${() => setPicking(u.key)}
            title=${`${u.label}, ${c.when}. Choose an issue to log it.`}
            aria-label=${`${u.label}, ${dayLabel(d)}: ${fmt(c.minutes)}, ${c.when}. Choose an issue to log it.`}>${fmt(c.minutes)}</button>
          <button class="ghost-x" aria-label=${`Dismiss ${u.label} on ${dayLabel(d)}`} title="Dismiss" onClick=${() => p.onDismissCell(u, d)}><${Icon} name="x" size=${11} stroke=${2.4} /></button>
        </div>`;
      })}
      <div class="rtotal"></div>
    </div>`;
  };

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
      <div class="wrow addline" role="row" key="add">
        <div class="addcell" role="gridcell">
          ${p.adding
            ? html`<${AddIssue} onClose=${() => p.setAdding(false)} onPick=${p.onAddRow} exclude=${rowIds} />`
            : html`<button class="add-btn" onClick=${() => p.setAdding(true)}><${Icon} name="plus" size=${14} stroke=${2.2} /> Add issue</button>`}
        </div>
      </div>
      ${ghostIds.length || unsorted.length ? html`<div class="sugg" role="rowgroup" key="sugg" aria-label="Suggested from your activity">
        <div class="wrow section" role="row">
          <div class="section-label" role="rowheader"><${Icon} name="sparkle" size=${13} /> From your activity</div>
          <div class="section-act" role="gridcell">
            ${suggestions.length ? html`<button class="link" onClick=${() => p.onAccept(suggestions)}>Add all · ${fmt(ghostTotal)}</button>` : null}
          </div>
        </div>
        ${ghostIds.map((id) => row(id, true))}
        ${unsorted.length ? html`<div class="wrow section sub" role="row" key="sort-head">
          <div class="section-label" role="rowheader">Not tied to an issue yet</div>
        </div>` : null}
        ${shownSort.map(sortRow)}
        ${shownSort.length < unsorted.length ? html`<div class="wrow section sub more" role="row" key="sort-more">
          <div class="section-label" role="gridcell"><button class="link" onClick=${() => setAllSort(true)}>Show ${unsorted.length - shownSort.length} more</button></div>
        </div>` : null}
      </div>` : null}
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

function AddIssue({ onClose, onPick, exclude, compact = false, placeholder, minWidth = 0, id = compact ? 'pickq' : 'rowq' }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [hi, setHi] = useState(0);
  const [fade, setFade] = useState('');
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const box = useRef(null);
  const field = useRef(null);
  const menu = useRef(null);
  const res = useRef(null);
  const posRef = useRef(null);
  const revealed = useRef(false);
  useLayoutEffect(() => { if (ref.current) ref.current.focus(); }, []);
  // The list stops at a few rows and scrolls; soft edges say there's more.
  const edges = () => {
    const r = res.current;
    if (!r) return;
    const more = r.scrollHeight - r.clientHeight > 1;
    const atTop = r.scrollTop < 2;
    const atEnd = r.scrollTop + r.clientHeight >= r.scrollHeight - 2;
    const f = !more ? '' : atTop ? 'end' : atEnd ? 'start' : 'both';
    setFade((prev) => (prev === f ? prev : f));
  };
  // The results drop down from the field on the layer above the page. Near the bar at the bottom,
  // they open upward instead.
  const place = () => {
    const f = field.current;
    const r0 = res.current;
    if (!f || !r0) return;
    const r = f.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const vw = document.documentElement.clientWidth;
    // A narrow field (choosing an issue inside a row) still gets a list wide enough to read.
    const width = Math.min(Math.max(r.width, minWidth), vw - 24);
    const left = Math.max(12, Math.min(r.left, vw - width - 12));
    const gap = 6;
    const want = Math.min(r0.scrollHeight, RESULTS_MAX) + 12;
    const below = vh - DOCK_ROOM - r.bottom - gap;
    const above = r.top - gap - 12;
    const up = want > below && above > below;
    const next = { left: Math.round(left), width: Math.round(width), y: Math.round(up ? vh - r.top + gap : r.bottom + gap), up, max: Math.max(64, Math.floor(up ? above : below)) };
    const prev = posRef.current;
    if (prev && prev.left === next.left && prev.width === next.width && prev.y === next.y && prev.up === next.up && prev.max === next.max) return;
    posRef.current = next;
    setPos(next);
  };
  // After every render: the list changes size as results come in.
  useLayoutEffect(() => { place(); });
  useLayoutEffect(() => {
    const onMove = () => requestAnimationFrame(place);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    // A press anywhere else closes the search, like any dropdown.
    const onDown = (e) => {
      if (box.current && box.current.contains(e.target)) return;
      if (menu.current && menu.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  useLayoutEffect(() => {
    const r = res.current;
    const o = r && r.querySelector('.result.hi');
    if (o) {
      if (o.offsetTop < r.scrollTop + 4) r.scrollTop = o.offsetTop - 4;
      else if (o.offsetTop + o.offsetHeight > r.scrollTop + r.clientHeight - 4) r.scrollTop = o.offsetTop + o.offsetHeight - r.clientHeight + 4;
    }
    edges();
  }, [hi, list, pos]);
  // When results first arrive, scroll the page so they fit under the field, without pushing it under the top bar.
  useLayoutEffect(() => {
    if (list === null || revealed.current || !field.current || !res.current) return;
    revealed.current = true;
    const r = field.current.getBoundingClientRect();
    const want = Math.min(res.current.scrollHeight, RESULTS_MAX) + 12 + 6;
    const by = Math.min(want - (document.documentElement.clientHeight - DOCK_ROOM - r.bottom), r.top - TOP_ROOM);
    if (by > 0) window.scrollBy({ top: by, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, [list]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api('GET', '/issues/search?q=' + enc(q.trim()))
        .then((r) => { if (alive) { setList((r.issues || []).filter((i) => !exclude.includes(i.idReadable))); setErr(''); setHi(0); } })
        .catch((e) => { if (alive) setErr(e.message); });
    }, q ? 280 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const items = (list || []).slice(0, 15);
  const style = pos
    ? { left: pos.left + 'px', width: pos.width + 'px', top: pos.up ? 'auto' : pos.y + 'px', bottom: pos.up ? pos.y + 'px' : 'auto', maxHeight: pos.max + 'px' }
    : { left: '0px', top: '0px', opacity: 0, pointerEvents: 'none' };
  return html`<div class=${'addissue' + (compact ? ' compact' : '')} ref=${box}
    onFocusOut=${(e) => {
      // Tabbing away closes it too; a press on a result keeps focus in the field.
      const t = e.relatedTarget;
      if (!t || (box.current && box.current.contains(t)) || (menu.current && menu.current.contains(t))) return;
      onClose();
    }}>
    <div class="addissue-field" ref=${field}>
      <${Icon} name="search" size=${15} />
      <input id=${id} ref=${ref} value=${q} placeholder=${placeholder || 'Find an issue: ID or a few words'} autocomplete="off" aria-label=${placeholder || 'Find an issue to add'}
        role="combobox" aria-expanded="true" aria-controls=${id + '-list'} aria-autocomplete="list" aria-activedescendant=${items[hi] ? id + '-o' + hi : undefined}
        onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, items.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); } else if (e.key === 'Enter' && items[hi]) { e.preventDefault(); onPick(items[hi]); }
        }} />
      ${compact ? null : html`<button class="btn btn-quiet btn-sm" onClick=${onClose}>Cancel</button>`}
    </div>
    <${Layer}>
      <div class=${'glass glass-strong addmenu' + (pos ? ' in' : '') + (pos && pos.up ? ' up' : '')} ref=${menu} style=${style}>
        <div class="results" id=${id + '-list'} ref=${res} data-fade=${fade || undefined} onScroll=${edges} role="listbox" aria-label="Issues">
          ${err ? html`<div class="err-line pad">${err}</div>` : null}
          ${list === null ? html`<div class="muted small pad">Searching…</div>`
            : items.length ? items.map((i, n) => html`<button key=${i.idReadable} id=${id + '-o' + n} role="option" tabindex="-1" aria-selected=${n === hi} class=${'result' + (n === hi ? ' hi' : '')}
              onPointerDown=${(e) => e.preventDefault()} onClick=${() => onPick(i)} onPointerMove=${(e) => { if (e.pointerType === 'mouse' && n !== hi) setHi(n); }}>
              <span class="mono">${i.idReadable}</span><span class="ell">${i.summary}</span></button>`)
              : html`<div class="muted small pad">No issues match.</div>`}
        </div>
      </div>
    <//>
  </div>`;
}

// Links from GitHub become links only if they are web addresses.
const webUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : null);

// A suggestion that comes only from meetings, or only from reviews, says so.
function suggIcon(s) {
  const src = s.sources;
  if (!src) return 'sparkle';
  if (src.meetings && !src.activity && !src.reviews) return 'calendar';
  if (src.reviews && !src.activity && !src.meetings) return 'review';
  return 'sparkle';
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
    const dock = DOCK_ROOM;
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
      // An open select inside the editor draws its list on another layer.
      if (e.target instanceof Element && e.target.closest('[data-layer="select"]')) return;
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
  // "Add another entry" turns a one-entry cell into the list, so a day can hold Research and Development.
  const [listOpen, setListOpen] = useState(false);
  const [newRow, setNewRow] = useState(false);
  const single = entries.length <= 1 && !listOpen;
  const item = single ? entries[0] || null : null;
  const addBtn = useRef(null);
  const hadNewRow = useRef(false);
  useLayoutEffect(() => {
    // After a new entry is added, focus waits on the button for the next one.
    if (hadNewRow.current && !newRow && addBtn.current) addBtn.current.focus();
    hadNewRow.current = newRow;
  }, [newRow]);
  const hasInitial = initial !== null && initial !== undefined;
  // Frozen when the editor opens: a suggestion that disappears later must not turn into a log.
  const [suggestion] = useState(props.suggestion || null);
  const [offered] = useState(() => !item && !!suggestion && !hasInitial);
  const [start] = useState(() => (hasInitial ? initial : cur ? fmt(cur) : offered ? fmt(suggestion.minutes) : ''));
  const [text, setText] = useState(start);
  // Time suggested from meetings or reviews proposes that kind of work, if the project has it.
  const [hinted] = useState(() => {
    if (!offered || !Array.isArray(suggestion.typeHint) || !Array.isArray(types)) return null;
    for (const h of suggestion.typeHint) {
      const t = types.find((x) => x.toLowerCase() === String(h).toLowerCase());
      if (t) return t;
    }
    return null;
  });
  const [type, setType] = useState(item ? item.type || '' : hinted || '');
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
  const typeTouched = useRef(!!hinted);
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
  // From one entry to the list: write this entry first, then open a blank one under it.
  const addAnother = () => {
    explicit.current = true;
    if (!validate()) return;
    if (!item && !parseDuration(value())) { if (input.current) input.current.focus(); return; }
    flushNote();
    setListOpen(true);
    setNewRow(true);
    props.onCommit(value(), extra());
  };
  const addNew = (minutes, ex) => { setNewRow(false); return props.onAdd(issue, date, minutes, ex); };
  const addButton = (onClick, disabled) => html`<button class="ed-add" ref=${addBtn} onClick=${onClick} disabled=${disabled}>
    <${Icon} name="plus" size=${13} stroke=${2.2} /> Add another entry</button>`;

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
        ${newRow ? html`<${NewItemRow} key="new" types=${types} defType=${defType} cancelled=${cancelled} register=${register}
          onAdd=${addNew} onDiscard=${() => setNewRow(false)} />` : null}
      </div>
      ${newRow ? null : addButton(() => setNewRow(true), false)}
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
        ${offered ? html`<div class="ed-hint"><${Icon} name="sparkle" size=${12} /> <span>Suggested from ${suggestion.title}, ${suggestion.when}. Enter adds it.${(suggestion.refs || []).filter((r) => webUrl(r.url)).map((r) => html` <a class="ed-ref" href=${webUrl(r.url)} target="_blank" rel="noopener noreferrer" title=${r.title || r.label}>${r.label.replace(/^[^/]+\//, '')}<${Icon} name="external" size=${11} /></a>`)}</span></div>` : null}
        ${types.length ? html`<div class="ed-row"><span id="ed-type-label">Type</span>
          <${Select} shape="field" fill labelledBy="ed-type-label" value=${type}
            options=${[
              ...(item || !defType ? [{ value: '', label: 'No type' }] : [{ value: '', label: defType, meta: 'default' }, { value: '-', label: 'No type' }]),
              ...types.map((t) => ({ value: t, label: t })),
            ]}
            onChange=${(v) => {
              typeTouched.current = true;
              setType(v);
              if (item) props.onPatch(item, { type: v || null });
            }} />
        </div>` : null}
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
        ${addButton(addAnother, !item && !(parseDuration(text) > 0))}
        ${item && item.error ? html`<div class="err-line">Couldn't send: ${item.error}</div>` : null}
        <div class="ed-foot">
          <span class=${'ed-status s-' + (item ? item.status : 'new')}>${item ? STATUS_TEXT[item.status] : 'Enter to log · Tab for the next day'}</span>
          <span class="grow"></span>
          ${item ? html`<button class="btn btn-sm btn-quiet danger" onClick=${() => { cancel(); props.onRemove(item); props.onClose(false); }}>Remove</button>` : null}
          <button class="btn btn-sm" onClick=${props.onTimer} disabled=${timerHere} title="Start a timer on this issue"><${Icon} name="play" size=${12} /> Timer</button>
        </div>`}
  </div>`;
}

// A blank work item at the end of the cell's list. Enter adds it; closing the editor adds it too when
// it holds a time; Escape or × drops it. Its type starts on the project's default, like a new cell.
function NewItemRow({ types, defType, cancelled, register, onAdd, onDiscard }) {
  const [t, setT] = useState('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [bad, setBad] = useState(false);
  const live = useRef({});
  Object.assign(live.current, { t, type, note });
  const input = useRef(null);
  useLayoutEffect(() => { if (input.current) input.current.focus(); }, []);
  const minutes = () => (live.current.t.trim() ? parseDuration(live.current.t) : 0);
  const typeValue = () => {
    const x = live.current;
    if (!x.typeTouched) return undefined;
    if (x.type === '-') return null;
    if (x.type === '') return defType ? undefined : null;
    return x.type;
  };
  const save = () => {
    const x = live.current;
    const m = minutes();
    if (x.saved || cancelled.current || !m || m > 1440) return false;
    x.saved = true;
    onAdd(m, { type: typeValue(), text: x.note.trim() });
    return true;
  };
  useEffect(() => register(save), []);
  const enter = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const m = minutes();
    if (!m || m > 1440) { setBad(true); if (input.current) input.current.focus(); return; }
    save();
  };
  return html`<div class="item new">
    <input ref=${input} class=${'item-t' + (bad ? ' bad' : '')} value=${t} placeholder="0h" aria-label="Time for the new work item" aria-invalid=${bad}
      onInput=${(e) => { setBad(false); setT(e.target.value); }} onKeyDown=${enter} autocomplete="off" spellcheck=${false} />
    ${types.length ? html`<${Select} shape="field" fill label="Type for the new work item" value=${type}
      options=${[...(defType ? [{ value: '', label: defType, meta: 'default' }, { value: '-', label: 'No type' }] : [{ value: '', label: 'No type' }]), ...types.map((x) => ({ value: x, label: x }))]}
      onChange=${(v) => { live.current.typeTouched = true; setType(v); }} />` : null}
    <input class="item-note" value=${note} placeholder="Note" aria-label="Note for the new work item" onInput=${(e) => setNote(e.target.value)} onKeyDown=${enter} />
    <button class="icon-btn" aria-label="Drop the new work item" onClick=${onDiscard}><${Icon} name="x" size=${12} stroke=${2.2} /></button>
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
    ${types.length ? html`<${Select} shape="field" fill label="Type" value=${e.type || ''}
      options=${[{ value: '', label: 'No type' }, ...types.map((x) => ({ value: x, label: x }))]}
      onChange=${(v) => onPatch(e, { type: v || null })} />` : null}
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

// Where suggestions come from besides YouTrack: a calendar and GitHub. Connecting saves at
// once (like Change for YouTrack), apart from the sheet's Save.
const SOURCE_TEXT = {
  calendar: {
    name: 'Calendar',
    off: 'Meetings, from its secret iCal address',
    field: 'Secret address in iCal format',
    input: 'url',
    placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    help: html`Google Calendar: <b>Settings</b> → your calendar → <b>Integrate calendar</b> → <b>Secret address in iCal format</b>. Outlook: <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b> → <b>Publish a calendar</b> → the ICS link. It stays on this computer.`,
  },
  github: {
    name: 'GitHub reviews',
    off: 'Pull requests you review',
    field: 'Personal access token',
    input: 'password',
    placeholder: 'github_pat_…',
    help: html`In GitHub: <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b>. Read access to pull requests is enough; a classic token needs the <b>repo</b> scope only for private repositories. It stays on this computer.`,
  },
};

function SourcesGroup({ onChanged }) {
  const [src, setSrc] = useState(null);
  const [open, setOpen] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const field = useRef(null);
  useEffect(() => { api('GET', '/sources').then(setSrc).catch((e) => setErr(e.message)); }, []);
  useLayoutEffect(() => { if (open && field.current) field.current.focus(); }, [open]);
  const start = (kind) => { setOpen(kind); setValue(''); setErr(''); };
  const connect = async (kind) => {
    if (!value.trim()) { if (field.current) field.current.focus(); return; }
    setBusy(true);
    setErr('');
    try {
      setSrc(await api('POST', '/sources/' + kind, kind === 'calendar' ? { url: value } : { token: value }));
      setOpen(null);
      setValue('');
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (kind) => {
    setErr('');
    try { setSrc(await api('POST', `/sources/${kind}/remove`)); onChanged(); } catch (e) { setErr(e.message); }
  };
  const forget = async (m) => {
    setErr('');
    try { await api('POST', '/suggestions/unmap', { key: m.key }); setSrc(await api('GET', '/sources')); onChanged(); } catch (e) { setErr(e.message); }
  };
  const row = (kind) => {
    const t = SOURCE_TEXT[kind];
    const st = src && src[kind];
    if (open === kind) {
      return html`<div class="srow src-form" key=${kind}>
        <label class="src-label" for=${'src-' + kind}>${t.field}</label>
        <input id=${'src-' + kind} ref=${field} type=${t.input} value=${value} placeholder=${t.placeholder} autocomplete="off" spellcheck="false"
          onInput=${(e) => setValue(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); connect(kind); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(null); } }} />
        <p class="src-help">${t.help}</p>
        <div class="src-acts">
          <button class="btn btn-quiet btn-sm" onClick=${() => setOpen(null)}>Cancel</button>
          <button class="btn btn-accent btn-sm" onClick=${() => connect(kind)} disabled=${busy}>${busy ? 'Checking…' : 'Connect'}</button>
        </div>
      </div>`;
    }
    if (st && st.connected) {
      const who = kind === 'calendar' ? st.name || 'Connected' : '@' + st.login;
      return html`<div class="srow account" key=${kind}><span>${t.name}<span class="muted small block">${who}</span></span>
        <span class="srow-acts"><button class="btn btn-sm" onClick=${() => remove(kind)}>Remove</button></span></div>`;
    }
    return html`<div class="srow account" key=${kind}><span>${t.name}<span class="muted small block">${t.off}</span></span>
      <span class="srow-acts"><button class="btn btn-sm" onClick=${() => start(kind)} disabled=${!src}>Connect</button></span></div>`;
  };
  const maps = (src && src.mappings) || [];
  return html`<div class="group">
    <div class="group-title">Suggestions from</div>
    <div class="srow account"><span>YouTrack activity<span class="muted small block">Comments, field changes, commits and more</span></span><span class="muted small">Always</span></div>
    ${row('calendar')}
    ${row('github')}
    ${maps.length ? html`<div class="srow remembered">
      <span class="muted small">Remembered</span>
      <ul class="maps">${maps.map((m) => html`<li key=${m.key}>
        <span class="ell"><${Icon} name=${m.kind === 'meeting' ? 'calendar' : 'review'} size=${12} /> ${m.label}</span>
        <span class="map-to">${m.ignore ? 'never suggested' : html`→ <span class="mono">${m.issue}</span>`}</span>
        <button class="row-x" aria-label=${`Forget the choice for ${m.label}`} title="Forget" onClick=${() => forget(m)}><${Icon} name="x" size=${11} stroke=${2.2} /></button>
      </li>`)}</ul>
    </div>` : null}
    ${err ? html`<p class="form-error src-error" role="alert">${err}</p>` : null}
  </div>`;
}

function SettingsSheet({ week, status, onClose, onSaved, onReload, onReconnect, onSources }) {
  const s = week.settings;
  const [target, setTarget] = useState(fmt(s.dailyTargetMinutes));
  const [workDays, setWorkDays] = useState(s.workDays);
  const [rounding, setRounding] = useState(String(s.timerRounding));
  const [dayEnds, setDayEnds] = useState(s.dayEnds);
  const [defs, setDefs] = useState(Object.assign({}, s.typeDefaults));
  const [theme, setTheme] = useState(readTheme);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The theme shows as soon as it's picked; Cancel puts the old one back.
  const themeBefore = useRef(theme);
  const themeKept = useRef(false);
  useEffect(() => () => { if (!themeKept.current) showTheme(themeBefore.current); }, []);
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
      saveTheme(theme);
      themeKept.current = true;
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
      <div class="srow"><span id="s-end-label">My day ends at</span>
        <${Select} id="s-end" labelledBy="s-end-label" value=${dayEnds} minWidth=${120} align="end" onChange=${setDayEnds}
          options=${(QUARTERS.includes(dayEnds) ? QUARTERS : [...QUARTERS, dayEnds].sort()).map((t) => ({ value: t, label: t }))} /></div>
      <div class="srow"><span id="s-round-label">Round timers to</span>
        <${Select} id="s-round" labelledBy="s-round-label" value=${rounding} minWidth=${120} align="end" onChange=${setRounding}
          options=${['1', '5', '10', '15', '30'].map((v) => ({ value: v, label: v === '1' ? 'the minute' : v + ' min' }))} /></div>
    </div>
    <div class="group">
      <div class="group-title">Default work type</div>
      ${projectList.length ? projectList.map((p) => html`<div class="srow" key=${p.shortName}>
        <span id=${'t-' + p.shortName + '-label'}><span class="mono">${p.shortName}</span>${p.name && p.name !== p.shortName ? html` <span class="muted small">${p.name}</span>` : null}</span>
        <${Select} id=${'t-' + p.shortName} labelledBy=${'t-' + p.shortName + '-label'} value=${defs[p.shortName] || ''} minWidth=${150} align="end"
          options=${[{ value: '', label: 'None' }, ...(p.types || []).map((t) => ({ value: t, label: t }))]}
          onChange=${(v) => setDefs(Object.assign({}, defs, { [p.shortName]: v }))} />
      </div>`) : html`<div class="srow muted small">Projects appear here once you've logged on them.</div>`}
    </div>
    <${SourcesGroup} onChanged=${onSources || (() => {})} />
    <div class="group">
      <div class="group-title">Appearance</div>
      <div class="srow"><span id="s-theme-label">Theme</span>
        <${Select} id="s-theme" labelledBy="s-theme-label" value=${theme} minWidth=${120} align="end"
          onChange=${(v) => { setTheme(v); showTheme(v); }}
          options=${[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
    </div>
    <div class="group">
      <div class="group-title">YouTrack</div>
      <div class="srow account"><span>${status.user ? status.user.fullName || status.user.login : 'Connected'}<span class="muted small block">${host}</span></span>
        <span class="srow-acts"><button class="btn btn-sm" onClick=${onReload}>Reload</button><button class="btn btn-sm" onClick=${onReconnect}>Change</button></span></div>
    </div>
    ${err ? html`<p class="form-error" role="alert">${err}</p>` : null}
  <//>`;
}

render(html`<${App} />`, document.getElementById('root'));
