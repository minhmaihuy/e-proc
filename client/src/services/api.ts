import axios from 'axios';

const API_BASE = '/api';

export type TenantStatus = 'pending' | 'approved' | 'suspended';
export type TenantProvisionStatus = 'not_started' | 'queued' | 'planning' | 'planned' | 'applying' | 'active' | 'failed';
export type AdminRole = 'admin' | 'tenant_admin' | 'superadmin';

export interface StudentExamQuestion {
  id: string;
  question_order: number;
  question_sample: string;
  module: string;
  level: string;
  type: string;
  answer?: string;
  options?: { key: string; text: string }[];
}

export interface PracticeRedirectResponse {
  redirect: 'practice';
}

export type StartExamResponse =
  | { success: true; questions_count: number; resume?: boolean }
  | ({ success: false } & PracticeRedirectResponse);

export type ExamQuestionsResponse =
  | { questions: StudentExamQuestion[]; time_remaining: number | null }
  | (PracticeRedirectResponse & { questions: []; time_remaining: null })
  | StudentExamQuestion[];

/** Trạng thái AWS Secrets Manager — chỉ chứa TÊN khóa, không bao giờ có giá trị. */
export interface AppSecretsStatus {
  enabled: boolean;
  configured: boolean;
  secretArn: string;
  region: string;
  loadedAt: string | null;
  appliedKeys: string[];
  ignoredKeys: string[];
  envFallbackKeys: string[];
  error: string | null;
  managedKeys: string[];
}

export interface AppSecretsTestResult {
  success: boolean;
  secretArn: string;
  region: string;
  appliedKeys: string[];
  ignoredKeys: string[];
  message: string;
}

/** Chế độ ghi màn hình tenant hiện tại được phép dùng (backend chặn độc lập). */
export interface RecordingConfig {
  allowed_record_modes: ('none' | 'local' | 's3')[];
  can_change: boolean;
  s3_configured: boolean;
  identity_verification: 'off' | 'photo';
  identity_retention_days: number | null;
  identity_s3_configured: boolean;
}

export interface RecordingPart {
  part_index: number;
  byte_size: number;
  uploaded_at: string;
  is_final: boolean;
  /** Presigned GET, hết hạn ngắn — tải lại danh sách khi quá hạn. */
  url: string;
}

export interface StudentRecordings {
  record_mode: 'none' | 'local' | 's3';
  email?: string;
  parts: RecordingPart[];
  message?: string;
  url_expires_seconds?: number;
}

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
  backup_retention_days: number;
  last_backup_at?: string | null;
  last_backup_size_bytes?: number | null;
  last_restore_test_at?: string | null;
  last_restore_test_status?: 'passed' | 'failed' | null;
  email_enabled: boolean | number;
  email_from_name?: string | null;
  email_daily_limit: number;
  quota_exams_per_month?: number | null;
  quota_ai_gradings_per_month?: number | null;
  quota_recording_gb?: number | null;
  quota_emails_per_month?: number | null;
  identity_verification?: 'off' | 'photo';
  identity_retention_days?: number | null;
  recording_retention_days?: number | null;
  usage_exams_started?: number;
  usage_ai_gradings?: number;
  usage_recording_minutes?: number;
  usage_emails_sent?: number;
  usage_code_runs?: number;
  /** Chế độ ghi màn hình tenant được phép dùng, vd "none,local,s3". */
  allowed_record_modes?: string;
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
  backup_retention_days: number;
  email_enabled: boolean;
  email_from_name?: string;
  email_daily_limit: number;
  quota_exams_per_month: number | null;
  quota_ai_gradings_per_month: number | null;
  quota_recording_gb: number | null;
  quota_emails_per_month: number | null;
  identity_verification: 'off' | 'photo';
  identity_retention_days: number | null;
  recording_retention_days: number | null;
  allowed_record_modes?: string;
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

export const api = axios.create({
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
    const path = window.location.pathname;
    const isTenantControlPath = path === '/tenants' || path.startsWith('/tenants/');
    const isTenantAdminPath = path === '/admin' || path.startsWith('/admin/');
    const isLoginPath = path === '/admin/login' || path === '/tenant/login';
    if (error.response?.status === 401 && (isTenantControlPath || isTenantAdminPath) && !isLoginPath) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminTokenExpiry');
      localStorage.removeItem('adminRole');
      localStorage.removeItem('adminUserId');
      localStorage.removeItem('adminTenantId');
      localStorage.removeItem('adminTenantSlug');
      localStorage.removeItem('adminTenantName');
      localStorage.removeItem('adminServerTenantSlug');
      localStorage.removeItem('adminServerTenantName');
      window.location.href = isTenantControlPath ? '/tenant/login' : '/admin/login';
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

  // --- AWS Secrets Manager (chỉ superadmin; bật/tắt vẫn nằm ở .env máy chủ) ---
  getSecretsStatus: () =>
    api.get<AppSecretsStatus>('/admin/secrets/status'),

  testSecret: (secretArn: string, awsRegion: string) =>
    api.post<AppSecretsTestResult>('/admin/secrets/test', { secret_arn: secretArn, aws_region: awsRegion }),

  // --- Ghi màn hình ---
  getRecordingConfig: () =>
    api.get<RecordingConfig>('/admin/recording-config'),

  getStudentRecordings: (batchId: number, studentId: number) =>
    api.get<StudentRecordings>(`/admin/batches/${batchId}/students/${studentId}/recordings`),

  getStudentIdentity: (batchId: number, studentId: number) =>
    api.get<{ status: string; id_url: string; face_url: string; review_token: string; url_expires_seconds: number }>(`/admin/batches/${batchId}/students/${studentId}/identity`),

  reviewStudentIdentity: (batchId: number, studentId: number, decision: 'verified' | 'rejected', reviewToken: string) =>
    api.post<{ status: string }>(`/admin/batches/${batchId}/students/${studentId}/identity/review`, { decision, review_token: reviewToken }),

  // --- Tenant-aware user management ---
  listUsers: () =>
    api.get<AdminUser[]>('/admin/users'),

  getUsers: () =>
    api.get<AdminUser[]>('/admin/users'),

  createUser: (
    dataOrUsername: { username: string; password: string; role: AdminRole; tenant_id?: number | null } | string,
    password?: string,
    role?: AdminRole,
  ) => api.post('/admin/users', typeof dataOrUsername === 'string'
    ? { username: dataOrUsername, password, role }
    : dataOrUsername),

  updateUser: (id: number, data: { role?: AdminRole; password?: string; tenant_id?: number | null }) =>
    api.put(`/admin/users/${id}`, data),

  deleteUser: (id: number) =>
    api.delete(`/admin/users/${id}`),

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
  
  getQuestionGroups: () =>
    api.get<string[]>('/admin/questions/question-groups'),

  getModules: () =>
    api.get('/admin/questions/modules'),

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

  queueBatchEmail: (batchId: number, template: 'exam_invitation' | 'exam_reminder' | 'exam_result', campaignId: string) =>
    api.post(`/admin/batches/${batchId}/emails`, { template, campaign_id: campaignId }),
  
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

  getIdentityStatus: () =>
    api.get<{ mode: 'off' | 'photo'; status: 'not_required' | 'pending' | 'captured' | 'verified' | 'rejected'; retention_days?: number }>('/student/identity/status'),

  getIdentityUploadUrls: () =>
    api.post<{ id_url: string; face_url: string; expires_seconds: number }>('/student/identity/upload-url', { content_type: 'image/jpeg' }),

  completeIdentityUpload: () =>
    api.post<{ status: 'captured' }>('/student/identity/complete', {}),

  startExam: (studentId: number) =>
    api.post<StartExamResponse>('/student/exam/start', { student_id: studentId }),

  // [C-4] Không còn truyền studentId - token tự động gắn qua interceptor
  getQuestions: () =>
    api.get<ExamQuestionsResponse>('/student/exam/questions'),

  saveAnswer: (questionOrder: number, answer: string) =>
    api.post('/student/exam/answer', { question_order: questionOrder, answer }),

  submit: () =>
    api.post('/student/exam/submit', {}),

  reportViolation: (
    type: string,
    meta?: { contentPreview?: string; textLength?: number; questionId?: string; metadata?: Record<string, number> }
  ) =>
    api.post('/student/violation', {
      type,
      content_preview: meta?.contentPreview,
      text_length: meta?.textLength,
      question_id: meta?.questionId,
      metadata: meta?.metadata,
    }),

  // Xin presigned PUT URL để upload 1 phần video record thẳng lên S3
  getRecordingUploadUrl: (partIndex: number, contentType: string) =>
    api.post('/student/exam/recording-url', { partIndex, contentType }),

  completeRecordingPart: (partIndex: number, byteSize: number) =>
    api.post('/student/exam/recording-complete', { partIndex, byteSize }),

  finalizeRecording: (finalPartIndex: number) =>
    api.post('/student/exam/recording-finalize', { finalPartIndex }),

  // --- Run code (học viên tự kiểm tra tính đúng đắn) ---
  runCode: (language: string, code: string, stdin?: string) =>
    api.post('/student/run', { language, code, stdin, event_id: crypto.randomUUID() }),

  recordLocalCodeRun: (eventId: string) =>
    api.post('/student/usage/code-run', { event_id: eventId }),

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
