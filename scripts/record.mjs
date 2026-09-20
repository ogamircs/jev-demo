// Records every act against both APIs and writes recordings/latest.json.
// Usage: node --env-file=.env scripts/record.mjs
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { closeAll } from '../lib/http.mjs';
import { catalog, availableLanes, modelConfig } from '../lib/catalog.mjs';
import { runExchange } from '../lib/run.mjs';
import { warmJev, callJev } from '../lib/jev.mjs';
import { warmOpenAI, resolveEffort } from '../lib/openai.mjs';
import { scrub, containsSecret } from '../lib/sanitize.mjs';
import { exchangeKey, validateRecording } from '../lib/recording.mjs';
import { inputs, limits, featured, questionsFor, questionSets, scenarioHash } from '../scenarios/triage.mjs';

const MAX_CALLS = Number(process.env.RECORD_MAX_CALLS ?? 600), RACE_SAMPLES = 5, FAN_SAMPLES = 5, FAN = [1, 3, 6, 12];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
let calls = 0, failures = 0; const exchanges = [], counters = new Map();

if (!process.env.JEV_API_KEY || !process.env.OPENAI_API_KEY) { console.error('Both JEV_API_KEY and OPENAI_API_KEY must be set.'); process.exit(1); }

// ---- warm-up, same steps as the live server ----
console.log('warming up');
const jevLane = { ...modelConfig.jev, tier: 'jev', available: true };
await warmJev(); await callJev({ state: inputs.t01.state, questions: questionsFor('triage3') });
const oaiModels = (await warmOpenAI()).json?.data?.map((m) => m.id) ?? [];
const llmLanes = [];
for (const lane of availableLanes(oaiModels)) {
  try { const effort = await resolveEffort({ model: lane.model, state: inputs.t01.state, questions: questionsFor('triage3') }); llmLanes.push({ ...lane, available: true, effort: effort ?? 'not sent' }); console.log(`  ${lane.model}: effort ${effort ?? 'not sent'}`); }
  catch (e) { console.log(`  ${lane.model}: unavailable (${e.message.slice(0, 80)})`); }
}
const headline = llmLanes.find((l) => l.tier === 'fast');
if (!headline) { console.error('No fast OpenAI lane is available.'); process.exit(1); }
const baseline = { jev: [], openai: [] };
for (let i = 0; i < 3; i++) { baseline.jev.push((await warmJev()).timing.totalMs); baseline.openai.push((await warmOpenAI()).timing.totalMs); }

async function sample(act, lane, req) {
  const full = { laneId: lane.id, ...req }, key = exchangeKey(full);
  const questions = req.limitId ? limits[req.limitId].questions : questionsFor(req.questionIds ?? req.questionSetId);
  const state = req.limitId ? limits[req.limitId].state : inputs[req.inputId].state;
  const cost = req.variant === 'one_call_per_question' ? Object.keys(questions).length : 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (calls + cost > MAX_CALLS) throw new Error(`call cap of ${MAX_CALLS} reached`);
    calls += cost;
    const ex = await runExchange({ lane, state, questions, withConfidence: !!req.withConfidence, variant: req.variant ?? 'single_call' });
    const sampleIndex = counters.get(key) ?? 0; counters.set(key, sampleIndex + 1);
    exchanges.push({ key, sampleIndex, act, inputId: req.inputId ?? null, limitId: req.limitId ?? null, ...ex });
    process.stdout.write(`\r  ${act}: ${calls} upstream calls, ${failures} failed   `);
    if (ex.ok) { await sleep(60); return ex; }
    failures++;                                   // failed samples stay in the file
    const wait = Number(ex.retryAfter) > 0 ? Math.min(Number(ex.retryAfter), 30) * 1000 : 1500 * (attempt + 1);
    if (ex.error?.kind === 'auth') throw new Error(ex.error.message);
    await sleep(wait);
  }
  return null;
}
async function act(name, jobs) {
  let failed = 0;
  for (const [lane, req] of jobs) { if (!(await sample(name, lane, req))) failed++; if (failed / jobs.length > 0.3) throw new Error(`${name}: more than 30% of samples failed, aborting`); }
  console.log();
}

// ---- A+B: race (interleaved) and anatomy ----
const raceLanes = [jevLane, ...llmLanes], raceJobs = [];
for (let s = 0; s < RACE_SAMPLES; s++) for (const inputId of featured.race) for (const lane of raceLanes) raceJobs.push([lane, { inputId, questionSetId: 'triage3' }]);
await act('race', raceJobs);
await act('anatomy', Object.keys(inputs).filter((id) => !featured.race.includes(id)).map((inputId) => [jevLane, { inputId, questionSetId: 'triage3' }]));

// ---- C: fan-out, three series interleaved ----
const fanJobs = [];
for (let s = 0; s < FAN_SAMPLES; s++) for (const n of FAN) {
  const questionIds = questionSets[`triage${n}`];
  fanJobs.push([jevLane, { inputId: featured.fanout, questionIds }], [headline, { inputId: featured.fanout, questionIds }], [headline, { inputId: featured.fanout, questionIds, variant: 'one_call_per_question' }]);
}
await act('fanout', fanJobs);

// ---- D: gating, E: limits ----
await act('gating', Object.keys(inputs).flatMap((inputId) => [[jevLane, { inputId, questionSetId: 'triage1' }], [headline, { inputId, questionSetId: 'triage1', withConfidence: true }]]));
await act('limits', Object.keys(limits).flatMap((limitId) => [[jevLane, { limitId }], [headline, { limitId }]]));

const recording = scrub({
  schemaVersion: 1, recordedAt: new Date().toISOString(), scenarioHash,
  environment: { runtime: `node ${process.version}`, client: 'node:https keep-alive', platform: `${os.type()} ${os.arch()}`, vantage: 'one laptop, one network', noncePolicy: 'none (the probe found no response caching)',
    networkBaseline: { jev: { host: 'api.typesafe.ai', warmGetMs: median(baseline.jev) }, openai: { host: 'api.openai.com', warmGetMs: median(baseline.openai) } } },
  lanes: [jevLane, ...llmLanes], catalog: catalog(),
  plan: { race: { inputs: featured.race, laneIds: raceLanes.map((l) => l.id), samples: RACE_SAMPLES }, fanout: { inputId: featured.fanout, ns: FAN, samples: FAN_SAMPLES, laneId: headline.id }, gating: { inputIds: Object.keys(inputs), laneId: headline.id }, limits: Object.keys(limits), upstreamCalls: calls, failures },
  exchanges,
});
if (containsSecret(recording)) { console.error('SECRET SCAN FAILED: refusing to write the recording.'); process.exit(2); }
const errs = validateRecording(recording);
if (errs.length) { console.error('Recording failed validation:\n  ' + errs.slice(0, 10).join('\n  ')); process.exit(3); }
writeFileSync(new URL('../recordings/latest.json', import.meta.url), JSON.stringify(recording));
console.log(`wrote recordings/latest.json: ${exchanges.length} exchanges, ${calls} upstream calls, ${failures} failed, secret scan clean`);
closeAll();
