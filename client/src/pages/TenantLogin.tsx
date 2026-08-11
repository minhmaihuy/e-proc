import { useNavigate } from 'react-router-dom';
import RoleLoginForm from '../components/RoleLoginForm';
import { useAuth } from '../contexts/AuthContext';

function TenantLogin() {
  const navigate = useNavigate();
  const { loginTenantControl } = useAuth();

  return (
    <RoleLoginForm
      theme="control"
      brandLabel="E-PROC CONTROL PLANE"
      heroTitle="One control plane for every customer environment."
      heroDescription="Approve tenants and coordinate isolated Terraform infrastructure without entering tenant assessment data."
      features={['Tenant onboarding', 'Approval-gated Terraform', 'Read-only log observation']}
      accessLabel="SUPERADMIN ACCESS"
      title="Tenant control sign in"
      subtitle="This portal is restricted to the global superadmin account."
      submitLabel="Sign in to control plane"
      alternatePrompt="Administer one tenant?"
      alternateLabel="Open tenant admin login"
      alternatePath="/admin/login"
      onLogin={async (username, password) => {
        await loginTenantControl(username, password);
        navigate('/tenants', { replace: true });
      }}
    />
  );
}

export default TenantLogin;
