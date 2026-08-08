import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { adminApi } from '../services/api';
import { tenantControlApi } from '../services/tenantControlApi';

interface LoginSession {
  role: string;
  userId: number;
  tenantId: number | null;
  tenantSlug: string | null;
  tenantName: string | null;
  serverTenantSlug: string;
  serverTenantName: string;
}

interface LoginResponse extends LoginSession {
  token: string;
  expiresAt: string;
}

interface AuthContextType {
  token: string | null;
  userId: number | null;
  role: string | null;
  tenantId: number | null;
  tenantSlug: string | null;
  tenantName: string | null;
  serverTenantSlug: string;
  serverTenantName: string;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  isUserManager: boolean;
  isLoading: boolean;
  loginAdmin: (username: string, password: string) => Promise<LoginSession>;
  loginTenantControl: (username: string, password: string) => Promise<LoginSession>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [serverTenantSlug, setServerTenantSlug] = useState('fsa-cls');
  const [serverTenantName, setServerTenantName] = useState('FSA CLS');
  const [isLoading, setIsLoading] = useState(true);

  // Restore session từ localStorage khi app mount
  useEffect(() => {
    const stored = localStorage.getItem('adminToken');
    const expiresAt = localStorage.getItem('adminTokenExpiry');
    const storedRole = localStorage.getItem('adminRole');
    const storedUserId = localStorage.getItem('adminUserId');
    const storedTenantId = localStorage.getItem('adminTenantId');
    const storedTenantSlug = localStorage.getItem('adminTenantSlug');
    const storedTenantName = localStorage.getItem('adminTenantName');
    const storedServerTenantSlug = localStorage.getItem('adminServerTenantSlug');
    const storedServerTenantName = localStorage.getItem('adminServerTenantName');

    if (stored && expiresAt) {
      // Kiểm tra token có còn hạn không
      if (new Date(expiresAt) > new Date()) {
        setToken(stored);
        setRole(storedRole);
        setUserId(storedUserId ? Number(storedUserId) : null);
        setTenantId(storedTenantId ? Number(storedTenantId) : null);
        setTenantSlug(storedTenantSlug);
        setTenantName(storedTenantName);
        setServerTenantSlug(storedServerTenantSlug || 'fsa-cls');
        setServerTenantName(storedServerTenantName || 'FSA CLS');
      } else {
        // Token đã hết hạn — xóa đi
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminTokenExpiry');
        localStorage.removeItem('adminRole');
        localStorage.removeItem('adminUserId');
        localStorage.removeItem('adminTenantId');
        localStorage.removeItem('adminTenantSlug');
        localStorage.removeItem('adminTenantName');
        localStorage.removeItem('adminServerTenantSlug');
        localStorage.removeItem('adminServerTenantName');
      }
    }
    setIsLoading(false);
  }, []);

  const loginWith = async (request: () => Promise<{ data: LoginResponse }>): Promise<LoginSession> => {
    const res = await request();
    const {
      token: newToken,
      expiresAt,
      role: newRole,
      userId: newUserId,
      tenantId: newTenantId,
      tenantSlug: newTenantSlug,
      tenantName: newTenantName,
      serverTenantSlug: newServerTenantSlug,
      serverTenantName: newServerTenantName,
    } = res.data;

    localStorage.setItem('adminToken', newToken);
    localStorage.setItem('adminTokenExpiry', expiresAt);
    localStorage.setItem('adminRole', newRole || 'admin');
    localStorage.setItem('adminUserId', String(newUserId));
    if (newTenantId) localStorage.setItem('adminTenantId', String(newTenantId));
    else localStorage.removeItem('adminTenantId');
    if (newTenantSlug) localStorage.setItem('adminTenantSlug', newTenantSlug);
    else localStorage.removeItem('adminTenantSlug');
    if (newTenantName) localStorage.setItem('adminTenantName', newTenantName);
    else localStorage.removeItem('adminTenantName');
    localStorage.setItem('adminServerTenantSlug', newServerTenantSlug || 'fsa-cls');
    localStorage.setItem('adminServerTenantName', newServerTenantName || 'FSA CLS');
    setToken(newToken);
    setRole(newRole || 'admin');
    setUserId(Number(newUserId));
    setTenantId(newTenantId || null);
    setTenantSlug(newTenantSlug || null);
    setTenantName(newTenantName || null);
    setServerTenantSlug(newServerTenantSlug || 'fsa-cls');
    setServerTenantName(newServerTenantName || 'FSA CLS');
    return {
      role: newRole || 'admin',
      userId: Number(newUserId),
      tenantId: newTenantId || null,
      tenantSlug: newTenantSlug || null,
      tenantName: newTenantName || null,
      serverTenantSlug: newServerTenantSlug || 'fsa-cls',
      serverTenantName: newServerTenantName || 'FSA CLS',
    };
  };

  const loginAdmin = (username: string, password: string) =>
    loginWith(() => adminApi.login(username, password));

  const loginTenantControl = (username: string, password: string) =>
    loginWith(() => tenantControlApi.login(username, password));

  const logout = () => {
    const request = role === 'superadmin' ? tenantControlApi.logout() : adminApi.logout();
    request.catch(() => {}); // Fire and forget
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminTokenExpiry');
    localStorage.removeItem('adminRole');
    localStorage.removeItem('adminUserId');
    localStorage.removeItem('adminTenantId');
    localStorage.removeItem('adminTenantSlug');
    localStorage.removeItem('adminTenantName');
    localStorage.removeItem('adminServerTenantSlug');
    localStorage.removeItem('adminServerTenantName');
    setToken(null);
    setRole(null);
    setUserId(null);
    setTenantId(null);
    setTenantSlug(null);
    setTenantName(null);
    setServerTenantSlug('fsa-cls');
    setServerTenantName('FSA CLS');
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        userId,
        role,
        tenantId,
        tenantSlug,
        tenantName,
        serverTenantSlug,
        serverTenantName,
        isAuthenticated: !!token,
        isSuperAdmin: role === 'superadmin',
        isPlatformAdmin: (role === 'admin' || role === 'tenant_admin') && Boolean(tenantId) && Boolean(tenantSlug),
        isTenantAdmin: role === 'tenant_admin',
        isUserManager: role === 'tenant_admin' && Boolean(tenantId) && Boolean(tenantSlug),
        isLoading,
        loginAdmin,
        loginTenantControl,
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
