import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ReactNode } from 'react';

interface PrivateRouteProps {
  children: ReactNode;
  requireSuperAdmin?: boolean;
  requirePlatformAdmin?: boolean;
  requireUserManager?: boolean;
  requireTenantAdmin?: boolean;
}

function PrivateRoute({ children, requireSuperAdmin = false, requirePlatformAdmin = false, requireUserManager = false, requireTenantAdmin = false }: PrivateRouteProps) {
  const { isAuthenticated, isSuperAdmin, isPlatformAdmin, isTenantAdmin, isUserManager, isLoading } = useAuth();

  // Chờ AuthContext kiểm tra localStorage xong trước khi redirect
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        color: 'var(--text-light, #6b7280)'
      }}>
        <span>Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/admin" replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to={isPlatformAdmin ? '/admin/dashboard' : '/admin/tenant'} replace />;
  }

  if (requirePlatformAdmin && !isPlatformAdmin) {
    return <Navigate to="/admin/tenant" replace />;
  }

  if (requireUserManager && !isUserManager) {
    return <Navigate to={isPlatformAdmin ? '/admin/dashboard' : '/admin/tenant'} replace />;
  }

  if (requireTenantAdmin && !isTenantAdmin) {
    return <Navigate to={isSuperAdmin ? '/admin/tenants' : '/admin/dashboard'} replace />;
  }

  return <>{children}</>;
}

export default PrivateRoute;
