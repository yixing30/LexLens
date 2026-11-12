const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core');

function settings(overrides = {}) {
  return core.normalizeSettings({
    enabled: { en: true, ja: true, ko: true },
    levels: { en: 'B1', ja: 'N3', ko: '3' },
    density: 'standard',
    englishEvidence: 'estimated',
    ...overrides
  });
}
function keys(items) { return items.map(x => `${x.start}:${x.lang}:${x.lemma}:${x.senseId}`); }

test('Japanese and Korean stay inactive even when old saved settings enabled them', () => {
  const text = 'The river bank is meticulous. 複雑な問題。불가피한 결정.';
  const all = core.candidates(text, settings());
  assert.deepEqual(all.map(x => x.lang), ['en', 'en']);
  assert.deepEqual(all.map(x => x.level), ['B2', 'C2']);
  assert.equal(settings().enabled.ja, false);
  assert.equal(settings().enabled.ko, false);
  const onlyEnglish = settings({ enabled: { en: true, ja: false, ko: false } });
  assert.deepEqual(core.candidates(text, onlyEnglish).map(x => x.lang), ['en', 'en']);
  const highest = settings({ levels: { en: 'C2', ja: 'N1', ko: '6' } });
  assert.deepEqual(core.candidates(text, highest), []);
});

test('repeated occurrences each receive their own gloss', () => {
  const items = core.candidates('Meticulous work is meticulous work.', settings());
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(x => x.gloss), ['一丝不苟的', '一丝不苟的']);
  assert.notEqual(items[0].start, items[1].start);
});

test('different senses of the same spelling remain separate', () => {
  const river = core.candidates('The river bank flooded.', settings());
  assert.equal(river[0].senseId, 'river_edge');
  assert.equal(river[0].gloss, '河岸');
  assert.deepEqual(core.candidates('I deposited money at the bank.', settings()), []);
  assert.deepEqual(core.candidates('The bank is nearby.', settings()), []);
  assert.deepEqual(core.candidates('The river bank holds my bank account.', settings()), []);
});

test('personal records affect only the selected sense', () => {
  const known = { 'en:bank:river_edge': 'known' };
  assert.deepEqual(core.candidates('The river bank flooded.', settings(), known), []);
  const unknown = { 'en:bank:finance': 'unknown' };
  const bank = core.candidates('I deposited money at the bank.', settings(), unknown);
  assert.equal(bank.length, 1);
  assert.equal(bank[0].senseId, 'finance');
  assert.equal(core.candidates('The river bank flooded.', settings(), unknown).length, 1);
});

test('density sets are nested and do not change ambiguous meaning handling', () => {
  const text = 'The river bank was subtle; nevertheless, ubiquitous.';
  const light = keys(core.candidates(text, settings({ density: 'light' })));
  const standard = keys(core.candidates(text, settings({ density: 'standard' })));
  const all = keys(core.candidates(text, settings({ density: 'all' })));
  assert(light.every(x => standard.includes(x)));
  assert(standard.every(x => all.includes(x)));
  assert.deepEqual(core.candidates('The bank is nearby.', settings({ density: 'all' })), []);
});

test('inflected forms resolve to the same original and overlapping forms are not duplicated', () => {
  const items = core.candidates('We ran out of time. 複雑な問題。해결했다.', settings());
  assert.deepEqual(items.map(x => x.lemma), ['run out of']);
  assert.equal(items[0].text, 'ran out of');
});

test('every automated label identifies its estimate status and local source', () => {
  const items = core.candidates('Meticulous. 顕著。현저한.', settings());
  assert.equal(items.length, 1);
  for (const item of items) {
    assert.equal(item.estimated, true);
    assert.match(item.source, /自编示例词表/);
  }
});

test('invalid stored settings are normalized', () => {
  assert.deepEqual(core.normalizeSettings({ levels: { en: 'N1' }, density: 'everything' }), core.normalizeSettings());
});

test('active lookup exposes known senses without claiming an ambiguous automatic gloss', () => {
  const bank = core.lookup(' BANK ');
  assert.deepEqual(bank.map(x => x.senseId), ['river_edge', 'finance']);
  assert(bank.every(x => x.estimated && x.source.includes('自编示例词表')));
  assert.equal(core.lookup('ran   out of')[0].lemma, 'run out of');
  assert.deepEqual(core.lookup('unlisted expression'), []);
});

test('A2 readers see reviewed academic terms while context guards reject literal meanings', () => {
  const text = 'AI raises the floor. The user sets the ceiling for the model. A skilled operator specifies a prompt for the model. A vendor measures productivity in a randomized trial.';
  const a2 = core.candidates(text, settings({ levels: { en: 'A2' } }));
  assert.deepEqual(a2.map(x => x.lemma), ['floor', 'ceiling', 'skilled', 'specify', 'prompt', 'vendor', 'productivity', 'randomized']);
  const b1 = core.candidates(text, settings());
  assert.deepEqual(b1.map(x => x.lemma), ['floor', 'ceiling', 'skilled', 'specify', 'prompt', 'randomized']);
  assert.deepEqual(core.candidates('The ceiling was painted white and the floor was tiled.', settings({ levels: { en: 'A2' } })), []);
  assert.deepEqual(core.candidates('The abstract sculpture stood in a gallery.', settings({ levels: { en: 'A2' } })), []);
});
