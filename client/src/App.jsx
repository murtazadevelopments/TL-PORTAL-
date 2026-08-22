import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ProtectedRoute from './components/ProtectedRoute';
import InactivityGuard from './components/InactivityGuard';
import AppShell from './layouts/AppShell';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ForgotUsername from './pages/ForgotUsername';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import DashboardHome from './pages/DashboardHome';
import AccountProfile from './pages/account/AccountProfile';
import AccountDocuments from './pages/account/AccountDocuments';
import AccountSecurity from './pages/account/AccountSecurity';
import EmployeesPage from './pages/admin/EmployeesPage';
import LockedAccountsPage from './pages/admin/LockedAccountsPage';
import DeactivatedEmployeesPage from './pages/admin/DeactivatedEmployeesPage';
import RolesPage from './pages/admin/RolesPage';
import TeamsPage from './pages/admin/TeamsPage';
import BranchesPage from './pages/admin/BranchesPage';
import NotificationSettingsPage from './pages/admin/NotificationSettingsPage';
import LoginLogs from './pages/LoginLogs';
import SettingsPage from './pages/SettingsPage';
import TeamLeaderDashboard from './pages/team-leader/TeamLeaderDashboard';
import MessagesInbox from './pages/account/MessagesInbox';
import ComposeMessagePage from './pages/admin/ComposeMessagePage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <InactivityGuard>
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
            <Route path="/team-leader" element={<TeamLeaderDashboard />} />
            <Route path="/account" element={<AccountProfile />} />
            <Route path="/account/documents" element={<AccountDocuments />} />
            <Route path="/account/messages" element={<MessagesInbox />} />
            <Route path="/account/security" element={<AccountSecurity />} />
            <Route path="/admin" element={<Navigate to="/admin/employees" replace />} />
            <Route path="/admin/employees" element={<EmployeesPage />} />
            <Route path="/admin/messages" element={<ComposeMessagePage />} />
            <Route path="/admin/locked" element={<LockedAccountsPage />} />
            <Route path="/admin/deactivated" element={<DeactivatedEmployeesPage />} />
            <Route path="/admin/roles" element={<RolesPage />} />
            <Route path="/admin/teams" element={<TeamsPage />} />
            <Route path="/admin/branches" element={<BranchesPage />} />
            <Route path="/admin/notifications" element={<NotificationSettingsPage />} />
            <Route path="/admin/login-logs" element={<LoginLogs />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </InactivityGuard>
    </BrowserRouter>
  );
}

export default App;
