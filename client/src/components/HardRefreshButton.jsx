import { useState } from 'react';
import { hardEmptyCacheAndReload } from '../pwaUpdate';
import './HardRefreshButton.css';

export default function HardRefreshButton({ compact = false, block = false }) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    await hardEmptyCacheAndReload();
  }

  return (
    <button
      type="button"
      className={`btn btn-ghost hard-refresh-btn${block ? ' hard-refresh-btn-block' : ''}`}
      onClick={handleClick}
      disabled={busy}
      title="Empty cache and load the latest app"
    >
      {busy ? 'Refreshing…' : compact ? 'Refresh' : 'Refresh app'}
    </button>
  );
}
