import { useNavigate } from 'react-router-dom';
import RoleLoginForm from '../components/RoleLoginForm';
import { useAuth } from '../contexts/AuthContext';

function AdminLogin() {
  const navigate = useNavigate();
  const { loginAdmin } = useAuth();

  return (
    <RoleLoginForm
      brandLabel="E-PROC TENANT"
      heroTitle="Assessment operations for your organization."
      heroDescription="Manage question banks, exams, users, results, and tenant-owned operational logs."
      features={['Tenant-scoped data', 'Role-based administration', 'Isolated operational logs']}
      accessLabel="TENANT ADMIN ACCESS"
      title="Tenant sign in"
      subtitle="Use an admin account assigned to the tenant served by this application."
      submitLabel="Sign in to tenant"
      alternatePrompt="Manage all customer tenants?"
      alternateLabel="Open tenant control login"
      alternatePath="/tenant/login"
      onLogin={async (username, password) => {
        await loginAdmin(username, password);
        navigate('/admin/dashboard', { replace: true });
      }}
    />
  );
}

export default AdminLogin;
