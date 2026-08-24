const MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.6);

function parseEmbedding(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || list.length < 64) return null;
  const nums = list.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

function euclideanDistance(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function isFaceMatch(distance, threshold = MATCH_THRESHOLD) {
  return Number.isFinite(distance) && distance <= threshold;
}

module.exports = {
  MATCH_THRESHOLD,
  parseEmbedding,
  parseEmbedding: parseEmbedding,
  euclideanDistance,
  euclideanDistance: euclideanDistance,
  isFaceMatch,
  isFaceMatch: isFaceMatch,
};
