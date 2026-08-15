import InstallAppButton from '../components/InstallAppButton';

export default function SettingsPage() {
  return (
    <div className="card wide page-panel">
      <h1>Settings</h1>
      <p className="muted">App preferences for this device</p>

      <section style={{ marginTop: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem' }}>Install App</h2>
        <p className="muted">
          Add Textured Lab Portal to your home screen for faster access (PWA).
        </p>
        <InstallAppButton />
      </section>
    </div>
  );
}
