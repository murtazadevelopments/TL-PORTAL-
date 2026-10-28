import * as faceapi from 'face-api.js';

const MODEL_URL = '/models';
const SAMPLE_COUNT = 2;
const ALIGN_MS = 0;
const SAMPLE_GAP_MS = 40;
const LIVENESS_MS = 0;
const VERIFY_MS = 2200;
const TRACK_SIZE = 160;
const CAPTURE_SIZE = 224;
const DETECT_SCORE = 0.25;
const MIN_FACE_RATIO = 0.1;
const MAX_FACE_RATIO = 0.92;

let modelsReady = false;
let modelsLoading = null;
let scratchCanvas = null;
let jpegCanvas = null;

export const LIVENESS_ACTIONS = [
  { id: 'blink', label: 'Blink once' },
  { id: 'left', label: 'Turn slightly left' },
  { id: 'right', label: 'Turn slightly right' },
];

export function areFaceModelsReady() {
  return modelsReady;
}

export async function loadFaceModels() {
  if (modelsReady) return;
  if (!modelsLoading) {
    modelsLoading = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ])
      .then(() => {
        modelsReady = true;
      })
      .catch((err) => {
        modelsLoading = null;
        throw err;
      });
  }
  await modelsLoading;
}

function detectorOptions(inputSize) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: DETECT_SCORE });
}

function getScratchCanvas() {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
  return scratchCanvas;
}

function drawVideoFrame(video, maxSide) {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw < 16 || vh < 16) return null;
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.max(32, Math.round(vw * scale));
  const h = Math.max(32, Math.round(vh * scale));
  const canvas = getScratchCanvas();
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

let inferLock = Promise.resolve();

function withFaceLock(fn) {
  const run = inferLock.then(fn, fn);
  inferLock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function withTfScope(fn) {
  return withFaceLock(async () => {
    const engine = faceapi.tf?.engine?.();
    if (!engine?.startScope) return fn();
    engine.startScope();
    try {
      return await fn();
    } finally {
      engine.endScope();
    }
  });
}

function videoReady(input) {
  return Boolean(input && input.readyState >= 2 && input.videoWidth > 16);
}

export async function trackFace(input, { landmarks = false } = {}) {
  if (!modelsReady || !videoReady(input)) return null;
  const frame = drawVideoFrame(input, TRACK_SIZE);
  if (!frame) return null;
  return withTfScope(() => {
    const detect = faceapi.detectSingleFace(frame, detectorOptions(TRACK_SIZE));
    return landmarks ? detect.withFaceLandmarks(true) : detect;
  });
}

export function videoFrameJpeg(video, maxSide = 480, quality = 0.78) {
  const vw = video?.videoWidth || 0;
  const vh = video?.videoHeight || 0;
  if (vw < 16 || vh < 16) return null;
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.max(32, Math.round(vw * scale));
  const h = Math.max(32, Math.round(vh * scale));
  if (!jpegCanvas) jpegCanvas = document.createElement('canvas');
  if (jpegCanvas.width !== w) jpegCanvas.width = w;
  if (jpegCanvas.height !== h) jpegCanvas.height = h;
  const ctx = jpegCanvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, w, h);
    return jpegCanvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

export async function captureFace(input, { fast = false } = {}) {
  if (!modelsReady || !videoReady(input)) return null;
  const size = fast ? TRACK_SIZE : CAPTURE_SIZE;
  const frame = drawVideoFrame(input, size);
  if (!frame) return null;
  const shot = await withTfScope(() =>
    faceapi
      .detectSingleFace(frame, detectorOptions(size))
      .withFaceLandmarks(true)
      .withFaceDescriptor()
  );
  const score = Number(shot?.detection?.score);
  if (!shot?.descriptor || shot.descriptor.length < 128) return null;
  if (Number.isFinite(score) && score < DETECT_SCORE) return null;
  return shot;
}

export async function waitForVideo(video, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (video?.readyState >= 2 && video.videoWidth > 16 && video.videoHeight > 16) return;
    await sleep(30);
  }
  throw new Error('Camera did not start. Allow camera access and try again.');
}

function eyeAspect(eye) {
  if (!eye || eye.length < 6) return 1;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
}

export function poseFromLandmarks(landmarks) {
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();
  const ear = (eyeAspect(leftEye) + eyeAspect(rightEye)) / 2;
  const noseX = nose[3]?.x ?? nose[2]?.x;
  const leftCheek = jaw[3]?.x;
  const rightCheek = jaw[13]?.x;
  const span = Math.max(1, (rightCheek || 0) - (leftCheek || 0));
  const yaw = (noseX - ((leftCheek || 0) + span / 2)) / span;
  return { ear, yaw };
}

export function faceHint(detection) {
  const det = detection?.detection || detection;
  if (!det?.box) {
    return { ok: false, hint: 'Look at the camera', detail: 'Face the light and fill the circle' };
  }
  const box = det.box;
  const w = Number(det.imageWidth) || Number(det._imageDims?.width) || 0;
  const h = Number(det.imageHeight) || Number(det._imageDims?.height) || 0;
  if (w < 8 || h < 8) {
    return { ok: true, hint: 'Hold still', detail: 'Matching your face' };
  }
  const ratio = Math.max(box.width / w, box.height / h);
  const cx = (box.x + box.width / 2) / w;
  const cy = (box.y + box.height / 2) / h;
  if (ratio < MIN_FACE_RATIO) return { ok: false, hint: 'Move closer', detail: 'Bring your face into the circle' };
  if (ratio > MAX_FACE_RATIO) return { ok: false, hint: 'Move back a little', detail: 'Keep your whole face in view' };
  if (cx < 0.12) return { ok: false, hint: 'Move left', detail: 'Center yourself in the circle' };
  if (cx > 0.88) return { ok: false, hint: 'Move right', detail: 'Center yourself in the circle' };
  if (cy < 0.1) return { ok: false, hint: 'Move down', detail: 'Keep your face in the circle' };
  if (cy > 0.9) return { ok: false, hint: 'Move up', detail: 'Keep your face in the circle' };
  return { ok: true, hint: 'Hold still', detail: 'Matching your face' };
}

export function faceUsable(detection) {
  const det = detection?.detection || detection;
  return Boolean(det?.box);
}

export function livenessPassed(action, current, baseline) {
  if (!current || !baseline) return false;
  if (action === 'blink') {
    const base = baseline.ear || 0.28;
    return current.ear < Math.min(0.22, base * 0.88);
  }
  if (action === 'left') return current.yaw < baseline.yaw - 0.028;
  if (action === 'right') return current.yaw > baseline.yaw + 0.028;
  return Math.abs(current.yaw - baseline.yaw) > 0.03 || current.ear < (baseline.ear || 0.28) * 0.88;
}

export function averageDescriptors(list) {
  if (!list.length) return null;
  const len = list[0].length;
  if (len < 128) return null;
  const out = new Array(len).fill(0);
  for (const d of list) {
    if (!d || d.length !== len) return null;
    for (let i = 0; i < len; i += 1) out[i] += Number(d[i]);
  }
  for (let i = 0; i < len; i += 1) out[i] /= list.length;
  let mag = 0;
  for (let i = 0; i < len; i += 1) mag += out[i] * out[i];
  mag = Math.sqrt(mag);
  if (!Number.isFinite(mag) || mag < 0.2) return null;
  return out.map((n) => n / mag);
}

export function pickLivenessAction() {
  return LIVENESS_ACTIONS[Math.floor(Math.random() * LIVENESS_ACTIONS.length)];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { SAMPLE_COUNT, ALIGN_MS, SAMPLE_GAP_MS, LIVENESS_MS, VERIFY_MS };
