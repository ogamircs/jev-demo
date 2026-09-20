// The public, secret-free description of the demo: scenarios, lanes, prices, claims.
// Shared by the live server and the recorder so both modes show the same thing.
import { readFileSync } from 'node:fs';
import * as triage from '../scenarios/triage.mjs';
import { pricing } from './pricing.mjs';
import { signature } from './schema.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
export const modelConfig = read('../config/models.json');
export const claims = read('../config/claims.json');

export function catalog() {
  return {
    product: triage.product,
    scenarioHash: triage.scenarioHash,
    questionBank: Object.fromEntries(Object.entries(triage.questionBank).map(([id, q]) => [id, { ...q, signature: signature(q) }])),
    questionSets: triage.questionSets,
    inputs: triage.inputs,
    limits: Object.fromEntries(Object.entries(triage.limits).map(([id, l]) => [id, { ...l, questions: Object.fromEntries(Object.entries(l.questions).map(([k, q]) => [k, { ...q, signature: signature(q) }])) }])),
    featured: triage.featured,
    pricing, claims,
  };
}

/** Which configured OpenAI lanes does this key actually have access to? */
export function availableLanes(openaiModelIds) {
  const have = new Set(openaiModelIds);
  return modelConfig.openai.filter((l) => have.has(l.model));
}
