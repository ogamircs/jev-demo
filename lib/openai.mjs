import { request, prewarm } from './http.mjs';
import { safeUpstreamError, scrub } from './sanitize.mjs';
import { compileForOpenAI, stateToText } from './schema.mjs';

export const OPENAI_URL = 'https://api.openai.com/v1/responses';
export const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

// Lowest reasoning effort first. `null` means "send no reasoning parameter".
export const EFFORT_LADDER = ['none', 'minimal', 'low', null];
const resolvedEffort = new Map(); // model -> effort that the API accepted

export function knownEffort(model) { return resolvedEffort.has(model) ? resolvedEffort.get(model) : undefined; }
export function setEffort(model, effort) { resolvedEffort.set(model, effort); }

export function buildBody({ state, questions, model, effort, withConfidence = false, maxOutputTokens = 4000 }) {
  const { schema, system, questionsText } = compileForOpenAI(questions, { withConfidence });
  const body = {
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: `STATE:\n${stateToText(state)}\n\nQUESTIONS:\n${questionsText}` },
    ],
    text: { format: { type: 'json_schema', name: 'decisions', strict: true, schema } },
    store: false,
    max_output_tokens: maxOutputTokens,
  };
  if (effort) body.reasoning = { effort };
  return body;
}

function extractText(json) {
  const out = { text: null, refusal: null };
  for (const item of json?.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text') out.text = (out.text ?? '') + c.text;
      if (c.type === 'refusal') out.refusal = c.refusal;
    }
  }
  return out;
}

/** One timed call at a fixed effort. No ladder walking, no retries. */
export async function callOpenAIOnce({ state, questions, model, effort, withConfidence = false, apiKey = process.env.OPENAI_API_KEY, timeoutMs = 60_000, signal }) {
  const body = buildBody({ state, questions, model, effort, withConfidence });
  const base = { lane: 'openai', requestedModel: model, effort: effort ?? 'not sent', withConfidence };
  if (!apiKey) return { ...base, ok: false, status: 0, error: { lane: 'openai', status: 0, kind: 'auth', message: 'OPENAI_API_KEY is not set.' }, raw: { request: body, response: null } };
  try {
    const r = await request({ url: OPENAI_URL, headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs, signal });
    let parsed = null, error = null;
    if (r.status === 200) {
      const { text, refusal } = extractText(r.json);
      if (refusal) error = { lane: 'openai', status: 200, kind: 'refusal', message: String(refusal).slice(0, 300) };
      else if (r.json?.status === 'incomplete') error = { lane: 'openai', status: 200, kind: 'incomplete', message: `Response incomplete: ${r.json?.incomplete_details?.reason ?? 'unknown reason'}` };
      else { try { parsed = JSON.parse(text); } catch { error = { lane: 'openai', status: 200, kind: 'bad_json', message: 'The model returned text that is not valid JSON.' }; } }
    } else error = safeUpstreamError('openai', r.status, r.json, r.text);
    const u = r.json?.usage;
    return {
      ...base, ok: !!parsed, status: r.status, timing: { ...r.timing, serverMs: num(r.headers['openai-processing-ms']) }, parsed,
      resolvedModel: r.json?.model ?? null,
      usage: u ? {
        input_tokens: u.input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
        cached_tokens: u.input_tokens_details?.cached_tokens ?? 0,
        reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      } : null,
      serviceTier: r.json?.service_tier ?? null,
      error,
      raw: { request: body, response: scrub(r.json ?? r.text?.slice(0, 600)) },
      retryAfter: r.headers['retry-after'] ?? null,
    };
  } catch (e) {
    return { ...base, ok: false, status: 0, timing: e.timing ?? null, error: { lane: 'openai', status: 0, kind: e.kind ?? 'network', message: e.message }, raw: { request: body, response: null } };
  }
}

/** Find the lowest reasoning effort this model accepts. Untimed; run during warm-up. */
export async function resolveEffort({ model, state, questions, apiKey, log = () => {} }) {
  if (resolvedEffort.has(model)) return resolvedEffort.get(model);
  for (const effort of EFFORT_LADDER) {
    const r = await callOpenAIOnce({ model, effort, state, questions, apiKey });
    log(`  effort=${effort ?? '(not sent)'} -> HTTP ${r.status}${r.ok ? ' ok' : ' ' + (r.error?.message ?? '').slice(0, 140)}`);
    if (r.ok) { resolvedEffort.set(model, effort); return effort; }
    if (r.status !== 400) throw Object.assign(new Error(r.error?.message ?? 'OpenAI call failed'), { result: r });
  }
  throw new Error(`No reasoning effort setting was accepted for ${model}`);
}

export function poolOpenAI(n, apiKey = process.env.OPENAI_API_KEY) { return prewarm({ url: OPENAI_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` }, n }); }

export function warmOpenAI(apiKey = process.env.OPENAI_API_KEY) {
  return request({ method: 'GET', url: OPENAI_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 15_000 });
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
