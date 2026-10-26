const RAW_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);
/** 0.6 was letting other people through. Keep a friendly band for the same person. */
const MATCH_THRESHOLD = Math.min(0.5, Math.max(0.4, Number.isFinite(RAW_THRESHOLD) ? RAW_THRESHOLD : 0.5));
const EXPECTED_LENGTH = 128;

function parseEmbedding(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    const keys = Object.keys(list).sort((a, b) => Number(a) - Number(b));
    list = keys.map((k) => list[k]);
  }
  if (ArrayBuffer.isView(list)) list = Array.from(list);
  if (!Array.isArray(list) || list.length < EXPECTED_LENGTH) return null;
  const nums = list.slice(0, EXPECTED_LENGTH).map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return l2Normalize(nums);
}

function l2Normalize(values) {
  if (!Array.isArray(values) || values.length < EXPECTED_LENGTH) return null;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const n = Number(values[i]);
    if (!Number.isFinite(n)) return null;
    sum += n * n;
  }
  const mag = Math.sqrt(sum);
  if (!Number.isFinite(mag) || mag < 0.2) return null;
  return values.map((n) => Number(n) / mag);
}

function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length || a.length < EXPECTED_LENGTH) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function embeddingDistance(stored, probe) {
  const a = l2Normalize(stored);
  const b = l2Normalize(probe);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return euclideanDistance(a, b);
}

function isFaceMatch(distance, threshold = MATCH_THRESHOLD) {
  return Number.isFinite(distance) && distance <= threshold;
}

module.exports = {
  MATCH_THRESHOLD,
  EXPECTED_LENGTH,
  parseEmbedding,
  l2Normalize,
  euclideanDistance,
  embeddingDistance,
  isFaceMatch,
};
