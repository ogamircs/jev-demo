// One "exchange": a single timed decision by one lane, in the shape shared by the
// live server and the recorder.
import { performance } from 'node:perf_hooks';
import { callJev } from './jev.mjs';
import { callOpenAIOnce, knownEffort, poolOpenAI } from './openai.mjs';
import { normalizeJev, normalizeOpenAI } from './normalize.mjs';
import { costUsd } from './pricing.mjs';

const TIMEOUTS = { jev: 10_000, fast: 60_000, frontier: 120_000 };

export async function runExchange({ lane, state, questions, withConfidence = false, variant = 'single_call', signal }) {
  if (lane.id === 'jev') {
    const r = await callJev({ state, questions, model: lane.model, timeoutMs: TIMEOUTS.jev, signal });
    return finish(lane, variant, r, r.ok ? normalizeJev(questions, r.raw.response.answers) : null, false);
  }
  const effort = knownEffort(lane.model);
  if (effort === undefined) {
    return { laneId: lane.id, lane: 'openai', model: lane.model, variant, ok: false, status: 0, timing: null, usage: null, costUsd: null, normalized: null,
      error: { lane: 'openai', status: 0, kind: 'not_ready', message: `${lane.model} has not been warmed up yet.` }, raw: null };
  }
  const timeoutMs = lane.tier === 'frontier' ? TIMEOUTS.frontier : TIMEOUTS.fast;

  if (variant === 'one_call_per_question') {
    // What a skeptic would try: fire one call per question, all at once.
    const ids = Object.keys(questions);
    await poolOpenAI(ids.length);   // untimed: every concurrent call gets a warm socket
    const t0 = performance.now();
    const parts = await Promise.all(ids.map((id) => callOpenAIOnce({ model: lane.model, effort, state, questions: { [id]: questions[id] }, withConfidence, timeoutMs, signal })));
    const wallMs = Math.round((performance.now() - t0) * 10) / 10;
    const ok = parts.every((p) => p.ok);
    const usage = parts.reduce((u, p) => ({
      input_tokens: u.input_tokens + (p.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (p.usage?.output_tokens ?? 0),
      cached_tokens: u.cached_tokens + (p.usage?.cached_tokens ?? 0), reasoning_tokens: u.reasoning_tokens + (p.usage?.reasoning_tokens ?? 0),
    }), { input_tokens: 0, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0 });
    const parsed = ok ? Object.assign({}, ...parts.map((p) => p.parsed)) : null;
    return {
      laneId: lane.id, lane: 'openai', model: lane.model, resolvedModel: parts[0]?.resolvedModel ?? null, effort: effort ?? 'not sent', variant, withConfidence,
      ok, status: ok ? 200 : parts.find((p) => !p.ok)?.status ?? 0,
      error: ok ? null : parts.find((p) => !p.ok)?.error ?? null,
      timing: { totalMs: wallMs, ttfbMs: null, connectMs: null, tlsMs: null, serverMs: null, reusedSocket: parts.every((p) => p.timing?.reusedSocket), calls: parts.map((p) => p.timing?.totalMs ?? null) },
      usage, costUsd: costUsd(lane.model, usage),
      normalized: ok ? normalizeOpenAI(questions, parsed, withConfidence) : null,
      raw: null,
    };
  }

  const r = await callOpenAIOnce({ model: lane.model, effort, state, questions, withConfidence, timeoutMs, signal });
  return finish(lane, variant, r, r.ok ? normalizeOpenAI(questions, r.parsed, withConfidence) : null, withConfidence);
}

function finish(lane, variant, r, normalized, withConfidence) {
  return {
    laneId: lane.id, lane: r.lane, model: lane.model, resolvedModel: r.resolvedModel ?? null,
    effort: r.lane === 'openai' ? r.effort : null, variant, withConfidence,
    ok: r.ok, status: r.status, error: r.error ?? null,
    timing: r.timing ?? null, usage: r.usage ?? null, costUsd: r.ok ? costUsd(lane.model, r.usage) : null,
    normalized, raw: r.raw ?? null, retryAfter: r.retryAfter ?? null,
  };
}
