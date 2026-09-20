// Maps both engines' answers onto one shape so the UI and the recording have a
// single source of truth. `confidenceKind` says where a confidence number came from:
//   distribution  = Jev's summary of how peaked its probability distribution is
//   self_reported = the LLM wrote a number when asked
//   null          = no confidence available (Jev noul, or LLM labels-only schema)

const argmax = (probs) => Object.entries(probs).reduce((b, [k, v]) => (v > b[1] ? [k, v] : b), [null, -1])[0];

export function normalizeJev(questions, answers) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = answers?.[id];
    if (!a) { out[id] = null; continue; }
    if (q.type === 'choice') {
      out[id] = { type: 'choice', label: a.choice, level: null, value: null, p: a.probabilities?.[a.choice] ?? null,
        probabilities: a.probabilities ?? null, legend: null, confidence: a.confidence ?? null, confidenceKind: 'distribution' };
    } else if (q.type === 'score') {
      const top = a.probabilities ? Number(argmax(a.probabilities)) : Math.round(a.score);
      out[id] = { type: 'score', label: a.legend?.[String(top)] ?? q.criteria[top] ?? null, level: top, value: a.score,
        p: a.probabilities?.[String(top)] ?? null, probabilities: a.probabilities ?? null, legend: a.legend ?? null,
        confidence: a.confidence ?? null, confidenceKind: 'distribution' };
    } else {
      out[id] = { type: 'noul', label: a.noul >= 0.5 ? 'yes' : 'no', level: null, value: a.noul, p: a.noul,
        probabilities: null, legend: null, confidence: null, confidenceKind: null };
    }
  }
  return out;
}

export function normalizeOpenAI(questions, parsed, withConfidence = false) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    const raw = parsed?.[id];
    if (raw === undefined || raw === null) { out[id] = null; continue; }
    const ans = withConfidence ? raw.answer : raw;
    const confidence = withConfidence && typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : null;
    const confidenceKind = confidence === null ? null : 'self_reported';
    if (q.type === 'choice') {
      out[id] = { type: 'choice', label: ans, level: null, value: null, p: null, probabilities: null, legend: null, confidence, confidenceKind };
    } else if (q.type === 'score') {
      out[id] = { type: 'score', label: q.criteria[ans] ?? null, level: ans, value: ans, p: null, probabilities: null, legend: null, confidence, confidenceKind };
    } else {
      out[id] = { type: 'noul', label: ans ? 'yes' : 'no', level: null, value: ans ? 1 : 0, p: null, probabilities: null, legend: null, confidence, confidenceKind };
    }
  }
  return out;
}

/** Agreement rule: choice by label, score by most-probable level vs integer, noul by p>=0.5 vs boolean. */
export function agree(a, b) {
  if (!a || !b || a.type !== b.type) return null;
  if (a.type === 'score') return a.level === b.level;
  return a.label === b.label;
}

/** Does a normalized answer match the author's label? `acceptable` may list several. */
export function matchesLabel(answer, expected) {
  if (!answer || expected === undefined || expected === null) return null;
  const list = Array.isArray(expected) ? expected : [expected];
  const got = answer.type === 'score' ? answer.level : answer.type === 'noul' ? answer.label === 'yes' : answer.label;
  return list.some((e) => e === got);
}
