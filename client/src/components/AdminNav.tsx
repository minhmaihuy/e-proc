import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Thanh điều hướng admin dùng chung cho mọi trang admin.
// Link "User Management" chỉ hiện với role superadmin (admin thường không thấy).
function AdminNav() {
  const { isSuperAdmin, isTenantAdmin, isUserManager } = useAuth();
  if (isTenantAdmin) {
    return (
      <nav className="nav" aria-label="Tenant navigation">
        <Link to="/admin/tenant">Tenant workspace</Link>
        {isUserManager && <Link to="/admin/users">Users</Link>}
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
      {isSuperAdmin && <Link to="/admin/tenants">Tenant control plane</Link>}
      {isUserManager && <Link to="/admin/users">User Management</Link>}
    </nav>
  );
}

export default AdminNav;
