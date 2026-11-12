const test = require('node:test');
const assert = require('node:assert/strict');

require('../data/english-levels.js');
require('../data/english-inline.js');
require('../data/english-auto.js');
const core = require('../src/core.js');

test('conflicting profile grades are withheld instead of guessed', () => {
  assert.equal(globalThis.LexLensEnglishLevels.rich, undefined);
  assert.deepEqual(globalThis.LexLensEnglishLevels.ceiling, [['n', 'B2', 'CEFR-J v1.6']]);
});

test('all six English choices filter sourced grades in order', () => {
  const text = 'She gave a precise answer. A realistic plan helped. A prompt for the AI was ready. A timid visitor met a meticulous editor.';
  const expected = {
    A1: ['precise', 'realistic', 'prompt', 'timid', 'meticulous'],
    A2: ['realistic', 'prompt', 'timid', 'meticulous'],
    B1: ['prompt', 'timid', 'meticulous'],
    B2: ['timid', 'meticulous'],
    C1: ['meticulous'],
    C2: []
  };
  for (const [level, lemmas] of Object.entries(expected)) {
    const settings = core.normalizeSettings({ levels: { en: level } });
    const items = core.candidates(text, settings);
    assert.deepEqual(items.filter(item => lemmas.includes(item.lemma)).map(item => item.lemma), lemmas, level);
    assert(items.every(item => item.gloss && item.kind !== 'lookup'), level);
    assert(items.every(item => /CEFR-J|Octanove/.test(item.levelSource)));
    assert(items.every(item => core.LEVELS.en.indexOf(item.level) > core.LEVELS.en.indexOf(level)));
  }
});

test('strict mode withholds unsupported grades and falls back to a dictionary meaning', () => {
  const strict = core.normalizeSettings({ levels: { en: 'A2' } });
  const estimated = core.normalizeSettings({ levels: { en: 'A2' }, englishEvidence: 'estimated' });
  assert.deepEqual(core.candidates('The abbey stood nearby.', strict).filter(item => item.lemma === 'abbey'), []);
  assert.equal(core.candidates('The abbey stood nearby.', estimated)[0].lemma, 'abbey');
  assert.deepEqual(core.candidates('AI raises the floor.', strict), []);
  assert.equal(core.candidates('AI raises the floor.', estimated)[0].gloss, '能力下限');
  assert(core.candidates('The ceiling needed paint.', strict).every(item => item.gloss && item.kind === 'dictionary'));
  assert(core.candidates('The AI model scans the ceiling.', strict).every(item => item.gloss && item.kind === 'dictionary'));
  assert(!core.candidates('The AI robot cleans the floor.', estimated).some(item => item.lemma === 'floor'));
  assert(core.candidates('The model sent a prompt response.', strict).every(item => item.gloss && item.kind === 'dictionary'));
});

test('sourced words receive inline dictionary glosses at every eligible level', () => {
  const text = 'A visitor studied methodology and correlation. More people can read.';
  const a2 = core.candidates(text, core.normalizeSettings({ levels: { en: 'A2' } }));
  assert(a2.some(item => item.lemma === 'methodology' && item.gloss.includes('方法学')));
  assert(a2.some(item => item.lemma === 'correlation' && item.gloss === '相关性'));
  assert(!a2.some(item => ['more', 'can'].includes(item.lemma)));
  for (const level of core.LEVELS.en) {
    const items = core.candidates(text, core.normalizeSettings({ levels: { en: level } }));
    assert(items.every(item => core.LEVELS.en.indexOf(item.level) > core.LEVELS.en.indexOf(level) && item.gloss), level);
  }
  const known = { 'en:methodology:profile_lookup': 'known' };
  assert(!core.candidates(text, core.normalizeSettings({ levels: { en: 'A2' } }), known).some(item => item.lemma === 'methodology'));
  const inflected = core.candidates('Know the limits of the tool.', core.normalizeSettings({ levels: { en: 'A2' } }));
  assert(inflected.some(item => item.text === 'limits' && item.lemma === 'limit' && item.gloss), 'inflected word has an inline gloss');
});

test('dictionary gloss follows the sourced part of speech and inflected verbs', () => {
  const settings = core.normalizeSettings({ levels: { en: 'A2' } });
  const text = 'The superior model measured its output. The criteria were fixed.';
  const items = core.candidates(text, settings);
  assert(items.some(item => item.lemma === 'superior' && item.gloss.startsWith('上级的')));
  assert(items.some(item => item.text === 'measured' && item.gloss.startsWith('测量')));
  assert(items.some(item => item.lemma === 'criteria' && item.gloss === '标准'));
  assert(items.every(item => item.gloss && item.kind !== 'lookup'));
});

test('mixed parts of speech use their lowest sourced level when every reading exceeds A2', () => {
  const settings = core.normalizeSettings({ levels: { en: 'A2' } });
  const items = core.candidates('A standard model helped.', settings);
  const standard = items.find(item => item.lemma === 'standard');
  assert.equal(standard.level, 'B1');
  assert.match(standard.levelSource, /最低等级/);
  assert.equal(standard.gloss, '标准／规格');
  assert(!items.some(item => item.lemma === 'model'), 'model has an A2 noun reading');
});

test('current-level words are optional and personal unknown words override the threshold', () => {
  const base = core.normalizeSettings({ levels: { en: 'A2' } });
  assert(!core.candidates('Ability matters.', base).some(item => item.lemma === 'ability'));
  const current = core.normalizeSettings({ levels: { en: 'A2' }, includeCurrentLevel: true });
  assert(core.candidates('Ability matters.', current).some(item => item.lemma === 'ability'));
  assert(!core.candidates('That matters.', core.normalizeSettings({ levels: { en: 'A1' }, includeCurrentLevel: true })).some(item => item.lemma === 'that'), 'mixed lower and higher readings need context');
  const records = { 'en:algorithm:manual_unknown': { state: 'unknown', gloss: '算法', level: 'B2' } };
  assert(core.candidates('An algorithm matters.', base, records).some(item => item.lemma === 'algorithm' && item.gloss === '算法'));
  records['en:algorithm:manual_unknown'] = 'known';
  assert(!core.candidates('An algorithm matters.', base, records).some(item => item.lemma === 'algorithm'));
});
