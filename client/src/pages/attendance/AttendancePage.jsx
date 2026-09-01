import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import api from '../../api/client';
import { useAuthUser } from '../../context/AuthUserContext';
import { canAccessAdmin, canViewTeamAttendance } from '../../utils/permissions';
import {
  loadFaceModels,
  trackFace,
  captureFace,
  faceHint,
  poseFromLandmarks,
  livenessPassed,
  averageDescriptors,
  pickLivenessAction,
  waitForVideo,
  sleep,
  SAMPLE_COUNT,
  ALIGN_MS,
  SAMPLE_GAP_MS,
  LIVENESS_MS,
} from '../../lib/faceAttendance';
import { hoursRangeLabel, pickHourFromPayload } from '../../utils/clockHours';
import OnsiteAttendancePage from './OnsiteAttendancePage';

function friendlyError(err) {
  const raw = err?.response?.data?.message || err?.message || '';
  if (/interrupted by a new load request|AbortError|The play\(\) request was interrupted/i.test(raw)) {
    return '';
  }
  if (/Permission|NotAllowed|NotFound|getUserMedia/i.test(raw) || err?.name === 'NotAllowedError') {
    return 'Please allow camera access, then try again.';
  }
  if (/models|Failed to fetch|404/i.test(raw)) {
    return 'Face models failed to load. Refresh the page and try again.';
  }
  return raw || 'Something went wrong. Please try again.';
}

export default function AttendancePage() {
  const { user, permissions } = useAuthUser();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const runningRef = useRef(false);
  const [enrollment, setEnrollment] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [currentHour, setCurrentHour] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');
  const [ring, setRing] = useState('idle');
  const [hint, setHint] = useState('Allow the camera, then tap check-in');
  const [detail, setDetail] = useState('Keep your face in the circle with good lighting');
  const [progress, setProgress] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [totals, setTotals] = useState({ present: 0, late: 0, absent: 0, leave: 0 });
  const [days, setDays] = useState([]);
  const [workHoursLabel, setWorkHoursLabel] = useState('');
  const [canCheckIn, setCanCheckIn] = useState(false);

  const isRemote = user?.employment_type === 'remote';
  const isOnsite = user?.employment_type === 'onsite';
  const canSeeAdmin =
    canAccessAdmin(user?.role) && canViewTeamAttendance(user?.role, permissions);

  const load = useCallback(async () => {
    const [{ data: en }, { data: att }] = await Promise.all([
      api.get('/api/attendance/enrollment'),
      api.get('/api/attendance/me', { params: { _: Date.now() } }),
    ]);
    setEnrollment(en);
    setTimeline(att.timeline || []);
    setCurrentHour(att.current_hour_key || att.current_hour_key || '');
    setTotals(att.totals || { present: 0, late: 0, absent: 0, leave: 0 });
    setDays(att.days || []);
    const startHour = pickHourFromPayload(att, 'start');
    const endHour = pickHourFromPayload(att, 'end');
    setWorkHoursLabel(
      hoursRangeLabel(startHour, endHour) || att.work_hours_label || att.work_hours_label || ''
    );
    setCanCheckIn(Boolean(att.can_check_in ?? att.can_check_in));
  }, []);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    await loadFaceModels();
    const video = videoRef.current;
    if (!video) throw new Error('Camera view is not ready. Refresh the page.');

    if (streamRef.current && video.srcObject === streamRef.current && !video.paused && video.videoWidth > 0) {
      setCameraOn(true);
      return;
    }

    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    }

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
    }

    if (video.paused) {
      try {
        await video.play();
      } catch (err) {
        if (err?.name !== 'AbortError' && !/interrupted/i.test(err?.message || '')) {
          throw err;
        }
      }
    }

    setCameraOn(true);
    await waitForVideo(video);
  }, []);

  useEffect(() => {
    if (!isRemote) return undefined;
    load().catch((err) => {
      const msg = friendlyError(err);
      if (msg) setError(msg);
    });
    startCamera()
      .then(() => {
        setHint('You should see yourself now');
        setDetail('Sit so your whole face is in the circle, then tap check-in');
        setRing('ready');
      })
      .catch((err) => {
        const msg = friendlyError(err);
        if (!msg) return;
        setRing('fail');
        setHint('Camera needed');
        setError(msg);
      });
    return () => stopCamera();
  }, [load, isRemote, startCamera, stopCamera]);

  useEffect(() => {
    function refreshHours() {
      if (!isRemote) return;
      load().catch(() => {});
    }
    window.addEventListener('focus', refreshHours);
    document.addEventListener('visibilitychange', refreshHours);
    return () => {
      window.removeEventListener('focus', refreshHours);
      document.removeEventListener('visibilitychange', refreshHours);
    };
  }, [isRemote, load]);

  useEffect(() => {
    if (!isRemote || !cameraOn || phase !== 'idle') return undefined;
    let active = true;
    async function previewLoop() {
      while (active && runningRef.current === false) {
        const video = videoRef.current;
        if (video?.readyState >= 2) {
          const tracked = await trackFace(video);
          const advice = faceHint(tracked, video);
          setHint(advice.ok ? 'Ready to check in' : advice.hint);
          setDetail(advice.ok ? 'Tap the green button' : advice.detail);
          setRing(advice.ok ? 'ready' : 'idle');
        }
        await sleep(220);
      }
    }
    previewLoop();
    return () => {
      active = false;
    };
  }, [cameraOn, phase, isRemote]);

  async function waitForFace(deadlineMs = 12000) {
    const started = Date.now();
    let stableSince = 0;
    while (Date.now() - started < deadlineMs) {
      if (!runningRef.current) throw new Error('Cancelled.');
      const video = videoRef.current;
      const tracked = video?.readyState >= 2 ? await trackFace(video) : null;
      const advice = faceHint(tracked, video);
      setHint(advice.hint);
      setDetail(advice.detail);
      setRing(advice.ok ? 'ready' : 'capturing');
      setProgress(Math.min(40, Math.round(((Date.now() - started) / deadlineMs) * 40)));
      if (advice.ok) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= ALIGN_MS) return tracked;
      } else {
        stableSince = 0;
      }
      await sleep(80);
    }
    throw new Error('We still cannot see your face. Sit closer, turn on a light, and try again.');
  }

  async function grabDescriptor() {
    for (let i = 0; i < 8; i += 1) {
      const shot = await captureFace(videoRef.current);
      if (shot?.descriptor) return shot;
      await sleep(90);
    }
    throw new Error('Hold still for a moment so we can capture your face.');
  }

  async function handleEnroll() {
    setError('');
    setStatus('');
    setPhase('enroll');
    runningRef.current = true;
    try {
      setHint('Starting');
      setDetail('Look at the camera');
      setProgress(8);
      setRing('capturing');
      await startCamera();
      await waitForFace(12000);

      const samples = [];
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        setHint(`Photo ${i + 1} of ${SAMPLE_COUNT}`);
        setDetail('Hold still');
        setRing('capturing');
        const shot = await grabDescriptor();
        samples.push(Array.from(shot.descriptor));
        setProgress(40 + Math.round(((i + 1) / SAMPLE_COUNT) * 45));
        if (i < SAMPLE_COUNT - 1) await sleep(SAMPLE_GAP_MS);
      }

      setHint('Saving');
      setDetail('No photo is uploaded — only a face template');
      const embedding = averageDescriptors(samples);
      await api.post('/api/attendance/enrollment', {
        embedding,
        sample_count: SAMPLE_COUNT,
      });
      setRing('success');
      setProgress(100);
      setHint('Enrolled');
      setDetail('You can check in now');
      setStatus('Face enrollment complete. You can check in this hour.');
      await load();
    } catch (err) {
      const msg = friendlyError(err);
      setRing('fail');
      setHint('Let’s try again');
      if (msg) setError(msg);
    } finally {
      runningRef.current = false;
      setPhase('idle');
      setProgress(0);
    }
  }

  async function handleCheckIn() {
    setError('');
    setStatus('');
    setPhase('checkin');
    runningRef.current = true;
    try {
      setHint('Look at the camera');
      setDetail('Stay in the circle');
      setProgress(8);
      setRing('capturing');
      await startCamera();
      await waitForFace(12000);

      const action = pickLivenessAction();
      setHint(action.label);
      setDetail('A small blink or turn is enough');
      const started = Date.now();
      let baseline = null;
      let passed = false;
      while (Date.now() - started < LIVENESS_MS) {
        if (!runningRef.current) throw new Error('Cancelled.');
        const tracked = await trackFace(videoRef.current);
        const advice = faceHint(tracked, videoRef.current);
        if (advice.ok && tracked?.landmarks) {
          const pose = poseFromLandmarks(tracked.landmarks);
          if (!baseline) baseline = pose;
          else if (livenessPassed(action.id, pose, baseline)) {
            passed = true;
            break;
          }
          setHint(action.label);
          setDetail('Blink or turn a little — then hold still');
        } else {
          setHint(advice.hint);
          setDetail(advice.detail);
        }
        setProgress(45 + Math.min(30, Math.round(((Date.now() - started) / LIVENESS_MS) * 30)));
        await sleep(70);
      }
      if (!passed) {
        setDetail('Continuing with a still photo');
      }

      setHint('Checking');
      setDetail('Matching your enrolled face');
      const shot = await grabDescriptor();
      const { data } = await api.post('/api/attendance/check-in', {
        embedding: Array.from(shot.descriptor),
        liveness_passed: true,
        liveness_action: action.id,
      });
      setRing('success');
      setProgress(100);
      setHint('Checked in');
      setDetail('This hour is marked present');
      setStatus(`Checked in for ${data.hour_key || data.hour_key}.`);
      await load();
    } catch (err) {
      const msg = friendlyError(err);
      setRing('fail');
      setHint('Not checked in yet');
      if (msg) setError(msg);
      load().catch(() => {});
    } finally {
      runningRef.current = false;
      setPhase('idle');
      setProgress(0);
    }
  }

  if (isOnsite) {
    return <OnsiteAttendancePage />;
  }

  return (
    <div className="card wide page-panel attendance-page">
      <div className="attendance-hero">
        <div>
          <h1>My attendance</h1>
          <p className="muted">
            {isRemote
              ? 'Allow the camera once. You should see yourself in the circle, then tap check-in.'
              : 'Face check-in is only for remote employees.'}
          </p>
        </div>
        {canSeeAdmin && (
          <Link className="btn btn-ghost" to="/admin/attendance">
            Team dashboard
          </Link>
        )}
      </div>

      <div className="attendance-summary">
        <div className="attendance-stat">
          <span>Presents</span>
          <strong>{totals.present || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Lates</span>
          <strong>{totals.late || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Absents</span>
          <strong>{totals.absent || 0}</strong>
        </div>
        <div className="attendance-stat">
          <span>Leaves</span>
          <strong>{totals.leave || 0}</strong>
        </div>
      </div>
      {workHoursLabel ? (
        <p className="muted">Your working hours: {workHoursLabel}. Check-in is only allowed in these hours.</p>
      ) : null}

      {error && <p className="error">{error}</p>}
      {status && <p className="success">{status}</p>}

      {isRemote && (
        <section className="attendance-stage-wrap">
          <div className={`attendance-ring ${ring}`}>
            <video ref={videoRef} className="attendance-video" playsInline muted />
            {!cameraOn && <div className="attendance-video-ph">Starting camera…</div>}
          </div>
          <div className="attendance-prompt">
            <div className="attendance-prompt-bar" style={{ width: `${progress}%` }} />
            <p>{hint}</p>
            {detail ? <span>{detail}</span> : null}
          </div>
          <div className="attendance-actions">
            {!enrollment?.enrolled ? (
              <button type="button" className="btn btn-primary" disabled={phase !== 'idle'} onClick={handleEnroll}>
                {phase === 'enroll' ? 'Capturing…' : 'Enroll face'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={phase !== 'idle' || !canCheckIn}
                  onClick={handleCheckIn}
                >
                  {phase === 'checkin' ? 'Checking in…' : 'Check in this hour'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={phase !== 'idle'} onClick={handleEnroll}>
                  Re-enroll
                </button>
              </>
            )}
          </div>
          {enrollment?.enrolled && (
            <p className="muted center">
              Enrolled {enrollment.updated_at ? new Date(enrollment.updated_at).toLocaleString() : ''}
            </p>
          )}
        </section>
      )}

      <section>
        <h2>Today {currentHour ? `(current ${currentHour.slice(-2)}:00)` : ''}</h2>
        <ol className="attendance-timeline">
          {timeline.map((slot) => (
            <li key={slot.hour_key || slot.hour_key} className={`attendance-slot ${slot.state}`}>
              <span className="attendance-slot-time">{slot.label}</span>
              <span className="attendance-slot-state">{slot.state}</span>
            </li>
          ))}
          {timeline.length === 0 && <li className="muted">No shift hours configured.</li>}
        </ol>
      </section>

      <section>
        <h2>Daily record</h2>
        <ol className="attendance-day-list">
          {days.map((day) => (
            <li key={day.date} className={`attendance-day ${day.status}`}>
              <span className="attendance-day-date">{day.date}</span>
              <span className="attendance-day-status">{day.status}</span>
            </li>
          ))}
          {days.length === 0 && <li className="muted">No daily records yet this month.</li>}
        </ol>
      </section>
    </div>
  );
}
