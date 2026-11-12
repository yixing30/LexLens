const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/core.js');

test('opening the popup starts annotation when the page has no content script', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {}, append() {} });
    return elements.get(id);
  };
  const calls = [];
  let messages = 0;
  const chrome = {
    storage: { local: {
      get(_keys, callback) { callback({}); },
      set(_value, callback) { callback(); }
    } },
    runtime: {
      lastError: null,
      getURL(path) { return `chrome-extension://test/${path}`; },
      openOptionsPage() {}
    },
    tabs: {
      query(_query, callback) { callback([{ id: 7, url: 'https://example.org/article' }]); },
      sendMessage(_id, _message, callback) {
        messages++;
        chrome.runtime.lastError = messages === 1 ? { message: 'No receiving end' } : null;
        callback(messages === 1 ? undefined : {
          ok: true, ready: true, scanning: false, marked: 3,
          siteDisabled: false, englishEnabled: true
        });
      }
    },
    scripting: {
      insertCSS(options) { calls.push(['css', options.files]); return Promise.resolve(); },
      executeScript(options) { calls.push(['js', options.files]); return Promise.resolve(); }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/popup.js'), 'utf8'), {
    chrome, LexLensCore: core, document: { getElementById: element, createElement: () => ({}) },
    window: { close() {} }, URL, setTimeout, clearTimeout
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['css', ['src/content.css']],
    ['js', ['data/english-levels.js', 'data/english-inline.js', 'data/english-auto.js', 'src/core.js', 'src/content.js']]
  ]);
  assert.equal(messages, 2);
  assert.match(element('status').textContent, /上方释义 3 处/);
});

test('an initial false zero triggers one real page rescan', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener() {}, append() {} });
    return elements.get(id);
  };
  const sent = [];
  const chrome = {
    storage: { local: { get(_keys, callback) { callback({}); }, set(_value, callback) { callback(); } } },
    runtime: { lastError: null, getURL(path) { return `chrome-extension://test/${path}`; } },
    tabs: {
      query(_query, callback) { callback([{ id: 7, url: 'https://example.org/article' }]); },
      sendMessage(_id, message, callback) {
        sent.push(message.type);
        callback(message.type === 'lexlens:rescan' ? { ok: true } : {
          ok: true, ready: true, scanning: false, marked: sent.length > 2 ? 2 : 0,
          highlighted: 0, siteDisabled: false, englishEnabled: true,
          englishEvidence: 'sourced'
        });
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/popup.js'), 'utf8'), {
    chrome, LexLensCore: core, document: { getElementById: element, createElement: () => ({}) },
    window: { close() {} }, URL, setTimeout: callback => setTimeout(callback, 0), clearTimeout
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(sent, ['lexlens:status', 'lexlens:rescan', 'lexlens:status']);
  assert.match(element('status').textContent, /上方释义 2 处/);
});

test('floating button switch persists separately from annotation settings', async () => {
  const elements = new Map();
  const saved = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      checked: false, textContent: '', addEventListener(type, handler) { this[type] = handler; }, append() {}
    });
    return elements.get(id);
  };
  const chrome = {
    storage: { local: {
      get(_keys, callback) { callback({ floatingButtonEnabled: false }); },
      set(value, callback) { saved.push(value); callback(); }
    } },
    runtime: { lastError: null, getURL(path) { return `chrome-extension://test/${path}`; } },
    tabs: {
      query(_query, callback) { callback([{ id: 7, url: 'https://example.org/article' }]); },
      sendMessage(_id, _message, callback) { callback({ ok: true, ready: true, marked: 2, englishEnabled: true, englishEvidence: 'sourced' }); }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/popup.js'), 'utf8'), {
    chrome, LexLensCore: core, document: { getElementById: element, createElement: () => ({}) },
    window: { close() {} }, URL, setTimeout, clearTimeout
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(element('floating-button').checked, false);
  element('floating-button').checked = true;
  await element('floating-button').change({ target: element('floating-button') });
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ floatingButtonEnabled: true }]);
  assert.match(element('save-status').textContent, /已开启/);
});
