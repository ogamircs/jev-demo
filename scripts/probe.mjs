// Stage 2 probe: confirm real API shapes and behaviour before building on them.
// Prints a PASS/FAIL table. Never prints key values. Writes recordings/probe.json (gitignored).
import { writeFileSync } from 'node:fs';
import { closeAll, request } from '../lib/http.mjs';
import { callJev, warmJev, JEV_URL } from '../lib/jev.mjs';
import { callOpenAIOnce, resolveEffort, warmOpenAI, OPENAI_URL } from '../lib/openai.mjs';
import { containsSecret, scrub } from '../lib/sanitize.mjs';

const CANDIDATES = (process.env.PROBE_MODELS ?? 'gpt-5.6-luna,gpt-5.4-nano,gpt-4.1-nano,gpt-6-astra').split(',');
const report = { at: new Date().toISOString(), checks: [], jev: {}, openai: {} };
const check = (name, pass, detail = '') => { report.checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = "Help! My payouts have been failing for 3 days. I was also charged twice this month and I want that second charge returned.";
const Q = {
  department: { type: 'choice', instructions: 'Which team should handle this ticket?', criteria: { billing: 'Payments, invoicing, refunds', technical: 'Bugs, outages, integrations', sales: 'Pricing, upgrades, new accounts' } },
  frustration: { type: 'score', instructions: 'How frustrated does the customer appear?', criteria: ['Calm and neutral.', 'Concerned but civil.', 'Very angry or using strong language.'] },
  refund_requested: { type: 'noul', instructions: 'Does the customer request a refund?' },
};
const filler = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, { type: 'noul', instructions: ['Is the customer asking about pricing?', 'Does the message mention a deadline?', 'Is the customer threatening to cancel?', 'Does the message mention a bug?', 'Is the message written in English?', 'Does the customer mention a competitor?', 'Is a phone call requested?', 'Does the message include an order number?', 'Is the customer a business account?', 'Does the customer mention data loss?', 'Is the tone sarcastic?', 'Does the message mention a mobile app?'][i % 12] }]));

console.log('\n== Jev ==');
const cold = await callJev({ state, questions: Q });
report.jev.cold = { timing: cold.timing, status: cold.status };
check('jev: canonical 3-question call returns 200', cold.ok, `HTTP ${cold.status}, cold ${cold.timing?.totalMs} ms (tls ${cold.timing?.tlsMs} ms)`);
if (cold.ok) {
  const a = cold.raw.response.answers;
  report.jev.sample = cold.raw.response;
  console.log(JSON.stringify(cold.raw.response, null, 1));
  check('jev: choice has choice/probabilities/confidence', 'choice' in a.department && 'probabilities' in a.department && 'confidence' in a.department);
  const sum = Object.values(a.department.probabilities).reduce((s, v) => s + v, 0);
  check('jev: choice probabilities sum to ~1', Math.abs(sum - 1) < 0.02, `sum=${sum.toFixed(4)}`);
  check('jev: score has score/legend/probabilities/confidence', ['score', 'legend', 'probabilities', 'confidence'].every((k) => k in a.frustration));
  const keys = Object.keys(a.frustration.probabilities ?? {});
  check('jev: score levels are 0-based string keys', keys.join(',') === '0,1,2', `keys=${keys.join(',')} legendKeys=${Object.keys(a.frustration.legend ?? {}).join(',')}`);
  check('jev: noul has noul and no confidence', typeof a.refund_requested.noul === 'number' && !('confidence' in a.refund_requested), `fields=${Object.keys(a.refund_requested).join(',')}`);
  check('jev: usage has input_tokens/output_tokens', typeof cold.usage?.input_tokens === 'number', JSON.stringify(cold.usage));
  report.jev.resolvedModel = cold.resolvedModel;
}

// header names worth knowing (values for non-sensitive ones only)
{
  const r = await request({ url: JEV_URL, headers: { Authorization: `Bearer ${process.env.JEV_API_KEY}` }, body: { state, model: 'jev-latest', questions: Q } });
  const names = Object.keys(r.headers);
  report.jev.headerNames = names;
  const interesting = names.filter((n) => /ratelimit|request-id|cache|age|server-timing|x-/i.test(n));
  console.log('jev response headers:', names.join(', '));
  for (const n of interesting) console.log(`   ${n}: ${String(r.headers[n]).slice(0, 80)}`);
}

// caching / determinism: 5 identical calls vs 5 with a unique id inside state
{
  const same = [], uniq = [];
  for (let i = 0; i < 5; i++) {
    same.push(await callJev({ state, questions: Q }));
    uniq.push(await callJev({ state: { uid: `${Date.now()}-${i}`, ticket: state }, questions: Q }));
  }
  const t = (rs) => rs.filter((r) => r.ok).map((r) => r.timing.totalMs);
  const probs = (rs) => rs.filter((r) => r.ok).map((r) => r.raw.response.answers.department.probabilities.billing);
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  report.jev.repeat = { identicalMs: t(same), uniqueMs: t(uniq), identicalP: probs(same), uniqueP: probs(uniq), reused: same.map((r) => r.timing?.reusedSocket) };
  console.log(`identical calls ms: ${t(same).join(', ')}  (median ${median(t(same))})`);
  console.log(`unique-id calls ms: ${t(uniq).join(', ')}  (median ${median(t(uniq))})`);
  console.log(`P(billing) identical: ${probs(same).map((p) => p.toFixed(4)).join(', ')}  spread ${spread(probs(same)).toFixed(4)}`);
  console.log(`P(billing) unique-id: ${probs(uniq).map((p) => p.toFixed(4)).join(', ')}  spread ${spread(probs(uniq)).toFixed(4)}`);
  check('jev: warm calls reuse the socket', same.slice(1).every((r) => r.timing?.reusedSocket));
  const cached = median(t(same)) < 0.5 * median(t(uniq));
  report.jev.cacheSuspected = cached;
  check('jev: identical requests are not served dramatically faster (no obvious response cache)', !cached, `median identical ${median(t(same))} ms vs unique ${median(t(uniq))} ms`);
  report.jev.deterministic = spread(probs(same)) === 0;
  console.log(`deterministic on identical input: ${report.jev.deterministic}`);
}

// token usage and latency as questions grow
{
  report.jev.fanout = [];
  for (const n of [1, 3, 6, 12]) {
    const ms = [], toks = [];
    for (let i = 0; i < 3; i++) { const r = await callJev({ state, questions: filler(n) }); if (r.ok) { ms.push(r.timing.totalMs); toks.push(r.usage.input_tokens); } }
    report.jev.fanout.push({ n, ms, inputTokens: toks[0] });
    console.log(`n=${String(n).padStart(2)} questions: input_tokens=${toks[0]}  ms=${ms.join(', ')}`);
  }
}

// error shapes
{
  const bad = await callJev({ state, questions: { x: { type: 'score', instructions: 'Rate it', criteria: ['only one level'] } } });
  report.jev.err422 = { status: bad.status, error: bad.error, body: bad.raw.response };
  check('jev: invalid score question is rejected with 4xx', bad.status >= 400 && bad.status < 500, `HTTP ${bad.status}: ${bad.error?.message?.slice(0, 160)}`);
  const unauth = await callJev({ state, questions: Q, apiKey: 'jev_bogus_key_for_probe_0000' });
  report.jev.err401 = { status: unauth.status, error: unauth.error };
  check('jev: bogus key gives 401/403 and a safe message', [401, 403].includes(unauth.status), `HTTP ${unauth.status}: ${unauth.error?.message}`);
}

console.log('\n== OpenAI ==');
await warmOpenAI();
for (const model of CANDIDATES) {
  console.log(`\n-- ${model}`);
  const entry = (report.openai[model] = {});
  try {
    const effort = await resolveEffort({ model, state, questions: Q, log: console.log });
    entry.effort = effort ?? 'not sent';
    const runs = [];
    for (let i = 0; i < 4; i++) { runs.push(await callOpenAIOnce({ model, effort, state, questions: Q })); await sleep(150); }
    const ok = runs.filter((r) => r.ok);
    entry.ms = ok.map((r) => r.timing.totalMs);
    entry.usage = ok[0]?.usage; entry.resolvedModel = ok[0]?.resolvedModel; entry.serviceTier = ok[0]?.serviceTier;
    entry.answers = ok.map((r) => r.parsed);
    console.log(`  effort used: ${entry.effort}; resolved model: ${entry.resolvedModel}; tier: ${entry.serviceTier}`);
    console.log(`  ms: ${entry.ms.join(', ')}  (median ${median(entry.ms)})   usage: ${JSON.stringify(entry.usage)}`);
    console.log(`  answers: ${ok.map((r) => JSON.stringify(r.parsed)).join('  ')}`);
    check(`openai ${model}: strict structured output parses`, ok.length === runs.length, `${ok.length}/${runs.length} ok`);
    const wc = await callOpenAIOnce({ model, effort, state, questions: Q, withConfidence: true });
    entry.withConfidence = { ok: wc.ok, ms: wc.timing?.totalMs, usage: wc.usage, parsed: wc.parsed };
    console.log(`  with self-reported confidence: ${wc.ok ? JSON.stringify(wc.parsed) : wc.error?.message}  (${wc.timing?.totalMs} ms, out ${wc.usage?.output_tokens} tok)`);
  } catch (e) {
    entry.error = e.message;
    check(`openai ${model}: usable`, false, e.message.slice(0, 200));
  }
}

// schema first-use penalty on the first candidate that worked: a brand-new schema, call twice
{
  const model = CANDIDATES.find((m) => report.openai[m]?.ms?.length);
  if (model) {
    const fresh = { [`novel_${Date.now()}`]: { type: 'noul', instructions: 'Does the message mention payouts?' }, ...filler(3) };
    const effort = report.openai[model].effort === 'not sent' ? null : report.openai[model].effort;
    const a = await callOpenAIOnce({ model, effort, state, questions: fresh });
    const b = await callOpenAIOnce({ model, effort, state, questions: fresh });
    report.openai.schemaPenalty = { model, firstMs: a.timing?.totalMs, secondMs: b.timing?.totalMs };
    console.log(`\nnew-schema first call ${a.timing?.totalMs} ms vs second ${b.timing?.totalMs} ms (${model})`);
  }
  const unauth = await request({ url: OPENAI_URL, headers: { Authorization: 'Bearer sk-bogus-probe-key-0000000000000000' }, body: { model: CANDIDATES[0], input: 'hi' } }).catch((e) => ({ status: 0, text: e.message }));
  console.log(`openai bogus key: HTTP ${unauth.status}; raw body echoes a key fragment: ${/sk-/.test(unauth.text ?? '')}`);
  report.openai.err401EchoesKey = /sk-/.test(unauth.text ?? '');
}

const safe = scrub(report);
check('report contains no secret values', !containsSecret(safe));
writeFileSync(new URL('../recordings/probe.json', import.meta.url), JSON.stringify(safe, null, 2));
console.log('\nwrote recordings/probe.json');
const failed = report.checks.filter((c) => !c.pass);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
closeAll();
