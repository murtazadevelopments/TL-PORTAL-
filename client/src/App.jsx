import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import ProtectedRoute from './components/ProtectedRoute';
import InactivityGuard from './components/InactivityGuard';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ForgotUsername from './pages/ForgotUsername';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import LoginLogs from './pages/LoginLogs';
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
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/login-logs"
            element={
              <ProtectedRoute>
                <LoginLogs />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </InactivityGuard>
    </BrowserRouter>
  );
}

export default App;
