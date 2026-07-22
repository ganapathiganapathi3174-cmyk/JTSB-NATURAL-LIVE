function log(msg) {
  console.log(`[VOTING-ENGINE] ${msg}`);
}

function runVoting(ocrResults, visionResult) {
  const tStart = Date.now();
  log(`Running voting engine: ${ocrResults.length} OCR sources, vision=${!!visionResult}`);

  const result = {
    amount: { value: null, confidence: 0, source: null, agreed: false },
    utr: { value: null, confidence: 0, source: null, agreed: false },
    upi: { value: null, confidence: 0, source: null, agreed: false },
    date: { value: null, confidence: 0, source: null, agreed: false },
    time: { value: null, confidence: 0, source: null, agreed: false },
    status: { value: null, confidence: 0, source: null, agreed: false },
    bank: { value: null, confidence: 0, source: null },
    appName: { value: null, confidence: 0, source: null },
    overallConfidence: 0,
    fieldCount: 0,
    conflicts: [],
  };

  const fields = ['amount', 'utr', 'upi', 'date', 'time', 'status', 'bank', 'appName'];

  for (const field of fields) {
    const votes = [];

    for (const ocr of ocrResults) {
      if (ocr[field] && ocr[field].value) {
        votes.push({
          value: normalizeValue(field, ocr[field].value),
          confidence: ocr[field].confidence || 80,
          source: ocr.source || 'unknown',
        });
      }
    }

    if (visionResult && visionResult[field]) {
      votes.push({
        value: normalizeValue(field, visionResult[field]),
        confidence: visionResult.confidence || 70,
        source: 'vision',
      });
    }

    if (votes.length === 0) continue;

    const valueGroups = {};
    for (const v of votes) {
      const key = String(v.value).toLowerCase().trim();
      if (!valueGroups[key]) valueGroups[key] = { values: [], totalConfidence: 0, count: 0, sources: [] };
      valueGroups[key].values.push(v.value);
      valueGroups[key].totalConfidence += v.confidence;
      valueGroups[key].count++;
      valueGroups[key].sources.push(v.source);
    }

    const sorted = Object.entries(valueGroups).sort((a, b) => {
      if (a[1].count !== b[1].count) return b[1].count - a[1].count;
      return b[1].totalConfidence - a[1].totalConfidence;
    });

    const winner = sorted[0][1];
    const runnerUp = sorted.length > 1 ? sorted[1][1] : null;

    const agreed = !runnerUp || winner.count > runnerUp.count;

    const avgConfidence = Math.round(winner.totalConfidence / winner.count);
    const bestSource = winner.sources[0];

    result[field] = {
      value: winner.values[0],
      confidence: avgConfidence,
      source: bestSource,
      agreed,
      votes: winner.count,
      totalVotes: votes.length,
    };

    if (!agreed && runnerUp) {
      result.conflicts.push({
        field,
        winner: winner.values[0],
        runnerUp: runnerUp.values[0],
        winnerVotes: winner.count,
        runnerUpVotes: runnerUp.count,
      });
    }
  }

  const resolvedFields = fields.filter(f => result[f].value !== null);
  result.fieldCount = resolvedFields.length;

  const confidences = resolvedFields.map(f => result[f].confidence);
  result.overallConfidence = confidences.length > 0
    ? Math.round(confidences.reduce((s, v) => s + v, 0) / confidences.length)
    : 0;

  log(`Voting complete: ${result.fieldCount} fields resolved, overall confidence=${result.overallConfidence}%, ${result.conflicts.length} conflicts`);
  return result;
}

function normalizeValue(field, value) {
  if (!value) return value;
  const s = String(value).trim();
  if (field === 'amount') {
    return s.replace(/[^0-9.]/g, '');
  }
  if (field === 'upi') {
    return s.toLowerCase().replace(/\s+/g, '');
  }
  if (field === 'utr') {
    return s.toUpperCase().replace(/\s+/g, '');
  }
  return s;
}

function mergeWithExisting(voted, existingPayment) {
  const merged = { ...voted };

  if (!merged.amount.value && existingPayment.amount) {
    merged.amount = { value: String(existingPayment.amount), confidence: 100, source: 'user', agreed: true };
  }
  if (!merged.utr.value && existingPayment.utr) {
    merged.utr = { value: existingPayment.utr, confidence: 100, source: 'user', agreed: true };
  }
  if (!merged.upi.value && existingPayment.upi_id) {
    merged.upi = { value: existingPayment.upi_id, confidence: 100, source: 'user', agreed: true };
  }

  return merged;
}

module.exports = { runVoting, mergeWithExisting };
