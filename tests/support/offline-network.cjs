// Test-runner preload: synthetic credentials must never reach an external service.
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const check = value => {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  if (!allowed.has(url.hostname)) throw new Error(`Offline verification blocked external request to ${url.hostname}`);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  check(input);
  return originalFetch.call(this, input, init);
};
// Cover libraries that bypass fetch, too (including Next's font downloader).
for (const protocol of ['http', 'https']) {
  const mod = require('node:' + protocol);
  for (const name of ['request', 'get']) {
    const original = mod[name];
    mod[name] = function(input, ...args) {
      if (typeof input === 'string' || input instanceof URL) check(input);
      else {
        const host = input.hostname || input.host || 'localhost';
        if (!allowed.has(host)) throw new Error(`Offline verification blocked external request to ${host}`);
      }
      return original.call(this, input, ...args);
    };
  }
}
