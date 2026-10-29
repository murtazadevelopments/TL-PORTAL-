import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import api from '../../api/client';
import CnicProtectedViewer from '../../components/CnicProtectedViewer';
import EmploymentFormViewer from '../../components/EmploymentFormViewer';
import { useInactivityGuard } from '../../components/InactivityGuard';
import { useAuthUser } from '../../context/AuthUserContext';
import { missingEmployeePortalFields, isProfileIncompleteLocked } from '../../utils/profileCompleteness';
import '../../components/ProfileIncompleteLock.css';

function hasDoc(profile, urlKey, onFileKey) {
  if (!profile) return false;
  if (typeof profile[onFileKey] === 'boolean') return profile[onFileKey];
  return Boolean(profile[urlKey]);
}

export default function AccountDocuments() {
  const navigate = useNavigate();
  const { setBusy } = useInactivityGuard();
  const { refreshUser } = useAuthUser();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [docUploading, setDocUploading] = useState('');
  const [docError, setDocError] = useState('');
  const [docSuccess, setDocSuccess] = useState('');
  const [cnicView, setCnicView] = useState(null);
  const [cvViewOpen, setCvViewOpen] = useState(false);
  const cnicFrontInputRef = useRef(null);
  const cnicBackInputRef = useRef(null);
  const cvInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await api.get('/api/users/me');
        if (active) setProfile(data);
      } catch (err) {
        if (!active) return;
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/');
          return;
        }
        setError(err.response?.data?.message || 'Failed to load profile.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [navigate]);

  const missingDocFields = useMemo(
    () => (profile ? missingEmployeePortalFields(profile).filter((field) => field.document) : []),
    [profile]
  );
  const locked = isProfileIncompleteLocked(profile);
  const missingFileDocs = missingDocFields
    .filter((field) => field.key !== 'profile_picture_url')
    .map((field) => field.label);
  const missingPhoto = missingDocFields.some((field) => field.key === 'profile_picture_url');
  const hasCnicFront = hasDoc(profile, 'cnic_front_url', 'cnic_front_on_file');
  const hasCnicBack = hasDoc(profile, 'cnic_back_url', 'cnic_back_on_file');
  const hasCv = hasDoc(profile, 'cv_url', 'cv_on_file');
  const cvSrc = profile?.cv_url || (profile?.id ? `/api/documents/${profile.id}/cv` : null);

  async function handleDocumentUpload(field, file) {
    if (!file) return;
    setDocError('');
    setDocSuccess('');
    setDocUploading(field);
    setBusy(true);
    try {
      const body = new FormData();
      body.append(field, file);
      const { data } = await api.put('/api/users/me/documents', body);
      setProfile(data.user || data);
      const next = data.user || data;
      if (locked && missingEmployeePortalFields(next).length === 0) {
        await refreshUser();
        navigate('/dashboard');
        return;
      }
      refreshUser();
      setDocSuccess(
        field === 'cv'
          ? 'CV updated.'
          : field === 'cnic_front'
            ? 'CNIC front updated.'
            : 'CNIC back updated.'
      );
    } catch (err) {
      setDocError(err.response?.data?.message || 'Failed to upload document.');
    } finally {
      setDocUploading('');
      setBusy(false);
    }
  }

  return (
    <main className="card wide page-panel">
      <h1>My Documents</h1>
      <p className="muted">
        Upload, replace, or view your CNIC images and CV. Downloads of these files are restricted for
        security.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {docError && <p className="error">{docError}</p>}
      {docSuccess && <p className="success">{docSuccess}</p>}

      {!loading && profile && locked && (
        <div className="profile-lock-banner" role="alert">
          <strong>Dashboard locked until missing employee documents are uploaded.</strong>
          <p className="muted">
            You can upload or replace any of your documents below. Admin-assigned fields are not
            required.
          </p>
        </div>
      )}

      {!loading && profile && !locked && (missingFileDocs.length > 0 || missingPhoto) && (
        <div className="alert-banner" role="status">
          <div>
            <strong>Your profile is incomplete.</strong>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              {missingFileDocs.length > 0 ? `Please upload: ${missingFileDocs.join(', ')}.` : ''}
              {missingPhoto
                ? `${missingFileDocs.length ? ' ' : ''}Add your profile photo on the Profile page.`
                : ''}
            </p>
          </div>
          {missingPhoto && (
            <div className="alert-actions">
              <Link to="/account" className="btn btn-ghost">
                Profile photo
              </Link>
            </div>
          )}
        </div>
      )}

      {!loading && profile && (
        <section className="docs">
          <div className="doc-grid">
            <div className="doc-card doc-card-static">
              <span>{hasCnicFront ? 'On file' : 'No CNIC front'}</span>
              <span>CNIC front</span>
              <input
                ref={cnicFrontInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  handleDocumentUpload('cnic_front', file);
                }}
              />
              <div className="doc-card-actions">
                {hasCnicFront && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() =>
                      setCnicView({
                        docType: 'cnic_front',
                        title: 'CNIC front',
                      })
                    }
                  >
                    View
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={Boolean(docUploading)}
                  onClick={() => cnicFrontInputRef.current?.click()}
                >
                  {docUploading === 'cnic_front'
                    ? 'Uploading…'
                    : hasCnicFront
                      ? 'Change'
                      : 'Upload'}
                </button>
              </div>
            </div>

            <div className="doc-card doc-card-static">
              <span>{hasCnicBack ? 'On file' : 'No CNIC back'}</span>
              <span>CNIC back</span>
              <input
                ref={cnicBackInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  handleDocumentUpload('cnic_back', file);
                }}
              />
              <div className="doc-card-actions">
                {hasCnicBack && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() =>
                      setCnicView({
                        docType: 'cnic_back',
                        title: 'CNIC back',
                      })
                    }
                  >
                    View
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={Boolean(docUploading)}
                  onClick={() => cnicBackInputRef.current?.click()}
                >
                  {docUploading === 'cnic_back'
                    ? 'Uploading…'
                    : hasCnicBack
                      ? 'Change'
                      : 'Upload'}
                </button>
              </div>
            </div>

            <div className="doc-card doc-card-static">
              <span className="pdf-badge">{hasCv ? 'On file' : 'No CV'}</span>
              <span>CV</span>
              <input
                ref={cvInputRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  handleDocumentUpload('cv', file);
                }}
              />
              <div className="doc-card-actions">
                {hasCv && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={Boolean(docUploading)}
                    onClick={() => setCvViewOpen(true)}
                  >
                    View
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={Boolean(docUploading)}
                  onClick={() => cvInputRef.current?.click()}
                >
                  {docUploading === 'cv' ? 'Uploading…' : hasCv ? 'Change' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
          {locked && missingPhoto && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              Add your profile photo on the <Link to="/account">Profile</Link> page.
            </p>
          )}
        </section>
      )}

      <CnicProtectedViewer
        open={Boolean(cnicView) && Boolean(profile?.id)}
        userId={profile?.id}
        docType={cnicView?.docType}
        title={cnicView?.title}
        viewerLabel={profile?.username || profile?.name || 'employee'}
        subjectLabel={profile?.name}
        onClose={() => setCnicView(null)}
      />

      <EmploymentFormViewer
        open={cvViewOpen && hasCv && Boolean(cvSrc)}
        src={cvSrc}
        title={`${profile?.name || 'My'} — CV`}
        onClose={() => setCvViewOpen(false)}
      />
    </main>
  );
}
