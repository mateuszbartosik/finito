'use strict';

const fs = require('fs');
const path = require('path');

// A small JSON file with defaults, written atomically (temp file + rename).
class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = null;
  }

  load() {
    if (this.data) return this.data;
    let parsed = {};
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep a copy of a file we couldn't read instead of silently overwriting it.
        try { fs.copyFileSync(this.file, this.file + '.unreadable-' + Date.now()); } catch (_) { /* ignore */ }
      }
    }
    this.data = Object.assign(structuredClone(this.defaults), parsed);
    return this.data;
  }

  save() {
    if (!this.data) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const text = JSON.stringify(this.data, null, 2);
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      // Windows can refuse a rename while another process (antivirus, sync) holds the file.
      fs.writeFileSync(this.file, text, { mode: 0o600 });
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
  }

  update(fn) {
    const d = this.load();
    fn(d);
    this.save();
    return d;
  }
}

module.exports = { JsonFile };
