'use strict';

// Browser stand-in for Node's path module: POSIX paths only, which is all the demo uses.

function normalize(p) {
  const abs = p.startsWith('/');
  const out = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}

module.exports = {
  sep: '/',
  normalize,
  join: (...parts) => normalize(parts.filter(Boolean).join('/')),
  resolve: (...parts) => normalize('/' + parts.filter(Boolean).join('/')),
  dirname: (p) => normalize(p).replace(/\/[^/]*$/, '') || '/',
  extname: (p) => { const m = /\.[^./]*$/.exec(p); return m ? m[0] : ''; },
};
