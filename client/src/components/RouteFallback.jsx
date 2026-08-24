export default function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <div className="spinner" />
      <span>Loading…</span>
    </div>
  );
}
