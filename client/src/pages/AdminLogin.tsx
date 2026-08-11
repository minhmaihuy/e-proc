import { useNavigate } from 'react-router-dom';
import RoleLoginForm from '../components/RoleLoginForm';
import { useAuth } from '../contexts/AuthContext';

function AdminLogin() {
  const navigate = useNavigate();
  const { loginAdmin } = useAuth();

  return (
    <RoleLoginForm
      theme="tenant"
      brandLabel="E-PROC TENANT WORKSPACE"
      heroTitle="Run secure assessments from one focused workspace."
      heroDescription="Manage question banks, exam batches, grading, evidence and tenant users without crossing into global infrastructure."
      features={['Question banks & batches', 'Results & evidence', 'Tenant-scoped access']}
      accessLabel="TENANT ADMIN ACCESS"
      title="Sign in to your workspace"
      subtitle="Use your tenant administrator or assessment administrator account."
      submitLabel="Continue to dashboard"
      alternatePrompt="Manage tenant infrastructure?"
      alternateLabel="Open the control plane"
      alternatePath="/tenant/login"
      onLogin={async (username, password) => {
        await loginAdmin(username, password);
        navigate('/admin/dashboard', { replace: true });
      }}
    />
  );
}

export default AdminLogin;
