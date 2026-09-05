import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import PrivateRoute from './components/PrivateRoute';
import ErrorBoundary from './components/ErrorBoundary';
import RouteFallback from './components/RouteFallback';

// Tách chunk theo route. Trước đây mọi trang đều import tĩnh nên thí sinh vào thi phải
// tải cả code quản trị (BatchManagement, TenantManagement, Results, QuestionBank...)
// trong một bundle ~1MB — hoàn toàn lãng phí trên máy và mạng của phòng thi.
// Mỗi trang giờ là một chunk riêng, chỉ tải khi thực sự điều hướng tới.
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const TenantLogin = lazy(() => import('./pages/TenantLogin'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const QuestionBank = lazy(() => import('./pages/QuestionBank'));
const BatchManagement = lazy(() => import('./pages/BatchManagement'));
const StudentManagement = lazy(() => import('./pages/StudentManagement'));
const Results = lazy(() => import('./pages/Results'));
const AISettings = lazy(() => import('./pages/AISettings'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const PracticeManagement = lazy(() => import('./pages/PracticeManagement'));
const StudentLogin = lazy(() => import('./pages/StudentLogin'));
const StudentExam = lazy(() => import('./pages/StudentExam'));
const StudentPractice = lazy(() => import('./pages/StudentPractice'));
const StudentConfirm = lazy(() => import('./pages/StudentConfirm'));
const StudentSubmit = lazy(() => import('./pages/StudentSubmit'));
const TenantManagement = lazy(() => import('./pages/TenantManagement'));
const IssueLogs = lazy(() => import('./pages/IssueLogs'));
const LiveMonitor = lazy(() => import('./pages/LiveMonitor'));

function App() {
  return (
    <AuthProvider>
      {/* Boundary bao ngoài cùng: lỗi render ở bất kỳ trang nào cũng hiện thông báo
          kèm nút tải lại, thay vì để trắng màn hình không giải thích. */}
      <ErrorBoundary area="ứng dụng">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Student routes */}
            <Route path="/" element={<StudentLogin />} />
            <Route path="/confirm" element={<StudentConfirm />} />
            {/* Bài thi có boundary riêng để trấn an rằng bài làm vẫn nằm trên máy chủ. */}
            <Route
              path="/exam"
              element={
                <ErrorBoundary area="trang làm bài" reassureSavedWork>
                  <StudentExam />
                </ErrorBoundary>
              }
            />
            <Route
              path="/practice"
              element={
                <ErrorBoundary area="trang làm bài" reassureSavedWork>
                  <StudentPractice />
                </ErrorBoundary>
              }
            />
            <Route path="/submit" element={<StudentSubmit />} />

            {/* Authentication surfaces are separated by ownership plane. */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/tenant/login" element={<TenantLogin />} />
            <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
            <Route path="/tenant" element={<Navigate to="/tenant/login" replace />} />

            {/* Admin protected routes */}
            <Route path="/admin/dashboard" element={<PrivateRoute requirePlatformAdmin><AdminDashboard /></PrivateRoute>} />
            <Route path="/admin/questions" element={<PrivateRoute requirePlatformAdmin><QuestionBank /></PrivateRoute>} />
            <Route path="/admin/batches" element={<PrivateRoute requirePlatformAdmin><BatchManagement /></PrivateRoute>} />
            <Route path="/admin/batches/:id/students" element={<PrivateRoute requirePlatformAdmin><StudentManagement /></PrivateRoute>} />
            <Route path="/admin/batches/:id/results" element={<PrivateRoute requirePlatformAdmin><Results /></PrivateRoute>} />
            <Route path="/admin/batches/:id/live" element={<PrivateRoute requireTenantAdmin><LiveMonitor /></PrivateRoute>} />
            <Route path="/admin/settings" element={<PrivateRoute requirePlatformAdmin><AISettings /></PrivateRoute>} />
            <Route path="/admin/practice" element={<PrivateRoute requirePlatformAdmin><PracticeManagement /></PrivateRoute>} />
            <Route path="/admin/issues" element={<PrivateRoute requirePlatformAdmin><IssueLogs /></PrivateRoute>} />
            <Route path="/admin/users" element={<PrivateRoute requireUserManager><UserManagement /></PrivateRoute>} />
            <Route path="/tenants" element={<PrivateRoute requireSuperAdmin><TenantManagement /></PrivateRoute>} />
            {/* Secrets Manager sống trong trang quản lý tenant; giữ đường cũ để bookmark không 404. */}
            <Route path="/secrets" element={<Navigate to="/tenants" replace />} />
            <Route path="/admin/tenants" element={<Navigate to="/tenants" replace />} />
            <Route path="/admin/tenant" element={<Navigate to="/admin/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  );
}

export default App;
