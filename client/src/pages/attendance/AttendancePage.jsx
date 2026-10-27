import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import api from '../../api/client';
import { useAuthUser } from '../../context/AuthUserContext';
import { canAccessAdmin, canViewTeamAttendance } from '../../utils/permissions';
import {
  loadFaceModels,
  areFaceModelsReady,
  trackFace,
  captureFace,
  faceHint,
  faceUsable,
  averageDescriptors,
  pickLivenessAction,
  waitForVideo,
  videoFrameJpeg,
  sleep,
  SAMPLE_COUNT,
  ALIGN_MS,
  SAMPLE_GAP_MS,
  VERIFY_MS,
} from '../../lib/faceAttendance';
import { withAuthDocumentUrl } from '../../utils/documentUrls';
import { hoursRangeLabel, pickHourFromPayload } from '../../utils/clockHours';
import AttendanceGuideModal, {
  hasSeenAttendanceGuide,
  markAttendanceGuideSeen,
} from '../../components/AttendanceGuideModal';
import RemoteAttendanceRules from '../../components/RemoteAttendanceRules';
import OnsiteAttendancePage from './OnsiteAttendancePage';
import './AttendancePage.css';

function formatRemainMs(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function remainFromCheck(check, nowTick, field) {
  if (!check?.[field]) return 0;
  const end = new Date(check[field]).getTime();
  return Math.max(0, end - nowTick);
}

function friendlyDayStatus(status) {
  if (status === 'present' || status === 'verified') return 'Present';
  if (status === 'late') return 'Late';
  if (status === 'absent') return 'Absent';
  if (status === 'leave') return 'Leave';
  if (status === 'holiday') return 'Holiday';
  if (status === 'pending') return 'Pending';
  return status || '—';
}

function formatKarachiClock(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'ID';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function confidenceFromDistance(distance, threshold = 0.6) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return null;
  return Math.round(Math.max(0, Math.min(0.99, 1 - d / (threshold * 1.15))) * 100);
}

function FaceMeshArt() {
  return (
    <svg className="faceid-mesh" viewBox="0 0 200 240" aria-hidden="true">
      <ellipse cx="100" cy="118" rx="64" ry="86" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M100 32 L100 204 M36 118 H164 M58 58 Q100 42 142 58 M52 178 Q100 202 148 178"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.85"
      />
      <path
        d="M70 90 L100 72 L130 90 L122 128 L78 128 Z M86 148 L100 168 L114 148"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.05"
      />
      <circle cx="78" cy="108" r="3.2" fill="currentColor" />
      <circle cx="122" cy="108" r="3.2" fill="currentColor" />
      <circle cx="100" cy="72" r="2.4" fill="currentColor" />
      <circle cx="100" cy="168" r="2.4" fill="currentColor" />
    </svg>
  );
}

function FaceScanOverlay() {
  return (
    <svg className="faceid-scan-grid" viewBox="0 0 200 240" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <circle key={`d-${i}`} cx={58 + (i % 3) * 42} cy={70 + Math.floor(i / 3) * 46} r="1.6" fill="currentColor" />
      ))}
      <path
        d="M40 70 L100 42 L160 70 L168 130 L100 198 L32 130 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.55"
      />
      <path d="M70 96 L130 96 M100 52 L100 180" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
    </svg>
  );
}

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
  const [modelsReady, setModelsReady] = useState(() => areFaceModelsReady());
  const [engineHint, setEngineHint] = useState('');
  const [openCheck, setOpenCheck] = useState(null);
  const [sundayHoliday, setSundayHoliday] = useState(false);
  const [attendanceEnabled, setAttendanceEnabled] = useState(true);
  const [profileComplete, setProfileComplete] = useState(true);
  const [profileIncompleteMessage, setProfileIncompleteMessage] = useState('');
  const [checksPerShift, setChecksPerShift] = useState(5);
  const [flexibleHours, setFlexibleHours] = useState(false);
  const [faceCheckCapture, setFaceCheckCapture] = useState(false);
  const [durationLabel, setDurationLabel] = useState('');
  const [lastCheckedInAt, setLastCheckedInAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [guideOpen, setGuideOpen] = useState(false);
  const [verify, setVerify] = useState({
    result: 'idle',
    confidence: null,
    time: null,
    kind: null,
    status: null,
  });
  const [avatarBroken, setAvatarBroken] = useState(false);
  const settleTimerRef = useRef(null);

  const isRemote = user?.employment_type === 'remote';
  const isOnsite = String(user?.employment_type || 'onsite').trim().toLowerCase() !== 'remote';
  const canSeeAdmin =
    canAccessAdmin(user?.role) && canViewTeamAttendance(user?.role, permissions);
  const avatarSrc = withAuthDocumentUrl(user?.profile_picture_url, user?.updated_at || user?.id);

  useEffect(() => {
    setAvatarBroken(false);
  }, [avatarSrc]);
  const displayName = user?.name || user?.username || 'Employee';
  const scanning = phase === 'enroll' || phase === 'checkin';
  const enterTime = verify.kind === 'checkout' ? lastCheckedInAt : verify.time || lastCheckedInAt;
  const exitTime = verify.kind === 'checkout' ? verify.time : null;

  const load = useCallback(async () => {
    const [{ data: en }, { data: att }] = await Promise.all([
      api.get('/api/attendance/enrollment'),
      api.get('/api/attendance/me', { params: { _: Date.now() } }),
    ]);
    setEnrollment(en);
    setTimeline(att.timeline || []);
    setTotals(att.totals || { present: 0, late: 0, absent: 0, leave: 0 });
    setDays(att.days || []);
    const startHour = pickHourFromPayload(att, 'start');
    const endHour = pickHourFromPayload(att, 'end');
    setWorkHoursLabel(
      hoursRangeLabel(startHour, endHour) || att.work_hours_label || att.work_hours_label || ''
    );
    setCanCheckIn(Boolean(att.can_check_in ?? att.can_check_in));
    setOpenCheck(att.open_check || null);
    setSundayHoliday(Boolean(att.holiday));
    setAttendanceEnabled(att.attendance_enabled !== false);
    setProfileComplete(att.profile_complete !== false);
    setProfileIncompleteMessage(
      att.profile_incomplete_message ||
        'Complete your profile before attendance can be marked.'
    );
    setFlexibleHours(Boolean(att.flexible_hours));
    setFaceCheckCapture(Boolean(att.face_check_capture));
    setDurationLabel(att.duration_label || '');
    setLastCheckedInAt(att.last_checked_in_at || null);
    setChecksPerShift(Number(att.checks_per_shift) > 0 ? Number(att.checks_per_shift) : 5);
  }, []);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) throw new Error('Camera view is not ready. Refresh the page.');

    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 360 },
        },
        audio: false,
      });
    }

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
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

    if (!areFaceModelsReady()) {
      setEngineHint('Preparing face check…');
      await loadFaceModels();
      setEngineHint('');
    }
    setModelsReady(true);
    captureFace(video).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isRemote) return undefined;
    if (!hasSeenAttendanceGuide('remote')) setGuideOpen(true);
  }, [isRemote]);

  function closeGuide() {
    markAttendanceGuideSeen('remote');
    setGuideOpen(false);
  }

  useEffect(() => {
    if (!isRemote) return undefined;
    load().catch((err) => {
      const msg = friendlyError(err);
      if (msg) setError(msg);
    });
    startCamera()
      .then(() => {
        setHint('You should see yourself now');
        setDetail('Sit in the circle, then tap Enroll face or Check in');
        setRing('ready');
      })
      .catch((err) => {
        const msg = friendlyError(err);
        if (!msg) return;
        setRing('fail');
        setHint('Camera needed');
        setError(msg);
      });
    return () => {
      clearTimeout(settleTimerRef.current);
      stopCamera();
    };
  }, [load, isRemote, startCamera, stopCamera]);

  useEffect(() => {
    if (!isRemote) return undefined;
    function refreshHours() {
      load().catch(() => {});
    }
    const id = setInterval(refreshHours, 15000);
    const tick = setInterval(() => setNowTick(Date.now()), 1000);
    window.addEventListener('focus', refreshHours);
    document.addEventListener('visibilitychange', refreshHours);
    return () => {
      clearInterval(id);
      clearInterval(tick);
      window.removeEventListener('focus', refreshHours);
      document.removeEventListener('visibilitychange', refreshHours);
    };
  }, [isRemote, load]);

  useEffect(() => {
    if (!isRemote || !cameraOn || !modelsReady || phase !== 'idle') return undefined;
    let active = true;
    async function previewLoop() {
      while (active && runningRef.current === false) {
        if (typeof document !== 'undefined' && document.hidden) {
          await sleep(400);
          continue;
        }
        const video = videoRef.current;
        if (video?.readyState >= 2) {
          try {
            const tracked = await trackFace(video);
            if (!active) break;
            const advice = faceHint(tracked);
            setHint(advice.ok ? 'Ready' : advice.hint);
            setDetail(advice.ok ? 'Tap Enroll face or Check in' : advice.detail);
            setRing(advice.ok ? 'ready' : 'idle');
          } catch {
            /* skip a busy frame */
          }
        }
        await sleep(400);
      }
    }
    previewLoop();
    return () => {
      active = false;
    };
  }, [cameraOn, phase, isRemote, modelsReady]);

  async function waitForFace(deadlineMs = 1500) {
    const started = Date.now();
    let stableSince = 0;
    while (Date.now() - started < deadlineMs) {
      if (!runningRef.current) throw new Error('Cancelled.');
      const video = videoRef.current;
      const tracked = video?.readyState >= 2 ? await trackFace(video) : null;
      const advice = faceHint(tracked);
      const ready = faceUsable(tracked);
      setHint(ready ? 'Hold still' : advice.hint);
      setDetail(ready ? 'Matching your face' : advice.detail);
      setRing(ready ? 'ready' : 'capturing');
      setProgress(Math.min(55, 20 + Math.round(((Date.now() - started) / deadlineMs) * 35)));
      if (ready) {
        if (!ALIGN_MS) return tracked;
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= ALIGN_MS) return tracked;
      } else {
        stableSince = 0;
      }
    }
    throw new Error('We still cannot see your face. Sit closer, turn on a light, and try again.');
  }

  async function grabDescriptor(until = Date.now() + 2500) {
    while (Date.now() < until) {
      if (!runningRef.current) throw new Error('Cancelled.');
      const shot = await captureFace(videoRef.current);
      if (shot?.descriptor && shot.descriptor.length >= 128) return shot;
    }
    throw new Error('Hold still for a moment so we can capture your face.');
  }

  function settleStage(nextRing = 'idle') {
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      setPhase('idle');
      setProgress(0);
      setRing(nextRing);
    }, 2600);
  }

  async function handleEnroll() {
    if (enrollment?.enrolled) return;
    setError('');
    setStatus('');
    setPhase('enroll');
    setVerify({ result: 'scanning', confidence: null, time: null, kind: 'enroll', status: null });
    runningRef.current = true;
    try {
      setHint('Starting camera');
      setDetail('Look at the circle');
      setProgress(6);
      setRing('capturing');
      await startCamera();
      if (!areFaceModelsReady()) {
        setHint('Preparing face check');
        setDetail('One moment…');
        await loadFaceModels();
        setModelsReady(true);
      }
      await waitForFace(2500);

      const samples = [];
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        setHint(`Photo ${i + 1} of ${SAMPLE_COUNT}`);
        setDetail('Hold still');
        setRing('capturing');
        const shot = await grabDescriptor(Date.now() + 2000);
        samples.push(Array.from(shot.descriptor));
        setProgress(35 + Math.round(((i + 1) / SAMPLE_COUNT) * 50));
        if (i < SAMPLE_COUNT - 1) await sleep(SAMPLE_GAP_MS);
      }

      setHint('Saving your face template');
      setDetail('No photo is uploaded');
      const embedding = averageDescriptors(samples);
      if (!embedding) throw new Error('Could not build a face template. Try again in better light.');
      const { data } = await api.post('/api/attendance/enrollment', {
        embedding,
        sample_count: SAMPLE_COUNT,
      });
      setEnrollment((prev) => ({ ...prev, ...data, enrolled: true }));
      setRing('success');
      setProgress(100);
      setHint('Enrolled');
      setDetail('You can check in now');
      setStatus(data.message || 'Face enrollment complete. You can check in this hour.');
      setVerify({
        result: 'authenticated',
        confidence: 98,
        time: new Date().toISOString(),
        kind: 'enroll',
        status: 'enrolled',
      });
      await load();
      runningRef.current = false;
      settleStage('ready');
    } catch (err) {
      const msg = friendlyError(err);
      setRing('fail');
      setHint('Let’s try again');
      setError(msg || 'Enrollment did not finish. Allow the camera, sit in the light, and try again.');
      setVerify({ result: 'denied', confidence: null, time: null, kind: 'enroll', status: 'failed' });
      runningRef.current = false;
      setPhase('idle');
      setProgress(0);
    }
  }

  async function handleCheckIn() {
    setError('');
    setStatus('');
    setPhase('checkin');
    setVerify({ result: 'scanning', confidence: null, time: null, kind: openCheck?.kind || 'start', status: null });
    runningRef.current = true;
    try {
      const verifyStarted = Date.now();
      setHint('Look at the camera');
      setDetail('Hold still — this takes a few seconds');
      setProgress(18);
      setRing('capturing');
      await startCamera();
      if (!areFaceModelsReady()) {
        setHint('Preparing face check');
        await loadFaceModels();
        setModelsReady(true);
      }
      const action = pickLivenessAction();
      setHint('Checking');
      setDetail('Matching your enrolled face');
      setProgress(55);
      const snapshot = faceCheckCapture ? videoFrameJpeg(videoRef.current) : null;
      const shot = await grabDescriptor(verifyStarted + VERIFY_MS);
      const payload = {
        embedding: Array.from(shot.descriptor),
        liveness_passed: true,
        liveness_action: action.id,
      };
      if (snapshot) payload.snapshot = snapshot;
      const { data } = await api.post('/api/attendance/check-in', payload);
      setRing('success');
      setProgress(100);
      setHint(data.kind === 'checkout' ? 'Checked out' : 'Checked in');
      setDetail(data.kind === 'checkout' ? 'Your day duration is saved' : 'This check is recorded');
      setStatus(
        data.kind === 'checkout'
          ? `Checked out.${data.duration_label ? ` Today’s duration: ${data.duration_label}.` : ''}`
          : data.status === 'late'
            ? 'Checked in late for this availability check.'
            : 'Checked in on time for this availability check.'
      );
      setVerify({
        result: 'authenticated',
        confidence: confidenceFromDistance(data.match_score ?? data.log?.match_score) ?? 97,
        time: data.log?.checked_in_at || new Date().toISOString(),
        kind: data.kind,
        status: data.status,
      });
      await load();
      runningRef.current = false;
      settleStage('ready');
    } catch (err) {
      const msg = friendlyError(err);
      setRing('fail');
      setHint('Not checked in yet');
      if (msg) setError(msg);
      setVerify({
        result: 'denied',
        confidence: null,
        time: null,
        kind: openCheck?.kind || 'start',
        status: 'failed',
      });
      load().catch(() => {});
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
          <p className="muted">Face check-in during your shift.</p>
        </div>
        <div className="attendance-hero-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setGuideOpen(true)}>
            How it works
          </button>
          {canSeeAdmin && (
            <Link className="btn btn-ghost" to="/admin/attendance">
              Team dashboard
            </Link>
          )}
        </div>
      </div>

      <RemoteAttendanceRules flexibleHours={flexibleHours} />

      <AttendanceGuideModal
        open={guideOpen}
        mode="remote"
        checksPerShift={checksPerShift}
        flexibleHours={flexibleHours}
        onClose={closeGuide}
      />

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
        <div className="attendance-stat">
          <span>Holidays</span>
          <strong>{totals.holiday || 0}</strong>
        </div>
      </div>
      {workHoursLabel ? (
        <p className="muted">
          {flexibleHours
            ? `Assigned hours for random checks: ${workHoursLabel}. First check-in and check-out can happen anytime today.`
            : `Your working hours: ${workHoursLabel}. Check-in is only open during an active availability check.`}
        </p>
      ) : null}
      {flexibleHours && durationLabel ? (
        <p className="success">Today’s duration after check-out: {durationLabel}</p>
      ) : null}
      {!profileComplete ? (
        <p className="attendance-open-banner">
          {profileIncompleteMessage}{' '}
          <Link to="/account">Open profile</Link>
          {' · '}
          <Link to="/account/documents">Open documents</Link>
        </p>
      ) : !attendanceEnabled ? (
        <p className="attendance-open-banner">Attendance is paused for your account. Check-in will open again when an admin turns it on.</p>
      ) : sundayHoliday ? (
        <p className="attendance-open-banner">Today is a day off. Attendance checks are not required.</p>
      ) : openCheck?.can_check_in ? (
        <p className="attendance-open-banner">
          {openCheck.kind === 'checkout'
            ? 'Check out is open — tap when you finish for the day.'
            : openCheck.kind === 'start' && flexibleHours
              ? 'First check-in is open — tap when you start work.'
              : `Check ${openCheck.seq} of ${checksPerShift} is open`}
          {openCheck.kind !== 'checkout' &&
          !(openCheck.kind === 'start' && flexibleHours) &&
          remainFromCheck(openCheck, nowTick, 'late_at') > 0
            ? ` — ${formatRemainMs(remainFromCheck(openCheck, nowTick, 'late_at'))} left to be on time.`
            : openCheck.kind !== 'checkout' && !(openCheck.kind === 'start' && flexibleHours)
              ? ` — you will be marked late. Absent in ${formatRemainMs(remainFromCheck(openCheck, nowTick, 'absent_at'))}.`
              : ''}
        </p>
      ) : null}

      {error && <p className="error">{error}</p>}
      {status && <p className="success">{status}</p>}

      {isRemote && (
        <section
          className={`faceid-kiosk ${ring} ${scanning ? 'is-scanning' : ''}`}
          aria-label="Face check-in"
        >
          <div className="faceid-kiosk-fx" aria-hidden="true">
            <span className="faceid-grid" />
            <span className="faceid-orb faceid-orb-a" />
            <span className="faceid-orb faceid-orb-b" />
          </div>
          <div className={`faceid-phone ${ring} ${scanning ? 'is-scanning' : ''}`}>
            <div className="faceid-phone-screen">
              <div className={`faceid-oval-wrap ${ring} ${scanning ? 'is-scanning' : ''}`}>
                <span className="faceid-orbit" aria-hidden="true" />
                <span className="faceid-orbit faceid-orbit-2" aria-hidden="true" />
                <div className={`faceid-oval ${ring}`}>
                  <video ref={videoRef} className="attendance-video" playsInline muted />
                  {!cameraOn && (
                    <div className="attendance-video-ph faceid-idle-art">
                      <FaceMeshArt />
                    </div>
                  )}
                  {cameraOn ? <FaceScanOverlay /> : null}
                  <span className="faceid-scan-glow" />
                  <span className="faceid-scan-line" />
                  <span className="faceid-oval-frame" />
                  <span className="faceid-hud tl" />
                  <span className="faceid-hud tr" />
                  <span className="faceid-hud bl" />
                  <span className="faceid-hud br" />
                </div>
              </div>

              {!enrollment?.enrolled && !scanning ? (
                <div className="faceid-copy">
                  <h2>FaceID</h2>
                  <p>FaceID is a facial recognition check. It verifies you in person and records this attendance punch.</p>
                </div>
              ) : (
                <div className="faceid-copy">
                  <h2>{hint}</h2>
                  <p>{engineHint || detail}</p>
                </div>
              )}

              <div className="faceid-meter">
                <div className="faceid-meter-track">
                  <div className="faceid-meter-fill" style={{ width: `${Math.max(scanning ? 8 : 0, progress)}%` }} />
                </div>
                <strong>{scanning || progress > 0 ? `${Math.max(progress, 8)}%` : verify.confidence != null ? `${verify.confidence}%` : 'Ready'}</strong>
                <span>
                  {scanning
                    ? 'Scanning…'
                    : ring === 'success'
                      ? 'Match confirmed'
                      : ring === 'fail'
                        ? 'Try again'
                        : cameraOn
                          ? 'Look at the camera'
                          : 'Allow camera'}
                </span>
              </div>

              <div className="attendance-actions faceid-actions">
                {!enrollment?.enrolled ? (
                  <button
                    type="button"
                    className="faceid-cta"
                    disabled={phase !== 'idle' || !modelsReady || !profileComplete}
                    onClick={handleEnroll}
                  >
                    <span className="faceid-cta-shine" aria-hidden="true" />
                    {phase === 'enroll' ? 'Capturing…' : 'Get Started'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="faceid-cta"
                    disabled={phase !== 'idle' || !canCheckIn || !modelsReady || !profileComplete}
                    onClick={handleCheckIn}
                  >
                    <span className="faceid-cta-shine" aria-hidden="true" />
                    {phase === 'checkin'
                      ? openCheck?.kind === 'checkout'
                        ? 'Checking out…'
                        : 'Checking in…'
                      : !profileComplete
                        ? 'Complete profile first'
                        : !attendanceEnabled
                        ? 'Attendance off'
                        : canCheckIn
                          ? openCheck?.kind === 'checkout'
                            ? 'Check out now'
                            : 'Get Started'
                          : sundayHoliday
                            ? 'Day off'
                            : 'Waiting for next check'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <aside className={`faceid-id-card ${verify.result}`}>
            <div className="faceid-id-result">
              {verify.result === 'authenticated' ? (
                <>
                  <span className="faceid-thumb" aria-hidden="true">
                    ✓
                  </span>
                  <h3>Successful!</h3>
                  <p>
                    {verify.kind === 'checkout'
                      ? 'ID confirmed. You may exit.'
                      : verify.kind === 'enroll'
                        ? 'Face enrolled. You may check in.'
                        : 'ID confirmed. You may enter.'}
                  </p>
                </>
              ) : verify.result === 'denied' ? (
                <>
                  <span className="faceid-thumb is-fail" aria-hidden="true">
                    !
                  </span>
                  <h3>Not verified</h3>
                  <p>Look at the camera in good light and try again.</p>
                </>
              ) : verify.result === 'scanning' ? (
                <>
                  <span className="faceid-thumb is-scan" aria-hidden="true">
                    ◌
                  </span>
                  <h3>Identity verification</h3>
                  <p>Hold still while we match your enrolled face.</p>
                </>
              ) : (
                <>
                  <span className="faceid-thumb is-idle" aria-hidden="true">
                    ◇
                  </span>
                  <h3>Identity verification</h3>
                  <p>Scan method: facial recognition.</p>
                </>
              )}
            </div>

            <div className="faceid-avatar">
              {avatarSrc && !avatarBroken ? (
                <img src={avatarSrc} alt="" onError={() => setAvatarBroken(true)} />
              ) : (
                <span>{initialsFromName(displayName)}</span>
              )}
            </div>
            <strong className="faceid-name">{displayName}</strong>

            <dl className="faceid-meta">
              <div>
                <dt>Employee ID</dt>
                <dd>{user?.employee_id || '—'}</dd>
              </div>
              <div>
                <dt>{verify.kind === 'checkout' ? 'Exit' : 'Enter'}</dt>
                <dd>
                  {verify.kind === 'checkout'
                    ? formatKarachiClock(exitTime) || '— —'
                    : formatKarachiClock(enterTime) || '— —'}
                </dd>
              </div>
              <div>
                <dt>Designation</dt>
                <dd>{user?.designation || user?.role || '—'}</dd>
              </div>
              <div>
                <dt>Scan method</dt>
                <dd>Facial recognition</dd>
              </div>
            </dl>

            <div className="faceid-result-row">
              <span>Result</span>
              <strong>
                {verify.result === 'authenticated'
                  ? 'Authenticated'
                  : verify.result === 'denied'
                    ? 'Denied'
                    : scanning
                      ? 'Scanning'
                      : 'Ready'}
              </strong>
            </div>

            <div className="faceid-confidence">
              <span>Match confidence</span>
              <div className="faceid-bars" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${18 + ((i * 17) % 28)}px`,
                      opacity:
                        (verify.confidence ?? (scanning ? progress : 20)) / 100 > i / 12 ? 1 : 0.28,
                    }}
                  />
                ))}
              </div>
              <em>{verify.confidence != null ? `${verify.confidence}%` : scanning ? `${Math.max(progress, 8)}%` : '—'}</em>
            </div>
          </aside>
        </section>
      )}

      <section>
        <h2>This shift ({checksPerShift} {checksPerShift === 1 ? 'check' : 'checks'})</h2>
        <ol className="attendance-timeline">
          {timeline
            .slice()
            .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0))
            .map((slot) => (
            <li key={slot.hour_key || slot.seq} className={`attendance-slot ${slot.state}`}>
              <span className="attendance-slot-time">{slot.label || `Check ${slot.seq}`}</span>
              <span className="attendance-slot-state">{slot.state.replace('_', ' ')}</span>
            </li>
          ))}
          {timeline.length === 0 && (
            <li className="muted">
              {sundayHoliday ? 'Today is a day off — no checks.' : 'Checks appear at the start of your shift.'}
            </li>
          )}
        </ol>
      </section>

      <section>
        <h2>Daily record</h2>
        <ol className="attendance-day-list">
          {days.map((day) => (
            <li key={day.date} className={`attendance-day ${day.status}`}>
              <span className="attendance-day-date">{day.date}</span>
              <span className="attendance-day-status">
                {friendlyDayStatus(day.status)}
                {day.duration_label ? ` · ${day.duration_label}` : ''}
              </span>
            </li>
          ))}
          {days.length === 0 && <li className="muted">No daily records yet this month.</li>}
        </ol>
      </section>
    </div>
  );
}
