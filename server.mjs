// Local live demo server. Keys stay here; the browser never sees them.
// Run: node --env-file=.env server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { catalog, availableLanes, modelConfig } from './lib/catalog.mjs';
import { runExchange } from './lib/run.mjs';
import { warmJev, callJev, poolJev } from './lib/jev.mjs';
import { warmOpenAI, resolveEffort, knownEffort, poolOpenAI } from './lib/openai.mjs';
import { validateQuestions } from './lib/schema.mjs';
import { scrub, containsSecret } from './lib/sanitize.mjs';
import { questionsFor, inputs, limits } from './scenarios/triage.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const MAX_BODY = 64 * 1024, MAX_STATE_CHARS = 40_000, CALLS_PER_MIN = 300;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const state = { lanes: [], ready: false, warnings: [], baseline: {} };
const callLog = [];

async function warmUp() {
  const warmQ = questionsFor('triage3'), warmState = inputs.t01.state;
  if (process.env.JEV_API_KEY) {
    try {
      const m = await warmJev(); if (m.status !== 200) throw new Error(`HTTP ${m.status}`);
      await callJev({ state: warmState, questions: warmQ });
      const w = await warmJev(); state.baseline.jev = { host: 'api.typesafe.ai', warmGetMs: w.timing.totalMs };
      state.lanes.push({ ...modelConfig.jev, tier: 'jev', available: true });
    } catch (e) { state.warnings.push(`Jev lane unavailable: ${e.message}`); state.lanes.push({ ...modelConfig.jev, tier: 'jev', available: false, reason: 'Check JEV_API_KEY.' }); }
  } else state.lanes.push({ ...modelConfig.jev, tier: 'jev', available: false, reason: 'JEV_API_KEY is not set.' });

  if (process.env.OPENAI_API_KEY) {
    try {
      const m = await warmOpenAI(); if (m.status !== 200) throw new Error(`HTTP ${m.status}`);
      const ids = (m.json?.data ?? []).map((x) => x.id);
      for (const lane of availableLanes(ids)) {
        try {
          const effort = await resolveEffort({ model: lane.model, state: warmState, questions: warmQ });
          state.lanes.push({ ...lane, available: true, effort: effort ?? 'not sent' });
        } catch (e) { state.warnings.push(`${lane.model} unavailable: ${e.message.slice(0, 160)}`); }
      }
      const w = await warmOpenAI(); state.baseline.openai = { host: 'api.openai.com', warmGetMs: w.timing.totalMs };
    } catch (e) { state.warnings.push(`OpenAI lanes unavailable: ${e.message}`); }
  } else state.warnings.push('OPENAI_API_KEY is not set, so the OpenAI lanes are off.');
  state.ready = true;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(data);
}

// Binding to localhost is not enough: any web page open in this browser could POST here
// and spend the keys. So we check Host and Origin, require JSON, and send no CORS headers.
function guard(req) {
  if (!HOSTS.has(req.headers.host ?? '')) return 'Unexpected Host header.';
  const origin = req.headers.origin;
  if (origin && !HOSTS.has(origin.replace(/^https?:\/\//, ''))) return 'Cross-origin requests are not allowed.';
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return 'Cross-site requests are not allowed.';
  if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) return 'POST bodies must be application/json.';
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large.'), { status: 413 })); req.pause(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Body is not valid JSON.')); } });
    req.on('error', reject);
  });
}

function spend(n) {
  const now = Date.now();
  while (callLog.length && now - callLog[0] > 60_000) callLog.shift();
  if (callLog.length + n > CALLS_PER_MIN) return false;
  for (let i = 0; i < n; i++) callLog.push(now);
  return true;
}

async function handleRun(req, res) {
  const b = await readBody(req);
  const lane = state.lanes.find((l) => l.id === b.laneId && l.available);
  if (!lane) return send(res, 400, { error: { kind: 'bad_request', message: `Lane "${b.laneId}" is not available.` } });

  let st, questions;
  if (b.limitId) {
    const l = limits[b.limitId]; if (!l) return send(res, 400, { error: { kind: 'bad_request', message: 'Unknown limit case.' } });
    st = l.state; questions = l.questions;
  } else {
    st = b.inputId ? inputs[b.inputId]?.state : b.state;
    if (typeof st !== 'string' || !st.trim()) return send(res, 400, { error: { kind: 'bad_request', message: 'Provide an inputId or a non-empty state string.' } });
    if (st.length > MAX_STATE_CHARS) return send(res, 400, { error: { kind: 'bad_request', message: `State is limited to ${MAX_STATE_CHARS} characters in this demo.` } });
    try { questions = questionsFor(b.questionIds ?? b.questionSetId ?? 'triage3'); } catch { questions = null; }
    if (!questions || Object.values(questions).some((q) => !q)) return send(res, 400, { error: { kind: 'bad_request', message: 'Unknown question set or question id.' } });
  }
  const errs = validateQuestions(questions);
  if (errs.length) return send(res, 400, { error: { kind: 'bad_request', message: errs.join('; ') } });

  const variant = b.variant === 'one_call_per_question' && lane.id !== 'jev' ? 'one_call_per_question' : 'single_call';
  const cost = variant === 'one_call_per_question' ? Object.keys(questions).length : 1;
  if (!spend(cost)) return send(res, 429, { error: { kind: 'rate_limited', message: `This demo server allows ${CALLS_PER_MIN} upstream calls per minute. Wait a moment.` } });

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const ex = scrub(await runExchange({ lane, state: st, questions, withConfidence: !!b.withConfidence, variant, signal: ac.signal }));
  if (containsSecret(ex)) return send(res, 500, { error: { kind: 'internal', message: 'Response withheld by the secret scanner.' } });
  send(res, 200, ex);
}

async function serveStatic(res, rel) {
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(join(ROOT, 'web')) && !path.startsWith(join(ROOT, 'recordings', 'latest.json'))) return send(res, 404, 'Not found', 'text/plain');
  try { send(res, 200, await readFile(path), MIME[extname(path)] ?? 'application/octet-stream'); }
  catch { send(res, 404, 'Not found', 'text/plain'); }
}

const SCRIPTS = ['viz.js', 'acts.js', 'source-live.js', 'source-replay.js', 'boot.js'];
async function page() {
  const frag = await readFile(join(ROOT, 'web', 'app.html'), 'utf8');
  const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${fonts}<link rel="stylesheet" href="/web/styles.css"></head><body>${frag}${SCRIPTS.map((s) => `<script src="/web/${s}"></script>`).join('')}</body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const bad = guard(req); if (bad) return send(res, 403, { error: { kind: 'forbidden', message: bad } });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await page(), MIME['.html']);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { mode: 'live', ready: state.ready, ...catalog(), lanes: state.lanes, warnings: state.warnings,
        environment: { runtime: `node ${process.version}`, client: 'node:https keep-alive', platform: `${os.type()} ${os.arch()}`, vantage: 'one laptop, one network', networkBaseline: state.baseline } });
    }
    if (req.method === 'POST' && url.pathname === '/api/warm') {
      const b = await readBody(req), jobs = [];
      if (process.env.JEV_API_KEY && b.jev > 0) jobs.push(poolJev(Math.min(4, b.jev)));
      if (process.env.OPENAI_API_KEY && b.openai > 0) jobs.push(poolOpenAI(Math.min(16, b.openai)));
      const opened = await Promise.all(jobs);
      return send(res, 200, { opened: opened.reduce((a, n) => a + n, 0) });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (!state.ready) return send(res, 503, { error: { kind: 'not_ready', message: 'Still warming up connections. Try again in a few seconds.' } });
      return await handleRun(req, res);
    }
    if (req.method === 'GET' && (url.pathname.startsWith('/web/') || url.pathname === '/recordings/latest.json')) return serveStatic(res, url.pathname.slice(1));
    send(res, 404, { error: { kind: 'not_found', message: 'Not found.' } });
  } catch (e) {
    send(res, e.status ?? 400, { error: { kind: 'bad_request', message: String(e.message ?? e).slice(0, 200) } });
    if (e.status === 413) req.destroy();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jev demo: http://127.0.0.1:${PORT}   (replay mode: http://127.0.0.1:${PORT}/?replay=1)`);
  console.log(`keys: JEV_API_KEY ${process.env.JEV_API_KEY ? 'set' : 'missing'}, OPENAI_API_KEY ${process.env.OPENAI_API_KEY ? 'set' : 'missing'}`);
  warmUp().then(() => {
    for (const l of state.lanes) console.log(`  lane ${l.id.padEnd(16)} ${l.model.padEnd(14)} ${l.available ? 'ready' : 'OFF'}${l.effort ? `  effort=${l.effort}` : ''}`);
    for (const w of state.warnings) console.log('  warning:', w);
  });
});
