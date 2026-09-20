// Compiles a Jev question map into (a) a strict OpenAI JSON schema and (b) a prompt.
// Instructions and criteria go in the prompt once. The schema carries enums only,
// so the LLM lane does not pay for the rubric twice.

export const LIMITS = { scoreMin: 2, scoreMax: 10, choiceMax: 255 };

export function validateQuestions(questions) {
  const errs = [];
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return ['questions must be an object keyed by question id'];
  const ids = Object.keys(questions);
  if (!ids.length) errs.push('at least one question is required');
  for (const id of ids) {
    const q = questions[id];
    if (!q || typeof q !== 'object') { errs.push(`${id}: must be an object`); continue; }
    if (typeof q.instructions !== 'string' || !q.instructions.trim()) errs.push(`${id}: instructions must be a non-empty string`);
    if (q.type === 'choice') {
      const opts = q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria) ? Object.keys(q.criteria) : [];
      if (opts.length < 2) errs.push(`${id}: choice needs at least 2 options in criteria`);
      if (opts.length > LIMITS.choiceMax) errs.push(`${id}: choice allows at most ${LIMITS.choiceMax} options`);
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < LIMITS.scoreMin || q.criteria.length > LIMITS.scoreMax) {
        errs.push(`${id}: score needs ${LIMITS.scoreMin} to ${LIMITS.scoreMax} level descriptions`);
      }
    } else if (q.type !== 'noul') {
      errs.push(`${id}: type must be choice, score, or noul`);
    }
  }
  return errs;
}

/** Type signature shown in the UI, e.g. choice<billing | technical | sales>. */
export function signature(q) {
  if (q.type === 'choice') return `choice<${Object.keys(q.criteria).join(' | ')}>`;
  if (q.type === 'score') return `score<0..${q.criteria.length - 1}>`;
  return 'noul';
}

export function compileForOpenAI(questions, { withConfidence = false } = {}) {
  const properties = {};
  const lines = [];
  for (const [id, q] of Object.entries(questions)) {
    let answer;
    if (q.type === 'choice') {
      answer = { type: 'string', enum: Object.keys(q.criteria) };
      const opts = Object.entries(q.criteria).map(([k, d]) => (d ? `    ${k} = ${d}` : `    ${k}`)).join('\n');
      lines.push(`- ${id} (choose one): ${q.instructions}\n${opts}`);
    } else if (q.type === 'score') {
      answer = { type: 'integer', enum: q.criteria.map((_, i) => i) };
      const lv = q.criteria.map((d, i) => `    ${i} = ${d}`).join('\n');
      lines.push(`- ${id} (level index): ${q.instructions}\n${lv}`);
    } else {
      answer = { type: 'boolean' };
      const c = q.criteria ? `\n    true = ${q.criteria.true ?? ''}\n    false = ${q.criteria.false ?? ''}` : '';
      lines.push(`- ${id} (true or false): ${q.instructions}${c}`);
    }
    properties[id] = withConfidence
      ? { type: 'object', properties: { answer, confidence: { type: 'number' } }, required: ['answer', 'confidence'], additionalProperties: false }
      : answer;
  }
  const schema = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  const system = [
    'You are a decision function inside a software system. Read STATE and answer every question.',
    'Return only JSON that matches the schema. For level questions, return the index of the level that fits best.',
    withConfidence ? 'For each answer also return confidence: a number from 0 to 1, the probability that your answer is correct.' : null,
  ].filter(Boolean).join(' ');
  return { schema, system, questionsText: lines.join('\n') };
}

export function stateToText(state) {
  return typeof state === 'string' ? state : JSON.stringify(state, null, 2);
}
