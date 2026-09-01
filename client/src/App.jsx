import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ProtectedRoute from './components/ProtectedRoute';
import InactivityGuard from './components/InactivityGuard';
import RouteFallback from './components/RouteFallback';
import AppShell from './layouts/AppShell';
import SignIn from './pages/SignIn';
import './App.css';

const SignUp = lazy(() => import('./pages/SignUp'));
const ForgotUsername = lazy(() => import('./pages/ForgotUsername'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const AccountProfile = lazy(() => import('./pages/account/AccountProfile'));
const AccountDocuments = lazy(() => import('./pages/account/AccountDocuments'));
const AccountSecurity = lazy(() => import('./pages/account/AccountSecurity'));
const EmployeesPage = lazy(() => import('./pages/admin/EmployeesPage'));
const LockedAccountsPage = lazy(() => import('./pages/admin/LockedAccountsPage'));
const DeactivatedEmployeesPage = lazy(() => import('./pages/admin/DeactivatedEmployeesPage'));
const RolesPage = lazy(() => import('./pages/admin/RolesPage'));
const TeamsPage = lazy(() => import('./pages/admin/TeamsPage'));
const BranchesPage = lazy(() => import('./pages/admin/BranchesPage'));
const ShiftsPage = lazy(() => import('./pages/admin/ShiftsPage'));
const NotificationSettingsPage = lazy(() => import('./pages/admin/NotificationSettingsPage'));
const LoginLogs = lazy(() => import('./pages/LoginLogs'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TeamLeaderDashboard = lazy(() => import('./pages/team-leader/TeamLeaderDashboard'));
const MessagesInbox = lazy(() => import('./pages/account/MessagesInbox'));
const ComposeMessagePage = lazy(() => import('./pages/admin/ComposeMessagePage'));
const AttendancePage = lazy(() => import('./pages/attendance/AttendancePage'));
const AttendanceAdminPage = lazy(() => import('./pages/admin/AttendanceAdminPage'));

function App() {
  return (
    <BrowserRouter>
      <InactivityGuard>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/forgot-username" element={<ForgotUsername />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardHome />} />
              <Route path="/attendance" element={<AttendancePage />} />
              <Route path="/team-leader" element={<TeamLeaderDashboard />} />
              <Route path="/account" element={<AccountProfile />} />
              <Route path="/account/documents" element={<AccountDocuments />} />
              <Route path="/account/messages" element={<MessagesInbox />} />
              <Route path="/account/security" element={<AccountSecurity />} />
              <Route path="/admin" element={<Navigate to="/admin/employees" replace />} />
              <Route path="/admin/employees" element={<EmployeesPage />} />
              <Route path="/admin/attendance" element={<AttendanceAdminPage />} />
              <Route path="/admin/messages" element={<ComposeMessagePage />} />
              <Route path="/admin/locked" element={<LockedAccountsPage />} />
              <Route path="/admin/deactivated" element={<DeactivatedEmployeesPage />} />
              <Route path="/admin/roles" element={<RolesPage />} />
              <Route path="/admin/teams" element={<TeamsPage />} />
              <Route path="/admin/branches" element={<BranchesPage />} />
              <Route path="/admin/shifts" element={<ShiftsPage />} />
              <Route path="/admin/notifications" element={<NotificationSettingsPage />} />
              <Route path="/admin/login-logs" element={<LoginLogs />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </InactivityGuard>
    </BrowserRouter>
  );
}

export default App;
