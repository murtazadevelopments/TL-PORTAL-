import * as faceapi from 'face-api.js';

const MODEL_URL = '/models';
const SAMPLE_COUNT = 3;
const ALIGN_MS = 250;
const SAMPLE_GAP_MS = 280;
const LIVENESS_MS = 4000;

let modelsReady = false;
let modelsLoading = null;

export const LIVENESS_ACTIONS = [
  { id: 'blink', label: 'Blink once' },
  { id: 'left', label: 'Turn slightly left' },
  { id: 'right', label: 'Turn slightly right' },
];

export async function loadFaceModels() {
  if (modelsReady) return;
  if (!modelsLoading) {
    modelsLoading = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => {
      modelsReady = true;
    });
  }
  await modelsLoading;
}

function easyOptions() {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 });
}

export async function trackFace(input) {
  if (!input || input.readyState < 2 || !input.videoWidth) return null;
  return faceapi.detectSingleFace(input, easyOptions()).withFaceLandmarks(true);
}

export async function captureFace(input) {
  if (!input || input.readyState < 2 || !input.videoWidth) return null;
  return faceapi
    .detectSingleFace(input, easyOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptor();
}

export async function waitForVideo(video, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (video?.readyState >= 2 && video.videoWidth > 16 && video.videoHeight > 16) return;
    await sleep(50);
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

export function faceHint(detection, video) {
  if (!detection?.detection) {
    return { ok: false, hint: 'Look at the camera', detail: 'Make sure your face is lit and in view' };
  }
  const box = detection.detection.box;
  const w = video?.videoWidth || 1;
  const h = video?.videoHeight || 1;
  const ratio = Math.max(box.width / w, box.height / h);
  const cx = (box.x + box.width / 2) / w;
  const cy = (box.y + box.height / 2) / h;
  if (ratio < 0.12) return { ok: false, hint: 'Move a bit closer', detail: 'We need a clearer view of your face' };
  if (ratio > 0.88) return { ok: false, hint: 'Move back a little', detail: 'Keep your whole face in view' };
  if (cx < 0.18) return { ok: false, hint: 'Move right', detail: 'Center yourself in the circle' };
  if (cx > 0.82) return { ok: false, hint: 'Move left', detail: 'Center yourself in the circle' };
  if (cy < 0.16) return { ok: false, hint: 'Move down', detail: 'Keep your face in the circle' };
  if (cy > 0.84) return { ok: false, hint: 'Move up', detail: 'Keep your face in the circle' };
  return { ok: true, hint: 'Perfect', detail: 'Hold still' };
}

export function livenessPassed(action, current, baseline) {
  if (!current || !baseline) return false;
  if (action === 'blink') {
    const base = baseline.ear || 0.28;
    return current.ear < Math.min(0.24, base * 0.9);
  }
  if (action === 'left') return current.yaw < baseline.yaw - 0.035;
  if (action === 'right') return current.yaw > baseline.yaw + 0.035;
  return Math.abs(current.yaw - baseline.yaw) > 0.04 || current.ear < (baseline.ear || 0.28) * 0.9;
}

export function averageDescriptors(list) {
  if (!list.length) return null;
  const len = list[0].length;
  const out = new Array(len).fill(0);
  for (const d of list) {
    for (let i = 0; i < len; i += 1) out[i] += d[i];
  }
  return out.map((n) => n / list.length);
}

export function pickLivenessAction() {
  return LIVENESS_ACTIONS[Math.floor(Math.random() * LIVENESS_ACTIONS.length)];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { SAMPLE_COUNT, ALIGN_MS, SAMPLE_GAP_MS, LIVENESS_MS };
