import { Routes, Route } from 'react-router-dom';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import QuestionBank from './pages/QuestionBank';
import BatchManagement from './pages/BatchManagement';
import StudentManagement from './pages/StudentManagement';
import Results from './pages/Results';
import AISettings from './pages/AISettings';
import StudentLogin from './pages/StudentLogin';
import StudentExam from './pages/StudentExam';
import StudentConfirm from './pages/StudentConfirm';
import StudentSubmit from './pages/StudentSubmit';

function App() {
  return (
    <Routes>
      <Route path="/" element={<StudentLogin />} />
      <Route path="/confirm" element={<StudentConfirm />} />
      <Route path="/exam" element={<StudentExam />} />
      <Route path="/submit" element={<StudentSubmit />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
      <Route path="/admin/questions" element={<QuestionBank />} />
      <Route path="/admin/batches" element={<BatchManagement />} />
      <Route path="/admin/batches/:id/students" element={<StudentManagement />} />
      <Route path="/admin/batches/:id/results" element={<Results />} />
      <Route path="/admin/settings" element={<AISettings />} />
    </Routes>
  );
}

export default App;
