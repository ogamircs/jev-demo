import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileForOpenAI, validateQuestions, signature } from '../lib/schema.mjs';
import { normalizeJev, normalizeOpenAI, agree, matchesLabel } from '../lib/normalize.mjs';
import { scrub, scrubString, safeUpstreamError, containsSecret } from '../lib/sanitize.mjs';
import { costUsd } from '../lib/pricing.mjs';
import { questionsFor, questionSets, inputs } from '../scenarios/triage.mjs';

const Q = {
  department: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Payments', technical: 'Bugs', sales: 'Pricing' } },
  frustration: { type: 'score', instructions: 'How frustrated?', criteria: ['Calm and neutral.', 'Concerned but civil.', 'Very angry or using strong language.'] },
  refund_requested: { type: 'noul', instructions: 'Refund?' },
};
const golden = JSON.parse(readFileSync(new URL('./fixtures/jev-canonical.json', import.meta.url), 'utf8'));

test('schema: labels-only output is flat, strict, and enum-only', () => {
  const { schema, questionsText } = compileForOpenAI(Q);
  assert.deepEqual(schema.required, ['department', 'frustration', 'refund_requested']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.department, { type: 'string', enum: ['billing', 'technical', 'sales'] });
  assert.deepEqual(schema.properties.frustration, { type: 'integer', enum: [0, 1, 2] });
  assert.deepEqual(schema.properties.refund_requested, { type: 'boolean' });
  assert.ok(!JSON.stringify(schema).includes('Payments'), 'criteria text must live in the prompt, not the schema');
  assert.ok(questionsText.includes('billing = Payments') && questionsText.includes('0 = Calm and neutral.'));
});

test('schema: confidence variant wraps each answer', () => {
  const { schema, system } = compileForOpenAI(Q, { withConfidence: true });
  assert.deepEqual(schema.properties.department.required, ['answer', 'confidence']);
  assert.match(system, /confidence/);
});

test('schema: validation enforces documented limits', () => {
  assert.deepEqual(validateQuestions(Q), []);
  assert.match(validateQuestions({ x: { type: 'score', instructions: 'r', criteria: ['one'] } })[0], /2 to 10/);
  assert.match(validateQuestions({ x: { type: 'essay', instructions: 'r' } })[0], /type must be/);
  assert.match(validateQuestions({ x: { type: 'choice', instructions: 'r', criteria: { a: null } } })[0], /at least 2/);
  assert.equal(signature(Q.department), 'choice<billing | technical | sales>');
  assert.equal(signature(Q.frustration), 'score<0..2>');
});

test('normalize: real Jev response (golden fixture from the probe)', () => {
  const n = normalizeJev(Q, golden.answers);
  assert.equal(n.department.label, golden.answers.department.choice);
  assert.equal(n.department.confidenceKind, 'distribution');
  assert.equal(n.frustration.level, 1, 'level is the most probable level, not the rounded mean');
  assert.equal(n.frustration.value, golden.answers.frustration.score);
  assert.equal(n.refund_requested.confidence, null, 'noul carries no confidence');
  assert.equal(n.refund_requested.label, 'yes');
});

test('normalize: OpenAI answers and agreement rules', () => {
  const j = normalizeJev(Q, golden.answers);
  const o = normalizeOpenAI(Q, { department: 'billing', frustration: 1, refund_requested: true });
  assert.equal(o.department.confidence, null);
  assert.equal(agree(j.department, o.department), true);
  assert.equal(agree(j.frustration, o.frustration), true);
  assert.equal(agree(j.refund_requested, o.refund_requested), true);
  const c = normalizeOpenAI(Q, { department: { answer: 'sales', confidence: 1.4 }, frustration: { answer: 2, confidence: 0.6 }, refund_requested: { answer: false, confidence: 0.9 } }, true);
  assert.equal(c.department.confidence, 1, 'self-reported confidence is clamped to 0..1');
  assert.equal(c.department.confidenceKind, 'self_reported');
  assert.equal(agree(j.department, c.department), false);
  assert.equal(matchesLabel(j.department, ['billing', 'technical']), true);
  assert.equal(matchesLabel(c.refund_requested, true), false);
});

test('sanitize: secrets never survive, including masked echoes', () => {
  const secrets = ['sk-proj-FAKEfake1234567890abcdWXYZ', 'jevkey_FAKE_0123456789_tail'];
  const dirty = { authorization: 'Bearer sk-proj-FAKEfake1234567890abcdWXYZ', nested: [{ msg: 'Incorrect API key provided: sk-proj-********WXYZ. See docs.' }], note: 'key jevkey_FAKE_0123456789_tail leaked' };
  const clean = scrub(dirty, secrets);
  assert.equal('authorization' in clean, false);
  assert.equal(containsSecret(clean, secrets), false);
  assert.ok(!JSON.stringify(clean).includes('WXYZ'));
  assert.ok(!scrubString('Bearer abcdefgh12345678', []).includes('abcdefgh'));
});

test('sanitize: upstream errors become safe, useful messages', () => {
  assert.match(safeUpstreamError('openai', 401, { error: { message: 'Incorrect API key provided: sk-abc***xyz' } }, '', []).message, /OPENAI_API_KEY/);
  assert.ok(!safeUpstreamError('openai', 401, { error: { message: 'sk-abc***xyz' } }, '', []).message.includes('sk-'));
  const e422 = safeUpstreamError('jev', 422, { detail: [{ type: 'missing', loc: ['body', 'questions', 'x', 'choice', 'criteria'], msg: 'Field required' }] }, '', []);
  assert.equal(e422.kind, 'bad_request');
  assert.match(e422.message, /questions\.x\.choice\.criteria: Field required/);
  assert.equal(safeUpstreamError('jev', 400, { detail: { error_type: 'api_usage_error', message: 'Unknown model: jev-nope' } }, '', []).message, 'Unknown model: jev-nope');
  assert.equal(safeUpstreamError('jev', 529, null, 'busy', []).kind, 'overloaded');
});

test('pricing: cost from measured usage and list prices', () => {
  assert.ok(Math.abs(costUsd('jev-latest', { input_tokens: 432, output_tokens: 71 }) - 432 * 0.042 / 1e6) < 1e-12, 'Jev output is free');
  const c = costUsd('gpt-5.4-nano', { input_tokens: 1000, cached_tokens: 400, output_tokens: 100 });
  assert.ok(Math.abs(c - (600 * 0.20 + 400 * 0.02 + 100 * 1.25) / 1e6) < 1e-12);
  assert.equal(costUsd('unknown-model', { input_tokens: 1 }), null);
});

test('scenarios: nested question sets and labelled inputs', () => {
  assert.deepEqual(Object.keys(questionsFor('triage3')), questionSets.triage3);
  assert.ok(questionSets.triage12.slice(0, 6).every((id, i) => id === questionSets.triage6[i]), 'sets are nested');
  assert.deepEqual(validateQuestions(questionsFor('triage12')), []);
  for (const [id, inp] of Object.entries(inputs)) assert.ok(inp.labels?.department, `${id} has an author label`);
});
