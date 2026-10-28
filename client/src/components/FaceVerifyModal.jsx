import { useEffect, useRef, useState } from 'react';
import {
  loadFaceModels,
  areFaceModelsReady,
  captureFace,
  waitForVideo,
  sleep,
} from '../lib/faceAttendance';
import './FaceVerifyModal.css';

const FAST_VERIFY_MS = 2000;

export default function FaceVerifyModal({ open, title, detail, onCancel, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const runningRef = useRef(false);
  const captureRef = useRef(onCapture);
  const [hint, setHint] = useState('Look at the camera');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  captureRef.current = onCapture;

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setError('');
    setHint('Look at the camera');
    setBusy(true);
    runningRef.current = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          video.setAttribute('playsinline', 'true');
          await video.play().catch(() => {});
          await waitForVideo(video, 2500);
        }
        if (!areFaceModelsReady()) await loadFaceModels();
        if (!active || !runningRef.current) return;
        setHint('Matching your face');
        const shot = await grabDescriptor(Date.now() + FAST_VERIFY_MS);
        if (!active || !runningRef.current) return;
        await captureRef.current(Array.from(shot.descriptor));
      } catch (err) {
        if (!active) return;
        setHint('Not verified');
        setError(
          err.response?.data?.message ||
            err.message ||
            'Face did not match. You are still on break.'
        );
      } finally {
        if (active) {
          runningRef.current = false;
          setBusy(false);
        }
      }
    })();

    return () => {
      active = false;
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [open]);

  async function grabDescriptor(until) {
    while (Date.now() < until) {
      if (!runningRef.current) throw new Error('Cancelled.');
      const shot = await captureFace(videoRef.current, { fast: true });
      if (shot?.descriptor && shot.descriptor.length >= 128) return shot;
      await sleep(40);
    }
    throw new Error('Hold still for a moment so we can capture your face.');
  }

  async function handleRetry() {
    setBusy(true);
    setError('');
    runningRef.current = true;
    try {
      setHint('Matching your face');
      const shot = await grabDescriptor(Date.now() + FAST_VERIFY_MS);
      await captureRef.current(Array.from(shot.descriptor));
    } catch (err) {
      setHint('Not verified');
      setError(
        err.response?.data?.message ||
          err.message ||
          'Face did not match. You are still on break.'
      );
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="face-verify-overlay" role="dialog" aria-modal="true">
      <div className="face-verify-card">
        <h2>{title || 'Confirm it is you'}</h2>
        <p className="muted">
          {detail || 'Look at the camera. This takes a moment.'}
        </p>
        <div className="face-verify-oval">
          <video ref={videoRef} playsInline muted autoPlay />
        </div>
        <p className="face-verify-hint">{hint}</p>
        {error ? <p className="error">{error}</p> : null}
        <div className="face-verify-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            Stay on break
          </button>
          {error ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleRetry}>
              {busy ? 'Verifying…' : 'Try again'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled>
              {busy ? 'Verifying…' : 'Verify face'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
