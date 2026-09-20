// Stage 1 probe: are the keys set, do they authenticate, which models are reachable.
// Never prints key values.
import { request, closeAll } from '../lib/http.mjs';

const JEV = process.env.JEV_API_KEY, OAI = process.env.OPENAI_API_KEY;
console.log('JEV_API_KEY   :', JEV ? 'set' : 'missing');
console.log('OPENAI_API_KEY:', OAI ? 'set' : 'missing');

async function models(label, url, key) {
  try {
    const r = await request({ method: 'GET', url, headers: { Authorization: `Bearer ${key}` }, timeoutMs: 15_000 });
    const ids = (r.json?.data ?? r.json?.models ?? []).map((m) => m.id ?? m.name ?? m).filter(Boolean);
    console.log(`\n${label}: HTTP ${r.status}, ${ids.length} models, ${r.timing.totalMs} ms (cold, tls ${r.timing.tlsMs} ms)`);
    return { status: r.status, ids, shape: r.json && !ids.length ? Object.keys(r.json) : null };
  } catch (e) {
    console.log(`\n${label}: FAILED ${e.kind ?? ''} ${e.message}`);
    return { status: 0, ids: [] };
  }
}

const jev = await models('Jev GET /v1/models', 'https://api.typesafe.ai/v1/models', JEV);
console.log(jev.ids.length ? jev.ids.join(', ') : `(no ids; top-level keys: ${jev.shape})`);

const oai = await models('OpenAI GET /v1/models', 'https://api.openai.com/v1/models', OAI);
const skip = /embed|whisper|tts|dall|image|audio|realtime|moderation|transcribe|search|babbage|davinci|sora|codex|computer/i;
const chat = oai.ids.filter((id) => !skip.test(id)).sort();
console.log(chat.join('\n'));
closeAll();
