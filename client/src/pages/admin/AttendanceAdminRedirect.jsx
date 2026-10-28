import { Navigate } from 'react-router';
import { useAuthUser } from '../../context/AuthUserContext';
import {
  canViewOnsiteTeamAttendance,
  canViewRemoteTeamAttendance,
} from '../../utils/permissions';

/** Sends /admin/attendance to the right page based on permissions. */
export default function AttendanceAdminRedirect() {
  const { user, permissions, loading } = useAuthUser();
  if (loading) return null;
  if (canViewOnsiteTeamAttendance(user?.role, permissions)) {
    return <Navigate to="/admin/attendance/onsite" replace />;
  }
  if (canViewRemoteTeamAttendance(user?.role, permissions)) {
    return <Navigate to="/admin/attendance/remote" replace />;
  }
  return <Navigate to="/admin/attendance/onsite" replace />;
}
