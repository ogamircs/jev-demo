import { request, prewarm } from './http.mjs';
import { safeUpstreamError, scrub } from './sanitize.mjs';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODELS_URL = 'https://api.typesafe.ai/v1/models';

export async function callJev({ state, questions, model = 'jev-latest', apiKey = process.env.JEV_API_KEY, timeoutMs = 10_000, signal }) {
  const body = { state, model, questions };
  if (!apiKey) return { lane: 'jev', ok: false, status: 0, error: { lane: 'jev', status: 0, kind: 'auth', message: 'JEV_API_KEY is not set.' }, raw: { request: body, response: null } };
  try {
    const r = await request({ url: JEV_URL, headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs, signal });
    const ok = r.status === 200 && r.json?.answers;
    return {
      lane: 'jev', ok: !!ok, status: r.status, timing: { ...r.timing, serverMs: num(r.headers['x-envoy-upstream-service-time']) },
      requestedModel: model, resolvedModel: r.json?.model ?? null,
      usage: r.json?.usage ?? null,
      error: ok ? null : safeUpstreamError('jev', r.status, r.json, r.text),
      raw: { request: body, response: ok ? r.json : scrub(r.json ?? r.text?.slice(0, 600)) },
      retryAfter: r.headers['retry-after'] ?? null,
    };
  } catch (e) {
    return { lane: 'jev', ok: false, status: 0, timing: e.timing ?? null, error: { lane: 'jev', status: 0, kind: e.kind ?? 'network', message: e.message }, raw: { request: body, response: null } };
  }
}

export function poolJev(n, apiKey = process.env.JEV_API_KEY) { return prewarm({ url: JEV_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` }, n }); }

export function warmJev(apiKey = process.env.JEV_API_KEY) {
  return request({ method: 'GET', url: JEV_MODELS_URL, headers: { Authorization: `Bearer ${apiKey}` }, timeoutMs: 10_000 });
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
