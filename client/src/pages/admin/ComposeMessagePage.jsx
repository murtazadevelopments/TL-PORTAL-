import { useState } from 'react';
import { useNavigate } from 'react-router';
import ComposeMessageModal from '../../components/ComposeMessageModal';
import '../admin/AdminDashboard.css';

/**
 * Standalone compose entry under Administration.
 * Opens the same modal used from the employees table.
 */
export default function ComposeMessagePage() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  return (
    <div className="admin-page page-panel">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Compose message</h1>
          <p className="muted" style={{ margin: 0 }}>
            Send a portal and/or email message to an employee
          </p>
        </div>
      </div>

      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}

      <p className="muted">
        Use the compose dialog to pick a recipient and delivery method. You can also
        message someone directly from <strong>All Employees</strong>.
      </p>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          setSuccess('');
          setError('');
          setOpen(true);
        }}
      >
        Open composer
      </button>

      <ComposeMessageModal
        open={open}
        onClose={() => {
          setOpen(false);
          if (!success) navigate('/admin/employees');
        }}
        onSuccess={(payload) => {
          const warn = payload?.emailError ? ` (${payload.emailError})` : '';
          setSuccess((payload?.message || 'Message sent.') + warn);
          setError('');
        }}
      />
    </div>
  );
}
