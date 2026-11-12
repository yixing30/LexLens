const test = require('node:test');
const assert = require('node:assert/strict');

require('../data/english-auto.js');
const core = require('../src/core');

test('local English data expands inline glosses beyond reviewed entries', () => {
  const items = core.candidates('The abbey stood on a hill.', { ...core.DEFAULT_SETTINGS, englishEvidence: 'estimated' });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'dictionary');
  assert.equal(items[0].gloss, '大修道院');
  assert.equal(items[0].level, 'C1');
  assert.equal(items[0].type, '名词');
  assert.equal(items[0].estimated, true);
  assert.match(items[0].source, /ECDICT/);
  core.setEnglishLookupData(require('../data/english-lookup.json'));
  assert.match(core.lookup('abbey')[0].detail, /大修道院/);
});

test('personal records and levels still govern frequency-based estimates', () => {
  const text = 'The abbey stood on a hill.';
  const estimated = { ...core.DEFAULT_SETTINGS, englishEvidence: 'estimated' };
  assert.deepEqual(core.candidates(text, { ...estimated, levels: { ...estimated.levels, en: 'C1' } }), []);
  assert.deepEqual(core.candidates(text, estimated, { 'en:abbey:frequency_single_gloss': 'known' }), []);
});

test('ambiguous dictionary entries stay in active lookup', () => {
  const data = require('../data/english-lookup.json');
  core.setEnglishLookupData(data);
  const result = core.lookup('algorithm');
  assert.equal(result.length, 1);
  assert.equal(result[0].recordable, false);
  assert.match(result[0].detail, /算法/);
  assert.deepEqual(core.candidates('The algorithm changed.', { ...core.DEFAULT_SETTINGS, englishEvidence: 'estimated' }).filter(x => x.lemma === 'algorithm'), []);
  const abstract = core.lookup('abstract');
  assert.equal(abstract[0].gloss, '摘要');
  assert(abstract.some(x => x.recordable === false && x.detail.includes('抽象')));
});

test('active lookup bundles English definition and phonetic data for common words', () => {
  const data = require('../data/english-detail.json');
  assert.match(data.methodology[0], /meθ/);
  assert.match(data.methodology[1], /principles and procedures/);
  assert.match(data.running[1], /^n\./);
});
