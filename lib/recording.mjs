// Shared between the recorder and the artifact builder.
import { questionSets } from '../scenarios/triage.mjs';

/** Must match web/source-replay.js J.exchangeKey(). */
export function exchangeKey({ laneId, inputId, limitId, questionSetId, questionIds, withConfidence, variant }) {
  const q = limitId ? 'limit' : (questionIds ?? questionSets[questionSetId ?? 'triage3']).join(',');
  return [laneId, limitId ?? inputId ?? 'free', q, withConfidence ? 'c' : '', variant === 'one_call_per_question' ? 'p' : ''].join('|');
}

export function validateRecording(rec) {
  const errs = [];
  for (const k of ['schemaVersion', 'recordedAt', 'scenarioHash', 'environment', 'lanes', 'catalog', 'exchanges', 'plan']) if (!(k in rec)) errs.push(`missing ${k}`);
  for (const [i, ex] of (rec.exchanges ?? []).entries()) {
    if (!ex.key || typeof ex.sampleIndex !== 'number') errs.push(`exchange ${i}: missing key or sampleIndex`);
    if (ex.ok && (!ex.timing || typeof ex.timing.totalMs !== 'number' || !ex.normalized)) errs.push(`exchange ${i}: ok but missing timing or answers`);
  }
  return errs;
}
