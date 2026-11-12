const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('frame scripts can resolve the top-level site for the site-off setting', () => {
  let listener;
  const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/background.js'), 'utf8'), { chrome, URL });
  let response;
  listener({ type: 'lexlens:top-host' }, {
    tab: { url: 'https://reader.example/article' },
    url: 'https://embedded.example/frame'
  }, value => { response = value; });
  assert.equal(response.hostname, 'reader.example');
});
