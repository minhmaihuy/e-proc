import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { adminApi } from '../services/api';

interface AuthContextType {
  token: string | null;
  role: string | null;
  tenantId: number | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ role: string; tenantId: number | null }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session từ localStorage khi app mount
  useEffect(() => {
    const stored = localStorage.getItem('adminToken');
    const expiresAt = localStorage.getItem('adminTokenExpiry');
    const storedRole = localStorage.getItem('adminRole');
    const storedTenantId = localStorage.getItem('adminTenantId');

    if (stored && expiresAt) {
      // Kiểm tra token có còn hạn không
      if (new Date(expiresAt) > new Date()) {
        setToken(stored);
        setRole(storedRole);
        setTenantId(storedTenantId ? Number(storedTenantId) : null);
      } else {
        // Token đã hết hạn — xóa đi
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminTokenExpiry');
        localStorage.removeItem('adminRole');
        localStorage.removeItem('adminTenantId');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const res = await adminApi.login(username, password);
    const { token: newToken, expiresAt, role: newRole, tenantId: newTenantId } = res.data;

    localStorage.setItem('adminToken', newToken);
    localStorage.setItem('adminTokenExpiry', expiresAt);
    localStorage.setItem('adminRole', newRole || 'admin');
    if (newTenantId) localStorage.setItem('adminTenantId', String(newTenantId));
    else localStorage.removeItem('adminTenantId');
    setToken(newToken);
    setRole(newRole || 'admin');
    setTenantId(newTenantId || null);
    return { role: newRole || 'admin', tenantId: newTenantId || null };
  };

  const logout = () => {
    adminApi.logout().catch(() => {}); // Fire and forget
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminTokenExpiry');
    localStorage.removeItem('adminRole');
    localStorage.removeItem('adminTenantId');
    setToken(null);
    setRole(null);
    setTenantId(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        role,
        tenantId,
        isAuthenticated: !!token,
        isSuperAdmin: role === 'superadmin',
        isPlatformAdmin: role === 'admin' || role === 'superadmin',
        isTenantAdmin: role === 'tenant_admin',
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
