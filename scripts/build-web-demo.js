'use strict';

// Builds the browser-only demo into dist-demo/: the normal web app plus finito-demo.js,
// which runs Finito's own server code and the sample data (test/mock-*.js) in the page.
// No dependencies: the server code is plain CommonJS, so a small bundler is enough.
//
//   node scripts/build-web-demo.js [outDir]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist-demo'));
const shims = { fs: 'web-demo/fs.js', path: 'web-demo/path.js', http: 'web-demo/http.js', child_process: 'web-demo/child_process.js' };

const modules = new Map(); // relative path -> { code, deps }
function add(rel) {
  if (modules.has(rel)) return;
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  const deps = {};
  modules.set(rel, { code, deps });
  for (const [, spec] of code.matchAll(/require\('([^']+)'\)/g)) {
    let dep;
    if (shims[spec]) dep = shims[spec];
    else if (spec.startsWith('.')) dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)).replace(/(\.js)?$/, '.js');
    else throw new Error(`${rel} needs '${spec}', which the web demo has no stand-in for.`);
    deps[spec] = dep;
    add(dep);
  }
}
add('web-demo/entry.js');

const defs = [...modules].map(([rel, m]) => `${JSON.stringify(rel)}: [${JSON.stringify(m.deps)}, function (module, exports, require, __dirname) {\n${m.code}\n}]`);
const bundle = `// Finito web demo: built by scripts/build-web-demo.js from lib/, test/mock-*.js and web-demo/. Do not edit.
(function () {
  'use strict';
  window.process = window.process || { platform: 'browser', env: {}, versions: { node: '20' } };
  window.Buffer = window.Buffer || { concat: (parts) => ({ toString: () => parts.join('') }) };
  var defs = {
${defs.join(',\n')}
  };
  var cache = {};
  function load(rel) {
    if (cache[rel]) return cache[rel].exports;
    var def = defs[rel];
    var module = cache[rel] = { exports: {} };
    def[1](module, module.exports, function (spec) { return load(def[0][spec]); }, '/' + rel.replace(/\\/[^/]*$/, ''));
    return module.exports;
  }
  load('web-demo/entry.js');
})();
`;

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true, filter: (src) => path.basename(src) !== 'package.json' });
fs.writeFileSync(path.join(out, 'finito-demo.js'), bundle);
// The demo backend has to be in place before app.js makes its first request.
const index = path.join(out, 'index.html');
const html = fs.readFileSync(index, 'utf8').replace('<script src="theme.js"></script>', '<script src="theme.js"></script>\n<script src="finito-demo.js"></script>');
if (!html.includes('finito-demo.js')) throw new Error('index.html changed: put the finito-demo.js script back in by hand.');
fs.writeFileSync(index, html.replace('<title>Finito</title>', '<title>Finito demo</title>'));
console.log(`Web demo built in ${path.relative(process.cwd(), out) || '.'} (${modules.size} modules).`);
