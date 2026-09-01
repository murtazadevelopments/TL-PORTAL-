import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import api from '../../api/client';
import { useInactivityGuard } from '../../components/InactivityGuard';
import { useAuthUser } from '../../context/AuthUserContext';
import { missingEmployeePortalFields } from '../../utils/profileCompleteness';

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
  const missingFileDocs = missingDocFields
    .filter((field) => field.key !== 'profile_picture_url')
    .map((field) => field.label);
  const missingPhoto = missingDocFields.some((field) => field.key === 'profile_picture_url');

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
        Upload or replace your CNIC images and CV. Downloads of these files are restricted for
        security.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {docError && <p className="error">{docError}</p>}
      {docSuccess && <p className="success">{docSuccess}</p>}

      {!loading && profile && (missingFileDocs.length > 0 || missingPhoto) && (
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
              <span>{profile.cnic_front_url ? 'On file' : 'No CNIC front'}</span>
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
              <button
                type="button"
                className="btn btn-ghost"
                disabled={Boolean(docUploading)}
                onClick={() => cnicFrontInputRef.current?.click()}
              >
                {docUploading === 'cnic_front'
                  ? 'Uploading…'
                  : profile.cnic_front_url
                    ? 'Change'
                    : 'Upload'}
              </button>
            </div>

            <div className="doc-card doc-card-static">
              <span>{profile.cnic_back_url ? 'On file' : 'No CNIC back'}</span>
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
              <button
                type="button"
                className="btn btn-ghost"
                disabled={Boolean(docUploading)}
                onClick={() => cnicBackInputRef.current?.click()}
              >
                {docUploading === 'cnic_back'
                  ? 'Uploading…'
                  : profile.cnic_back_url
                    ? 'Change'
                    : 'Upload'}
              </button>
            </div>

            <div className="doc-card doc-card-static">
              <span className="pdf-badge">{profile.cv_url ? 'On file' : 'No CV'}</span>
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
              <button
                type="button"
                className="btn btn-ghost"
                disabled={Boolean(docUploading)}
                onClick={() => cvInputRef.current?.click()}
              >
                {docUploading === 'cv' ? 'Uploading…' : profile.cv_url ? 'Change' : 'Upload'}
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
