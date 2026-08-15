import { Navigate } from 'react-router';

/** @deprecated Use account routes under AppShell */
export default function Dashboard() {
  return <Navigate to="/dashboard" replace />;
}
