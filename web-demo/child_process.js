'use strict';

// The demo never opens a browser window; this only satisfies the require.
module.exports = { spawn() { return { on() {}, unref() {} }; } };
