'use strict';

// Browser stand-in for the parts of Node's fs that Finito's JSON files use. Files live in
// memory, so a reload starts the demo fresh.

const files = new Map();

function missing(file) {
  const e = new Error(`ENOENT: no such file, open '${file}'`);
  e.code = 'ENOENT';
  return e;
}

module.exports = {
  readFileSync(file) { if (!files.has(file)) throw missing(file); return files.get(file); },
  writeFileSync(file, text) { files.set(file, String(text)); },
  renameSync(from, to) { if (!files.has(from)) throw missing(from); files.set(to, files.get(from)); files.delete(from); },
  copyFileSync(from, to) { if (!files.has(from)) throw missing(from); files.set(to, files.get(from)); },
  unlinkSync(file) { files.delete(file); },
  mkdirSync() {},
  rmSync() {},
  readFile(file, cb) { setTimeout(() => (files.has(file) ? cb(null, files.get(file)) : cb(missing(file))), 0); },
};
