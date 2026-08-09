import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Global superadmin and tenant administrators intentionally have separate navigation trees.
function AdminNav() {
  const { isSuperAdmin, isUserManager } = useAuth();
  if (isSuperAdmin) {
    return (
      <nav className="nav" aria-label="Global tenant control navigation">
        <Link to="/tenants">Tenant Control Plane</Link>
        <Link to="/secrets">Secrets Manager</Link>
      </nav>
    );
  }
  return (
    <nav className="nav" aria-label="Admin navigation">
      <Link to="/admin/dashboard">Dashboard</Link>
      <Link to="/admin/questions">Question Bank</Link>
      <Link to="/admin/batches">Batches</Link>
      <Link to="/admin/practice">Practice</Link>
      <Link to="/admin/settings">AI Settings</Link>
      <Link to="/admin/issues">Issue Logs</Link>
      {isUserManager && <Link to="/admin/users">Tenant Users</Link>}
    </nav>
  );
}

export default AdminNav;
