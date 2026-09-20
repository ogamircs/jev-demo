// Keep-alive HTTPS wrapper with a timing breakdown.
// Zero dependencies. We avoid global fetch because it hides whether a socket
// was reused, and on a ~100 ms API a fresh TLS handshake can double the number.
import https from 'node:https';
import { performance } from 'node:perf_hooks';

const agents = new Map();

function agentFor(host) {
  if (!agents.has(host)) {
    agents.set(host, new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000, maxSockets: 32 }));
  }
  return agents.get(host);
}

export class HttpError extends Error {
  constructor(kind, message, timing) {
    super(message);
    this.kind = kind; // 'timeout' | 'network' | 'aborted'
    this.timing = timing;
  }
}

/**
 * @returns {Promise<{status:number, headers:object, text:string, json:any, timing:object}>}
 */
export function request({ method = 'POST', url, headers = {}, body, timeoutMs = 10_000, signal }) {
  const u = new URL(url);
  const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const timing = { reusedSocket: false, connectMs: null, tlsMs: null, ttfbMs: null, totalMs: null };

  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const since = () => Math.round((performance.now() - t0) * 10) / 10;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };

    const req = https.request({
      method,
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      agent: agentFor(u.hostname),
      headers: {
        Accept: 'application/json',
        ...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    });

    const timer = setTimeout(() => {
      timing.totalMs = since();
      req.destroy();
      finish(reject, new HttpError('timeout', `timed out after ${timeoutMs} ms`, timing));
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) { req.destroy(); return finish(reject, new HttpError('aborted', 'aborted', timing)); }
      signal.addEventListener('abort', () => { req.destroy(); finish(reject, new HttpError('aborted', 'aborted', timing)); }, { once: true });
    }

    req.on('socket', (socket) => {
      timing.reusedSocket = req.reusedSocket === true;
      if (!timing.reusedSocket) {
        socket.once('connect', () => { timing.connectMs = since(); });
        socket.once('secureConnect', () => { timing.tlsMs = since(); });
      }
    });

    req.on('response', (res) => {
      timing.ttfbMs = since();
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        timing.totalMs = since();
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON body */ }
        finish(resolve, { status: res.statusCode, headers: res.headers, text, json, timing });
      });
      res.on('error', (e) => { timing.totalMs = since(); finish(reject, new HttpError('network', e.message, timing)); });
    });

    req.on('error', (e) => { timing.totalMs = since(); finish(reject, new HttpError('network', e.code || e.message, timing)); });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** How many idle keep-alive sockets are open to this host right now. */
export function freeSocketCount(host) {
  const a = agents.get(host); if (!a) return 0;
  return Object.entries(a.freeSockets).filter(([name]) => name.startsWith(host + ':')).reduce((n, [, list]) => n + list.length, 0);
}

/** Make sure at least n warm sockets exist, so a burst of concurrent calls never pays for a TLS handshake. Untimed. */
export async function prewarm({ url, headers, n }) {
  const host = new URL(url).hostname, need = Math.max(0, n - freeSocketCount(host));
  if (!need) return 0;
  // concurrent requests force one new socket each; any already-free sockets are used first, so ask for the full n
  await Promise.allSettled(Array.from({ length: n }, () => request({ method: 'GET', url, headers, timeoutMs: 15_000 })));
  return need;
}

export function closeAll() {
  for (const a of agents.values()) a.destroy();
  agents.clear();
}
