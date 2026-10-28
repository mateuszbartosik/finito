// Liquid glass for the control layer.
// Everywhere: frosted blur, a lit rim and a sheen (CSS, see .glass in app.css).
// In Chromium (Chrome, Edge): the rim also bends what's behind it, through an SVG
// displacement filter used as backdrop-filter. Other browsers keep the frosted look.

import { useLayoutEffect } from './vendor/preact-htm.js';

const NS = 'http://www.w3.org/2000/svg';
const ua = navigator.userAgent || '';
const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/.test(b.brand))
  || (/Chrome\/\d+/.test(ua) && !/Firefox\//.test(ua));

const query = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false });
const lessTransparency = query('(prefers-reduced-transparency: reduce)');
const moreContrast = query('(prefers-contrast: more)');

export function refractionOn() {
  return chromium && !lessTransparency.matches && !moreContrast.matches
    && !document.documentElement.classList.contains('no-refract');
}

let defs = null;
let seq = 0;

function ensureDefs() {
  if (defs && defs.isConnected) return defs;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

// A displacement map for a rounded rectangle: zero in the middle, pulling the backdrop
// inward along the rim, so the edge of the glass reads as a lens.
const maps = new Map();
function displacementMap(w, h, r, bezel) {
  const key = `${w}x${h}:${r}:${bezel}`;
  if (maps.has(key)) return maps.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const hw = w / 2;
  const hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
      let dx = 0;
      let dy = 0;
      if (inside > 0 && inside < bezel) {
        const t = 1 - inside / bezel;
        const m = t * t;
        let nx = 0;
        let ny = 0;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; } else if (qx > qy) nx = 1; else ny = 1;
        dx = -nx * (Math.sign(px) || 1) * m;
        dy = -ny * (Math.sign(py) || 1) * m;
      }
      const i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (maps.size > 40) maps.clear();
  maps.set(key, url);
  return url;
}

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// Give an element refraction. `opts` null switches it off.
export function useGlass(ref, opts) {
  const on = !!opts;
  const { radius, bezel = 16, scale = 34, blur = 4, saturate = 1.7 } = opts || {};
  useLayoutEffect(() => {
    const node = ref.current;
    if (!on || !node || !refractionOn() || typeof ResizeObserver === 'undefined') return undefined;
    const id = 'lg' + (++seq);
    const filter = el('filter', {
      id, x: 0, y: 0, width: 1, height: 1,
      filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB',
    });
    const fBlur = el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: blur, result: 'soft' });
    const fMap = el('feImage', { x: 0, y: 0, width: 1, height: 1, result: 'map', preserveAspectRatio: 'none' });
    const fBend = el('feDisplacementMap', { in: 'soft', in2: 'map', scale, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' });
    const fSat = el('feColorMatrix', { in: 'bent', type: 'saturate', values: saturate });
    filter.append(fBlur, fMap, fBend, fSat);
    ensureDefs().appendChild(filter);

    let last = '';
    let frame = 0;
    const fit = () => {
      frame = 0;
      const w = Math.round(node.offsetWidth);
      const h = Math.round(node.offsetHeight);
      if (!w || !h) return;
      const sizeKey = w + 'x' + h;
      if (sizeKey === last) return;
      last = sizeKey;
      const r = Math.min(radius === undefined ? h / 2 : radius, w / 2, h / 2);
      const b = Math.max(2, Math.min(bezel, r, w / 2, h / 2));
      for (const n of [filter, fMap]) { n.setAttribute('width', w); n.setAttribute('height', h); }
      fMap.setAttribute('href', displacementMap(w, h, r, b));
      node.style.backdropFilter = `url(#${id})`;
      node.classList.add('refract');
    };
    fit();
    const ro = new ResizeObserver(() => { if (!frame) frame = requestAnimationFrame(fit); });
    ro.observe(node);
    return () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      filter.remove();
      node.style.backdropFilter = '';
      node.classList.remove('refract');
    };
  }, [on, radius, bezel, scale, blur, saturate]);
}

// A soft highlight that follows the pointer across a glass surface.
export function useSheen(ref) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || query('(prefers-reduced-motion: reduce)').matches) return undefined;
    let frame = 0;
    let ev = null;
    const paint = () => {
      frame = 0;
      const r = node.getBoundingClientRect();
      node.style.setProperty('--mx', `${Math.round(((ev.clientX - r.left) / r.width) * 100)}%`);
    };
    const move = (e) => { ev = e; if (!frame) frame = requestAnimationFrame(paint); };
    const leave = () => node.style.removeProperty('--mx');
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    return () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
