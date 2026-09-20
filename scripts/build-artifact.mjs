// Builds the published artifact: one self-contained HTML file in replay mode.
// It inlines the CSS, the JS (without the live data source) and a slimmed recording, then refuses to
// write the file if anything unsafe is found.
// Usage: node --env-file=.env scripts/build-artifact.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { containsSecret, secretsFromEnv } from '../lib/sanitize.mjs';
import { validateRecording } from '../lib/recording.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const OUT = new URL('../artifact/how-jev-decides.html', import.meta.url);
const MAX_BYTES = 1024 * 1024;
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">';

const rec = JSON.parse(read('../recordings/latest.json'));
const recErrs = validateRecording(rec);
if (recErrs.length) fail('recording is not valid: ' + recErrs[0]);

// Slim: raw bodies are only shown in the anatomy panel, which uses Jev's first sample for each ticket.
let kept = 0;
for (const ex of rec.exchanges) {
  const keep = ex.laneId === 'jev' && ex.sampleIndex === 0 && (ex.act === 'race' || ex.act === 'anatomy');
  if (keep) kept++; else ex.raw = null;
  delete ex.retryAfter;
}
// Escape every non-ASCII character so the file renders correctly even if it is served without a charset.
const ascii = (s) => s.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const json = ascii(JSON.stringify(rec).replace(/</g, '\\u003c'));

const frag = read('../web/app.html');
if (!frag.startsWith('<title>')) fail('web/app.html must start with <title>');
const titleEnd = frag.indexOf('</title>') + '</title>'.length;
const js = ascii(['viz.js', 'acts.js', 'source-replay.js', 'boot.js'].map((f) => `/* ${f} */\n` + read(`../web/${f}`)).join('\n'));
const html = [
  frag.slice(0, titleEnd), FONTS, `<style>\n${read('../web/styles.css')}</style>`, frag.slice(titleEnd),
  `<script id="jev-recording" type="application/json">${json}</script>`, `<script>\n${js}\n</script>`, '',
].join('\n');

// ---- safety checks: any failure stops the build ----
const problems = [];
if (!process.env.JEV_API_KEY || !process.env.OPENAI_API_KEY) problems.push('run with --env-file=.env so the secret scan can compare against the real key values');
if (containsSecret(html, secretsFromEnv())) problems.push('a key value appears in the output');
if (/\bsk-[A-Za-z0-9_-]{16,}/.test(html)) problems.push('something shaped like an OpenAI key appears in the output');
if (/authorization|bearer\s/i.test(json)) problems.push('auth header material appears in the recording');
for (const [name, re] of Object.entries({ 'fetch(': /\bfetch\s*\(/, XMLHttpRequest: /XMLHttpRequest/, WebSocket: /\bWebSocket\b/, EventSource: /\bEventSource\b/, sendBeacon: /sendBeacon/, 'dynamic import': /\bimport\s*\(/ })) if (re.test(js)) problems.push(`network API in bundled JS: ${name}`);
if (/<\/script/i.test(js)) problems.push('bundled JS contains a closing script tag');
if (/<\s*(html|head|body)[\s>]/i.test(frag)) problems.push('page fragment contains html, head or body tags');
const loads = [...html.matchAll(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*"(https?:[^"]+)"/gi)].map((m) => m[1]);
const cssUrls = [...read('../web/styles.css').matchAll(/url\(\s*['"]?(https?:[^'")]+)/gi)].map((m) => m[1]);
for (const u of [...loads, ...cssUrls]) if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) problems.push(`external resource: ${u}`);
const bytes = Buffer.byteLength(html);
if (bytes > MAX_BYTES) problems.push(`output is ${(bytes / 1024).toFixed(0)} KB, over the ${MAX_BYTES / 1024} KB budget`);
if (/[^\x00-\x7f]/.test(html)) problems.push('non-ASCII character left in the output (check web/app.html and web/styles.css)');
if (problems.length) fail(problems.join('\n  '));

mkdirSync(new URL('../artifact/', import.meta.url), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote artifact/how-jev-decides.html: ${(bytes / 1024).toFixed(0)} KB, ${rec.exchanges.length} exchanges (${kept} with raw bodies), recorded ${rec.recordedAt}`);
console.log('checks passed: no key values, no network APIs in JS, no external resources except Google Fonts, no html/head/body tags, under size budget');

function fail(msg) { console.error('BUILD FAILED:\n  ' + msg); process.exit(1); }
