import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import api from '../../api/client';
import '../admin/AdminDashboard.css';
import './MessagesInbox.css';

function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function snippet(text, max = 110) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export default function MessagesInbox({ onUnreadChange }) {
  const navigate = useNavigate();
  const outlet = useOutletContext() || {};
  const notifyUnread = onUnreadChange || outlet.refreshUnreadMessages;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/messages', {
        params: { limit: 50, offset: 0 },
      });
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (err) {
      if (err.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/', { replace: true });
        return;
      }
      setError(err.response?.data?.message || 'Failed to load messages.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  async function openMessage(msg) {
    setSelected(msg);
    if (msg.read_at) return;
    setMarking(true);
    try {
      const { data } = await api.patch(`/api/messages/${msg.id}/read`);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.id ? { ...m, read_at: data.read_at || new Date().toISOString() } : m
        )
      );
      setSelected((prev) =>
        prev && prev.id === msg.id
          ? { ...prev, read_at: data.read_at || new Date().toISOString() }
          : prev
      );
      onUnreadChange?.();
      notifyUnread?.();
    } catch {
      /* keep open even if mark-read fails */
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="admin-page page-panel messages-inbox">
      <div className="admin-toolbar" style={{ marginTop: 0 }}>
        <div>
          <h1>Messages</h1>
          <p className="muted" style={{ margin: 0 }}>
            Messages from admins and leadership
          </p>
        </div>
        <button type="button" className="btn btn-ghost" disabled={loading} onClick={load}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading && messages.length === 0 && (
        <div className="admin-loading">
          <div className="spinner" />
          Loading messages…
        </div>
      )}

      {!loading && messages.length === 0 && !error && (
        <div className="admin-empty">No messages yet.</div>
      )}

      {messages.length > 0 && (
        <ul className="msg-list">
          {messages.map((msg) => {
            const unread = !msg.read_at;
            return (
              <li key={msg.id}>
                <button
                  type="button"
                  className={`msg-row${unread ? ' is-unread' : ''}`}
                  onClick={() => openMessage(msg)}
                >
                  <span className="msg-dot" aria-hidden="true" />
                  <span className="msg-main">
                    <span className="msg-top">
                      <span className="msg-sender">
                        {msg.sender_name || msg.sender_username || 'HR'}
                      </span>
                      <span className="msg-time">{relativeTime(msg.created_at)}</span>
                    </span>
                    <span className="msg-subject">
                      {msg.subject || '(No subject)'}
                    </span>
                    <span className="msg-snippet">{snippet(msg.body)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            className="modal-panel msg-detail-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2>{selected.subject || '(No subject)'}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  From {selected.sender_name || selected.sender_username || 'HR'} ·{' '}
                  {new Date(selected.created_at).toLocaleString()}
                  {marking ? ' · marking read…' : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
            <div className="msg-body">{selected.body}</div>
          </div>
        </div>
      )}
    </div>
  );
}
