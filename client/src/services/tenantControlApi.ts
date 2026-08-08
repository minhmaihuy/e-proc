import {
  api,
  Tenant,
  TenantConfiguration,
  TenantIssue,
  TenantProvisionJob,
} from './api';

export const tenantControlApi = {
  login: (username: string, password: string) =>
    api.post('/tenants/login', { username, password }),

  logout: () =>
    api.post('/tenants/logout').finally(() => localStorage.removeItem('adminToken')),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/tenants/change-password', { currentPassword, newPassword }),

  getTenants: () =>
    api.get<Tenant[]>('/tenants'),

  createTenant: (data: TenantConfiguration & { slug: string; admin_username: string; admin_password: string }) =>
    api.post('/tenants', data),

  updateTenant: (id: number, data: TenantConfiguration) =>
    api.put(`/tenants/${id}`, data),

  approveTenant: (id: number) =>
    api.post(`/tenants/${id}/approve`),

  suspendTenant: (id: number) =>
    api.post(`/tenants/${id}/suspend`),

  planTenant: (id: number) =>
    api.post(`/tenants/${id}/plan`),

  provisionTenant: (id: number) =>
    api.post(`/tenants/${id}/provision`),

  getTenantJobs: (id: number) =>
    api.get<TenantProvisionJob[]>(`/tenants/${id}/jobs`),

  getTenantIssues: (
    id: number,
    params?: {
      status?: 'open' | 'resolved' | 'archived';
      severity?: 'warning' | 'error' | 'critical';
      limit?: number;
    },
  ) => api.get<TenantIssue[]>(`/tenants/${id}/issues`, { params }),
};
