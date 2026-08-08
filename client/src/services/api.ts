import axios from 'axios';

const API_BASE = '/api';

export type TenantStatus = 'pending' | 'approved' | 'suspended';
export type TenantProvisionStatus = 'not_started' | 'queued' | 'planning' | 'planned' | 'applying' | 'active' | 'failed';
export type AdminRole = 'admin' | 'tenant_admin' | 'superadmin';

export interface AdminUser {
  id: number;
  username: string;
  role: AdminRole;
  tenant_id: number | null;
  tenant_slug?: string | null;
  tenant_name?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Tenant {
  id: number;
  slug: string;
  name: string;
  contact_email: string;
  status: TenantStatus;
  aws_region: string;
  instance_type: string;
  root_volume_size: number;
  compiler_enabled: boolean | number;
  compiler_memory_mb: number;
  compiler_timeout_seconds: number;
  compiler_concurrency: number;
  compiler_lambda_arn?: string;
  domain_name: string;
  route53_zone_id: string;
  secret_arn: string;
  repository_url: string;
  repository_ref: string;
  provision_status: TenantProvisionStatus;
  terraform_state_key?: string;
  instance_id?: string;
  public_ip?: string;
  ipv6_address?: string;
  app_url?: string;
  last_error?: string;
  approved_at?: string;
  created_at: string;
  admin_count?: number;
}

export interface TenantProvisionJob {
  id: number;
  action: 'plan' | 'apply';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  log_output?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

export interface TenantIssue {
  id: number;
  tenant_slug: string;
  severity: 'warning' | 'error' | 'critical';
  source: string;
  code: string;
  message: string;
  http_status?: number | null;
  http_method?: string | null;
  request_path?: string | null;
  request_id?: string | null;
  actor_type: 'admin' | 'student' | 'anonymous' | 'system';
  actor_id?: number | null;
  metadata?: Record<string, string | number | boolean | null> | null;
  status: 'open' | 'resolved' | 'archived';
  resolved_by?: number | null;
  resolved_at?: string | null;
  archived_by?: number | null;
  archived_at?: string | null;
  last_managed_by?: number | null;
  last_managed_at?: string | null;
  created_at: string;
}

export interface TenantConfiguration {
  name: string;
  contact_email: string;
  aws_region: string;
  instance_type: string;
  root_volume_size: number;
  compiler_enabled: boolean;
  compiler_memory_mb: number;
  compiler_timeout_seconds: number;
  compiler_concurrency: number;
  domain_name: string;
  route53_zone_id?: string;
  secret_arn?: string;
  repository_url: string;
  repository_ref: string;
}

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true
});

// =============================================
// REQUEST INTERCEPTOR — Tự động gắn JWT token
// =============================================
api.interceptors.request.use(
  (config) => {
    // Admin JWT
    const adminToken = localStorage.getItem('adminToken');
    if (adminToken && (config.url?.includes('/admin/') || config.url?.startsWith('/tenants'))) {
      config.headers.Authorization = `Bearer ${adminToken}`;
    }
    // [C-4] Student token — gắn vào tất cả /student/ request
    const studentToken = localStorage.getItem('studentToken');
    if (studentToken && config.url?.includes('/student/')) {
      config.headers.Authorization = `Bearer ${studentToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// =============================================
// RESPONSE INTERCEPTOR — Auto logout khi 401
// =============================================
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/tenants')) &&
      window.location.pathname !== '/admin'
    ) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminTokenExpiry');
      localStorage.removeItem('adminRole');
      localStorage.removeItem('adminUserId');
      localStorage.removeItem('adminTenantId');
      localStorage.removeItem('adminTenantSlug');
      localStorage.removeItem('adminTenantName');
      localStorage.removeItem('adminServerTenantSlug');
      localStorage.removeItem('adminServerTenantName');
      window.location.href = '/admin';
    }
    return Promise.reject(error);
  }
);

export const adminApi = {
  // --- Auth endpoints ---
  login: (username: string, password: string) =>
    api.post('/admin/login', { username, password }),

  logout: () =>
    api.post('/admin/logout').finally(() => localStorage.removeItem('adminToken')),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/admin/change-password', { currentPassword, newPassword }),

  // --- Tenant-aware user management ---
  listUsers: () =>
    api.get<AdminUser[]>('/admin/users'),

  createUser: (data: { username: string; password: string; role: AdminRole; tenant_id?: number | null }) =>
    api.post('/admin/users', data),

  updateUser: (id: number, data: { role?: AdminRole; password?: string; tenant_id?: number | null }) =>
    api.put(`/admin/users/${id}`, data),

  deleteUser: (id: number) =>
    api.delete(`/admin/users/${id}`),

  // --- Multi-tenant control plane ---
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

  getTenantIssues: (id: number, params?: { status?: 'open' | 'resolved' | 'archived'; severity?: 'warning' | 'error' | 'critical'; limit?: number }) =>
    api.get<TenantIssue[]>(`/tenants/${id}/issues`, { params }),

  getIssues: (params?: { status?: 'open' | 'resolved' | 'archived'; severity?: 'warning' | 'error' | 'critical'; limit?: number }) =>
    api.get<TenantIssue[]>('/admin/issues', { params }),

  resolveIssue: (id: number) =>
    api.put(`/admin/issues/${id}/resolve`),

  updateIssueStatus: (id: number, status: 'open' | 'resolved' | 'archived') =>
    api.put(`/admin/issues/${id}/status`, { status }),

  // --- Question endpoints ---
  importQuestions: (formData: FormData) =>
    api.post('/admin/questions/import', formData),

  importQuizQuestions: (formData: FormData) =>
    api.post('/admin/questions/quiz/import', formData),
  
  getQuestions: () =>
    api.get('/admin/questions'),
  
  getModules: () =>
    api.get('/admin/questions/modules'),

  getQuestionGroups: () =>
    api.get('/admin/questions/question-groups'),

  getModuleGroups: () =>
    api.get('/admin/questions/module-groups'),

  getModuleStats: () =>
    api.get('/admin/questions/module-stats'),

  getModuleGroupStats: () =>
    api.get('/admin/questions/module-group-stats'),

  getTypeStats: () =>
    api.get('/admin/questions/type-stats'),

  getModuleTypeStats: () =>
    api.get('/admin/questions/module-type-stats'),

  getModuleGroupTypeStats: () =>
    api.get('/admin/questions/module-group-type-stats'),

  // Câu hỏi được định danh bằng cặp (id, question_group) — hai bộ đề khác nhau được
  // phép dùng chung mã ID, nên xóa phải nêu rõ group.
  deleteQuestion: (id: string, questionGroup: string = '') =>
    api.delete(`/admin/questions/${encodeURIComponent(id)}`, { params: { group: questionGroup } }),

  // keys dạng "id|||group" (xem questionKey() trong QuestionBank.tsx)
  deleteQuestions: (ids: string[]) =>
    api.post('/admin/questions/bulk-delete', { ids }),
  
  // --- Batch endpoints ---
  createBatch: (data: any) =>
    api.post('/admin/batches', data),
  
  getBatches: () =>
    api.get('/admin/batches'),
  
  getBatch: (id: number) =>
    api.get(`/admin/batches/${id}`),
  
  updateBatch: (id: number, data: any) =>
    api.put(`/admin/batches/${id}`, data),
  
  deleteBatch: (id: number) =>
    api.delete(`/admin/batches/${id}`),
  
  checkFeasibility: (id: number, blueprint: any[]) =>
    api.post(`/admin/batches/${id}/check-feasibility`, { blueprint }),
  
  // --- Student endpoints ---
  importStudents: (batchId: number, emails: string[]) =>
    api.post(`/admin/batches/${batchId}/students/import`, { emails }),
  
  getStudents: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/students`),
  
  deleteStudent: (studentId: number) =>
    api.delete(`/admin/students/${studentId}`),
  
  exportStudents: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/students/export`, { responseType: 'blob' }),
  
  // --- Results endpoints ---
  getResults: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/results`),
  
  updateResult: (studentId: number, data: any) =>
    api.put(`/admin/results/${studentId}`, data),
  
  exportResults: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/results/export`, { responseType: 'blob' }),

  // --- Practice exam endpoints (quản lý riêng, import từ .docx) ---
  importPractice: (formData: FormData) =>
    api.post('/admin/practice/import', formData),

  getPracticeExams: () =>
    api.get('/admin/practice'),

  getPracticeExam: (id: number) =>
    api.get(`/admin/practice/${id}`),

  deletePracticeExam: (id: number) =>
    api.delete(`/admin/practice/${id}`),

  getPracticeResults: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/practice-results`),

  updatePracticeResult: (studentId: number, data: any) =>
    api.put(`/admin/practice-results/${studentId}`, data),

  exportPracticeResults: (batchId: number) =>
    api.get(`/admin/batches/${batchId}/practice-results/export`, { responseType: 'blob' }),

  // --- AI Settings endpoints ---
  getAISettings: () =>
    api.get('/admin/settings/ai'),

  saveAISettings: (settings: any) =>
    api.post('/admin/settings/ai', settings),

  testAI: (settings: any) =>
    api.post('/admin/settings/ai/test', settings)
};

export const studentApi = {
  verify: (accessCode: string) =>
    api.post('/student/verify', { access_code: accessCode }),

  selectEmail: (studentId: number, email: string) =>
    api.post('/student/select-email', { student_id: studentId, email }),

  startExam: (studentId: number) =>
    api.post('/student/exam/start', { student_id: studentId }),

  // [C-4] Không còn truyền studentId - token tự động gắn qua interceptor
  getQuestions: () =>
    api.get('/student/exam/questions'),

  saveAnswer: (questionOrder: number, answer: string) =>
    api.post('/student/exam/answer', { question_order: questionOrder, answer }),

  submit: () =>
    api.post('/student/exam/submit', {}),

  reportViolation: (
    type: string,
    meta?: { contentPreview?: string; textLength?: number; questionId?: string }
  ) =>
    api.post('/student/violation', {
      type,
      content_preview: meta?.contentPreview,
      text_length: meta?.textLength,
      question_id: meta?.questionId,
    }),

  // Xin presigned PUT URL để upload 1 phần video record thẳng lên S3
  getRecordingUploadUrl: (partIndex: number, contentType: string) =>
    api.post('/student/exam/recording-url', { partIndex, contentType }),

  // --- Run code (học viên tự kiểm tra tính đúng đắn) ---
  runCode: (language: string, code: string, stdin?: string) =>
    api.post('/student/run', { language, code, stdin }),

  // --- Practice exam (bài thi practice import từ .docx) ---
  getPractice: () =>
    api.get('/student/practice'),

  savePracticeAnswer: (answer: string) =>
    api.post('/student/practice/answer', { answer }),

  submitPractice: () =>
    api.post('/student/practice/submit', {}),

  // [C-4] sendBeacon không hỗ trợ custom headers:
  // gửi student_token trong body để studentAuthMiddleware xử lý
  disconnect: () => {
    const studentToken = localStorage.getItem('studentToken');
    const sent = navigator.sendBeacon(
      '/api/student/exam/disconnect',
      new Blob([JSON.stringify({ student_token: studentToken })], { type: 'application/json' })
    );
    // Fallback bằng axios nếu sendBeacon thất bại
    if (!sent) {
      return api.post('/student/exam/disconnect', { student_token: studentToken });
    }
    return Promise.resolve();
  },
};

export default api;
