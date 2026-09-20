// Strips auth material from anything that may reach a browser or a recording.
// Upstream 401 bodies can echo a masked fragment of the key, so 401 text is
// replaced wholesale rather than scrubbed.

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_\-*.]{6,}/g,          // OpenAI-style keys, including masked forms
  /Bearer\s+[A-Za-z0-9_\-.*]{8,}/gi,   // any bearer token
];

export function secretsFromEnv(env = process.env) {
  return [env.JEV_API_KEY, env.OPENAI_API_KEY].filter((v) => typeof v === 'string' && v.length >= 8);
}

export function scrubString(s, secrets = secretsFromEnv()) {
  let out = String(s);
  for (const secret of secrets) {
    out = out.split(secret).join('[redacted-key]');
    // masked echoes usually keep the head or tail of the key
    const head = secret.slice(0, 8), tail = secret.slice(-4);
    out = out.replace(new RegExp(escapeRe(head) + '[A-Za-z0-9_\\-*.]*', 'g'), '[redacted-key]');
    out = out.replace(new RegExp('[*.]{2,}' + escapeRe(tail), 'g'), '[redacted-key]');
  }
  for (const re of KEY_PATTERNS) out = out.replace(re, '[redacted-key]');
  return out;
}

export function scrub(value, secrets = secretsFromEnv()) {
  if (typeof value === 'string') return scrubString(value, secrets);
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^(authorization|api[-_]?key|x-api-key|cookie|set-cookie)$/i.test(k)) continue;
      out[k] = scrub(v, secrets);
    }
    return out;
  }
  return value;
}

/** Turn an upstream error response into something safe to show. */
export function safeUpstreamError(lane, status, json, text, secrets = secretsFromEnv()) {
  const envVar = lane === 'jev' ? 'JEV_API_KEY' : 'OPENAI_API_KEY';
  if (status === 401 || status === 403) {
    return { lane, status, kind: 'auth', message: `The API rejected the key in ${envVar} (HTTP ${status}).` };
  }
  const d = json?.detail;
  const detail = Array.isArray(d) ? d.map((e) => `${(e.loc ?? []).slice(1).join('.')}: ${e.msg}`).join('; ') : d?.message ?? d;
  const raw = json?.error?.message ?? json?.message ?? detail ?? text ?? '';
  const message = scrubString(typeof raw === 'string' ? raw : JSON.stringify(raw), secrets).slice(0, 600);
  const kind = status === 422 || status === 400 ? 'bad_request'
    : status === 429 ? 'rate_limited'
    : status === 529 || status === 503 ? 'overloaded'
    : status >= 500 ? 'upstream' : 'error';
  return { lane, status, kind, message };
}

/** Returns true if any secret value appears anywhere in the serialized value. */
export function containsSecret(value, secrets = secretsFromEnv()) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return secrets.some((k) => s.includes(k));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
