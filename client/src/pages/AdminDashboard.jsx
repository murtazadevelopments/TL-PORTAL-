import { Navigate } from 'react-router';

/** @deprecated Use /admin/employees under AppShell */
export default function AdminDashboard() {
  return <Navigate to="/admin/employees" replace />;
}
