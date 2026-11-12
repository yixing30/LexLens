const test = require('node:test');
const assert = require('node:assert/strict');
const grammar = require('../src/grammar.js');

test('selected paragraph is split into sentences with original evidence', () => {
  const result = grammar.analyze('Although she had written the report, it was reviewed by a colleague. The AI becomes what its user can specify.');
  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'Although she had written the report, it was reviewed by a colleague.');
  assert.deepEqual(result[0].outline, [
    { role: '让步从句', text: 'Although she had written the report' },
    { role: '后续主句', text: 'it was reviewed by a colleague.' }
  ]);
  assert.deepEqual(result[0].findings.slice(0, 3).map(item => item.name),
    ['让步关系', '完成时线索', '被动或状态线索']);
  assert.equal(result[1].findings.some(item => item.evidence === 'what'), true);
  assert.equal(result[1].findings.some(item => item.evidence === 'can specify'), true);
  for (const sentence of result) {
    for (const finding of sentence.findings) assert.ok(sentence.text.includes(finding.evidence));
  }
});

test('plain text has no invented structure and single words have no grammar hint', () => {
  const result = grammar.analyze('The ceiling is high.');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].findings, []);
  assert.equal(result[0].outline, null);
  assert.deepEqual(grammar.analyze(''), []);
});

test('conditional, comparison and coordination cues are read without a remote model', () => {
  const result = grammar.analyze('If a model is more useful than before, the reader can understand it.');
  assert.equal(result.length, 1);
  assert.ok(result[0].findings.some(item => item.name === '条件关系'));
  assert.ok(result[0].findings.some(item => item.name === '比较结构'));
  assert.ok(result[0].findings.some(item => item.name === '情态动词'));
});

test('modal evidence includes the action after an intervening adverb', () => {
  const result = grammar.analyze('Although the model has improved, it can still miss details.');
  const modal = result[0].findings.find(item => item.name === '情态动词');
  assert.equal(modal.evidence, 'can still miss');
  assert.match(modal.explanation, /能力或可能/);
});
