import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminNav from '../components/AdminNav';
import SecretsPanel from '../components/SecretsPanel';
import { Tenant, TenantConfiguration, TenantIssue, TenantProvisionJob } from '../services/api';
import { tenantControlApi } from '../services/tenantControlApi';
import { useAuth } from '../contexts/AuthContext';

const REGIONS = ['ap-southeast-1', 'ap-southeast-2', 'us-east-1', 'us-west-2', 'eu-west-1'] as const;
const INSTANCE_TYPES = ['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small', 't4g.medium'] as const;

const EMPTY_CONFIG: TenantConfiguration = {
  name: '',
  contact_email: '',
  aws_region: 'ap-southeast-1',
  instance_type: 't3.micro',
  root_volume_size: 12,
  backup_retention_days: 14,
  email_enabled: false,
  email_from_name: '',
  email_daily_limit: 200,
  quota_exams_per_month: null,
  quota_ai_gradings_per_month: null,
  quota_recording_gb: null,
  quota_emails_per_month: null,
  allowed_record_modes: 'none',
  compiler_enabled: false,
  compiler_memory_mb: 512,
  compiler_timeout_seconds: 15,
  compiler_concurrency: 2,
  domain_name: '',
  route53_zone_id: '',
  secret_arn: '',
  repository_url: 'https://github.com/minhmaihuy/e-proc.git',
  repository_ref: 'main',
};

interface CreateTenantForm extends TenantConfiguration {
  slug: string;
  admin_username: string;
  admin_password: string;
}

function domainForTenantSlug(inputSlug: string): string {
  const requestedSlug = inputSlug.trim().toLowerCase();
  const slug = requestedSlug === 'fsa' ? 'fsa-cls' : requestedSlug;
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) return '';
  if (slug === 'fsa-cls') return 'epoc.devfasttrack.com';
  return `epoc.${slug}.devfasttrack.com`;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}

function configFromTenant(tenant: Tenant): TenantConfiguration {
  return {
    name: tenant.name,
    contact_email: tenant.contact_email,
    aws_region: tenant.aws_region,
    instance_type: tenant.instance_type,
    root_volume_size: Number(tenant.root_volume_size),
    backup_retention_days: Number(tenant.backup_retention_days || 14),
    email_enabled: Boolean(tenant.email_enabled),
    email_from_name: tenant.email_from_name || '',
    email_daily_limit: Number(tenant.email_daily_limit || 200),
    quota_exams_per_month: tenant.quota_exams_per_month == null ? null : Number(tenant.quota_exams_per_month),
    quota_ai_gradings_per_month: tenant.quota_ai_gradings_per_month == null ? null : Number(tenant.quota_ai_gradings_per_month),
    quota_recording_gb: tenant.quota_recording_gb == null ? null : Number(tenant.quota_recording_gb),
    quota_emails_per_month: tenant.quota_emails_per_month == null ? null : Number(tenant.quota_emails_per_month),
    allowed_record_modes: tenant.allowed_record_modes || 'none',
    compiler_enabled: Boolean(tenant.compiler_enabled),
    compiler_memory_mb: Number(tenant.compiler_memory_mb || 512),
    compiler_timeout_seconds: Number(tenant.compiler_timeout_seconds || 15),
    compiler_concurrency: Number(tenant.compiler_concurrency || 2),
    domain_name: domainForTenantSlug(tenant.slug) || tenant.domain_name || '',
    route53_zone_id: tenant.route53_zone_id || '',
    secret_arn: tenant.secret_arn === 'configured' ? undefined : tenant.secret_arn || '',
    repository_url: tenant.repository_url,
    repository_ref: tenant.repository_ref,
  };
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null | undefined }) {
  const ratio = limit == null ? 0 : Math.min(100, (used / limit) * 100);
  const state = limit == null ? 'Unlimited'
    : used >= limit ? 'Over configured limit (measurement only)'
      : ratio >= 80 ? 'Approaching configured limit'
        : `${ratio.toFixed(0)}% used`;
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{used.toLocaleString()} / {limit == null ? 'Unlimited' : limit.toLocaleString()}</strong>
      {limit != null && <progress max={100} value={ratio} aria-label={`${label}: ${ratio.toFixed(0)}%`} />}
      <small>{state}</small>
    </div>
  );
}

function tenantApplicationUrl(tenant: Tenant): string {
  const standardDomain = domainForTenantSlug(tenant.slug);
  if (standardDomain) return `https://${standardDomain}/`;
  if (tenant.domain_name) return `https://${tenant.domain_name}/`;
  if (tenant.app_url) return tenant.app_url;
  return '';
}

function TenantManagement() {
  const { logout } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<TenantConfiguration>(EMPTY_CONFIG);
  const [jobs, setJobs] = useState<TenantProvisionJob[]>([]);
  const [issues, setIssues] = useState<TenantIssue[]>([]);
  const [issueStatus, setIssueStatus] = useState<'' | 'open' | 'resolved' | 'archived'>('');
  const [issueSeverity, setIssueSeverity] = useState<'' | 'warning' | 'error' | 'critical'>('');
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState('');
  const issueRequestSequence = useRef(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTenantForm>({
    ...EMPTY_CONFIG,
    slug: '',
    admin_username: '',
    admin_password: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedId) || tenants[0] || null,
    [selectedId, tenants],
  );

  const loadTenants = useCallback(async () => {
    try {
      const response = await tenantControlApi.getTenants();
      setTenants(response.data);
      setSelectedId((current) => current && response.data.some((tenant) => tenant.id === current)
        ? current
        : response.data[0]?.id ?? null);
      setError('');
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to load tenants.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async (tenantId: number) => {
    try {
      const response = await tenantControlApi.getTenantJobs(tenantId);
      setJobs(response.data);
    } catch (requestError) {
      console.error(requestError);
    }
  }, []);

  const loadTenantIssues = useCallback(async (tenantId: number) => {
    const requestSequence = ++issueRequestSequence.current;
    setIssueLoading(true);
    setIssueError('');
    try {
      const response = await tenantControlApi.getTenantIssues(tenantId, {
        status: issueStatus || undefined,
        severity: issueSeverity || undefined,
        limit: 100,
      });
      if (requestSequence === issueRequestSequence.current) setIssues(response.data);
    } catch (requestError: unknown) {
      if (requestSequence === issueRequestSequence.current) {
        setIssues([]);
        setIssueError(apiErrorMessage(requestError, 'Unable to load this tenant log database.'));
      }
    } finally {
      if (requestSequence === issueRequestSequence.current) setIssueLoading(false);
    }
  }, [issueSeverity, issueStatus]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (!selectedTenant) return;
    setForm(configFromTenant(selectedTenant));
    void loadJobs(selectedTenant.id);
    void loadTenantIssues(selectedTenant.id);
  }, [loadJobs, loadTenantIssues, selectedTenant]);

  useEffect(() => {
    if (!selectedTenant || !['planning', 'applying'].includes(selectedTenant.provision_status)) return;
    const interval = window.setInterval(() => {
      void loadTenants();
      void loadJobs(selectedTenant.id);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [loadJobs, loadTenants, selectedTenant]);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleConfigChange = (field: keyof TenantConfiguration, value: string | number | boolean | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateChange = (field: keyof CreateTenantForm, value: string | number | boolean | null) => {
    setCreateForm((current) => {
      if (field !== 'slug' || typeof value !== 'string') return { ...current, [field]: value };
      return { ...current, slug: value, domain_name: domainForTenantSlug(value) };
    });
  };

  const handleSelectTenant = (tenantId: number) => {
    clearMessages();
    setSelectedId(tenantId);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTenant) return;
    clearMessages();
    setSaving(true);
    try {
      await tenantControlApi.updateTenant(selectedTenant.id, form);
      setSuccess('Configuration saved and returned to pending approval.');
      await loadTenants();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to save tenant configuration.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    clearMessages();
    setSaving(true);
    try {
      const response = await tenantControlApi.createTenant(createForm);
      setShowCreate(false);
      setCreateForm({ ...EMPTY_CONFIG, slug: '', admin_username: '', admin_password: '' });
      setSuccess('Tenant and tenant administrator account created.');
      await loadTenants();
      setSelectedId(response.data.id);
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to create tenant.'));
    } finally {
      setSaving(false);
    }
  };

  const performAction = async (name: string, request: () => Promise<unknown>, message: string) => {
    clearMessages();
    setAction(name);
    try {
      await request();
      setSuccess(message);
      await loadTenants();
      if (selectedTenant) await loadJobs(selectedTenant.id);
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, `Unable to ${name} tenant.`));
    } finally {
      setAction('');
    }
  };

  const handleApprove = () => {
    if (!selectedTenant) return;
    void performAction('approve', () => tenantControlApi.approveTenant(selectedTenant.id), 'Tenant approved. You can now run a plan.');
  };

  const handleSuspend = () => {
    if (!selectedTenant || !window.confirm(`Suspend ${selectedTenant.name}?`)) return;
    void performAction('suspend', () => tenantControlApi.suspendTenant(selectedTenant.id), 'Tenant suspended. Existing infrastructure was not destroyed.');
  };

  const handlePlan = () => {
    if (!selectedTenant) return;
    void performAction('plan', () => tenantControlApi.planTenant(selectedTenant.id), 'Terraform plan queued.');
  };

  const handleProvision = () => {
    if (!selectedTenant || !window.confirm(`Create or update the AWS server for ${selectedTenant.name}? This may incur AWS costs.`)) return;
    void performAction('provision', () => tenantControlApi.provisionTenant(selectedTenant.id), 'Terraform apply queued.');
  };

  const pendingCount = tenants.filter((tenant) => tenant.status === 'pending').length;
  const activeCount = tenants.filter((tenant) => tenant.provision_status === 'active').length;
  const latestJob = jobs[0];
  const approvedAt = selectedTenant?.approved_at ? new Date(selectedTenant.approved_at).getTime() : 0;
  const hasReviewedPlan = jobs.some((job) => (
    job.action === 'plan'
    && job.status === 'succeeded'
    && new Date(job.created_at).getTime() >= approvedAt
  ));
  const selectedTenantUrl = selectedTenant ? tenantApplicationUrl(selectedTenant) : '';

  if (loading) return <div className="loading">Loading tenant control plane...</div>;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <span className="eyebrow">E-PROC CONTROL PLANE</span>
          <h1>Tenant operations</h1>
          <p>Approve isolated tenant subdomains, control Terraform deployments, and observe each tenant log database.</p>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>New tenant</button>
          <button className="btn btn-secondary" onClick={logout}>Sign out</button>
        </div>
      </header>

      <AdminNav />

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      <section className="metric-grid" aria-label="Tenant overview">
        <article className="metric-card"><span>Customers</span><strong>{tenants.length}</strong><small>Visible environments</small></article>
        <article className="metric-card metric-warn"><span>Awaiting approval</span><strong>{pendingCount}</strong><small>Configuration reviews</small></article>
        <article className="metric-card metric-success"><span>Live servers</span><strong>{activeCount}</strong><small>Terraform active</small></article>
      </section>

      {tenants.length === 0 ? (
        <section className="empty-state">
          <div className="empty-icon">T</div>
          <h2>No tenants yet</h2>
          <p>Create the first customer workspace and its tenant administrator account.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create tenant</button>
        </section>
      ) : (
        <div className="tenant-layout">
          <aside className="tenant-list" aria-label="Tenant list">
              <div className="section-heading"><div><span className="eyebrow">CUSTOMERS</span><h2>Environments</h2></div><span className="count-pill">{tenants.length}</span></div>
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  className={`tenant-list-item ${selectedTenant?.id === tenant.id ? 'selected' : ''}`}
                  onClick={() => handleSelectTenant(tenant.id)}
                >
                  <span className="tenant-avatar">{tenant.name.slice(0, 2).toUpperCase()}</span>
                  <span className="tenant-list-copy"><strong>{tenant.name}</strong><small>{tenant.slug}</small></span>
                  <span className={`status-dot status-${tenant.status}`} title={statusLabel(tenant.status)} />
                </button>
              ))}
          </aside>

          {selectedTenant && (
            <section className="tenant-workspace">
              <div className="tenant-title-row">
                <div>
                  <div className="status-row">
                    <span className={`status-badge status-${selectedTenant.status}`}>{statusLabel(selectedTenant.status)}</span>
                    <span className={`status-badge provision-${selectedTenant.provision_status}`}>{statusLabel(selectedTenant.provision_status)}</span>
                  </div>
                  <h2>{selectedTenant.name}</h2>
                  <p>{selectedTenant.contact_email} · <code>{selectedTenant.slug}</code></p>
                </div>
                {selectedTenantUrl && <a className="btn btn-secondary" href={selectedTenantUrl} target="_blank" rel="noreferrer">Open tenant subdomain</a>}
              </div>

              {selectedTenant.status === 'pending' && (
                <div className="approval-banner">
                  <span>Configuration waiting for platform review.</span>
                  <button className="btn btn-primary" disabled={!!action} onClick={handleApprove}>Approve tenant</button>
                </div>
              )}

              <form className="tenant-config-card" onSubmit={handleSave}>
                <div className="section-heading"><div><span className="eyebrow">DESIRED STATE</span><h3>Server configuration</h3></div><small>Saving requires a new approval</small></div>
                <div className="form-grid">
                  <label className="field"><span>Customer name</span><input value={form.name} onChange={(event) => handleConfigChange('name', event.target.value)} required minLength={2} maxLength={160} /></label>
                  <label className="field"><span>Contact email</span><input type="email" value={form.contact_email} onChange={(event) => handleConfigChange('contact_email', event.target.value)} required /></label>
                  <label className="field"><span>AWS region</span><select value={form.aws_region} onChange={(event) => handleConfigChange('aws_region', event.target.value)}>{REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
                  <label className="field"><span>Instance type</span><select value={form.instance_type} onChange={(event) => handleConfigChange('instance_type', event.target.value)}>{INSTANCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                  <label className="field"><span>Root volume (GiB)</span><input type="number" min={8} max={100} value={form.root_volume_size} onChange={(event) => handleConfigChange('root_volume_size', Number(event.target.value))} /></label>
                  <label className="field"><span>Backup retention (days)</span><input type="number" min={1} max={35} value={form.backup_retention_days} onChange={(event) => handleConfigChange('backup_retention_days', Number(event.target.value))} /><small>Backups are always enabled. The current default is 14 days.</small></label>
                  <label className="field checkbox-field"><span>Email delivery</span><span><input type="checkbox" checked={form.email_enabled} onChange={(event) => handleConfigChange('email_enabled', event.target.checked)} /> Allow this tenant to queue SES email</span><small>Disabled by default to protect the shared sender reputation.</small></label>
                  <label className="field"><span>Email sender name</span><input maxLength={160} value={form.email_from_name || ''} onChange={(event) => handleConfigChange('email_from_name', event.target.value)} placeholder={form.name || 'Tenant name'} /></label>
                  <label className="field"><span>Daily email safety limit</span><input type="number" min={1} max={50000} value={form.email_daily_limit} onChange={(event) => handleConfigChange('email_daily_limit', Number(event.target.value))} /></label>
                  <label className="field"><span>Monthly exam quota</span><input type="number" min={1} value={form.quota_exams_per_month ?? ''} placeholder="Unlimited" onChange={(event) => handleConfigChange('quota_exams_per_month', event.target.value === '' ? null : Number(event.target.value))} /><small>Measurement only; currently does not block.</small></label>
                  <label className="field"><span>Monthly AI grading quota</span><input type="number" min={1} value={form.quota_ai_gradings_per_month ?? ''} placeholder="Unlimited" onChange={(event) => handleConfigChange('quota_ai_gradings_per_month', event.target.value === '' ? null : Number(event.target.value))} /><small>Measurement only; currently does not block.</small></label>
                  <label className="field"><span>Recording quota (GB)</span><input type="number" min={0.01} step={0.01} value={form.quota_recording_gb ?? ''} placeholder="Unlimited" onChange={(event) => handleConfigChange('quota_recording_gb', event.target.value === '' ? null : Number(event.target.value))} /><small>Configured for future enforcement; usage is currently measured in minutes.</small></label>
                  <label className="field"><span>Monthly email quota</span><input type="number" min={1} value={form.quota_emails_per_month ?? ''} placeholder="Unlimited" onChange={(event) => handleConfigChange('quota_emails_per_month', event.target.value === '' ? null : Number(event.target.value))} /><small>Measurement only; daily safety limit still applies.</small></label>
                  <div className="field field-wide">
                    <span>Screen recording</span>
                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      {(['local', 's3'] as const).map((mode) => {
                        const current = (form.allowed_record_modes || 'none').split(',').map((m) => m.trim());
                        const checked = current.includes(mode);
                        return (
                          // checkbox-field cần thiết ở đây: quy tắc `input` chung đặt w-full,
                          // nên ô tick trần sẽ giãn hết chiều ngang và trông như thanh xám.
                          <label key={mode} className="checkbox-field font-normal">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const next = new Set(current.filter((m) => m === 'local' || m === 's3'));
                                if (event.target.checked) next.add(mode);
                                else next.delete(mode);
                                // 'none' luôn có mặt: tenant nào cũng được phép không ghi màn hình.
                                const ordered = ['none', ...(['local', 's3'] as const).filter((m) => next.has(m))];
                                handleConfigChange('allowed_record_modes', ordered.join(','));
                              }}
                            />
                            {mode === 'local' ? 'Record Local (máy học viên, mã hóa)' : 'Record S3 (tải lên AWS S3)'}
                          </label>
                        );
                      })}
                    </div>
                    <small className="text-slate-500">
                      Tenant admin chỉ chọn được các chế độ đã bật ở đây khi tạo đợt thi. Không bật gì
                      nghĩa là tenant chỉ được thi không ghi màn hình.
                    </small>
                  </div>
                  <label className="field checkbox-field"><span>Practice compiler</span><span><input type="checkbox" checked={form.compiler_enabled} onChange={(event) => handleConfigChange('compiler_enabled', event.target.checked)} /> Execute Run Code with AWS Lambda</span></label>
                  {form.compiler_enabled && <label className="field"><span>Compiler memory (MB)</span><input type="number" min={256} max={3008} step={64} value={form.compiler_memory_mb} onChange={(event) => handleConfigChange('compiler_memory_mb', Number(event.target.value))} /></label>}
                  {form.compiler_enabled && <label className="field"><span>Compiler timeout (seconds)</span><input type="number" min={10} max={30} value={form.compiler_timeout_seconds} onChange={(event) => handleConfigChange('compiler_timeout_seconds', Number(event.target.value))} /></label>}
                  {form.compiler_enabled && <label className="field"><span>Reserved concurrency</span><input type="number" min={1} max={20} value={form.compiler_concurrency} onChange={(event) => handleConfigChange('compiler_concurrency', Number(event.target.value))} /></label>}
                  <label className="field"><span>Domain name</span><input value={form.domain_name} readOnly aria-describedby="tenant-domain-help" /><small id="tenant-domain-help">Derived from tenant slug; FSA-CLS temporarily uses epoc.devfasttrack.com.</small></label>
                  <label className="field"><span>Repository</span><input value={form.repository_url} onChange={(event) => handleConfigChange('repository_url', event.target.value)} required /></label>
                  <label className="field"><span>Branch / tag</span><input value={form.repository_ref} onChange={(event) => handleConfigChange('repository_ref', event.target.value)} required /></label>
                  <label className="field"><span>Route53 zone ID</span><input value={form.route53_zone_id || ''} onChange={(event) => handleConfigChange('route53_zone_id', event.target.value)} /></label>
                  <label className="field field-wide"><span>AWS Secrets Manager ARN</span><input type="password" autoComplete="off" placeholder="arn:aws:secretsmanager:..." value={form.secret_arn || ''} onChange={(event) => handleConfigChange('secret_arn', event.target.value)} /></label>
                </div>
                <div className="form-footer">
                  <p>Secrets remain in AWS Secrets Manager. Only the ARN is stored here.</p>
                  <button className="btn btn-primary" type="submit" disabled={saving || ['planning', 'applying'].includes(selectedTenant.provision_status)}>{saving ? 'Saving...' : 'Save configuration'}</button>
                </div>
              </form>

              <section className="provision-card" aria-labelledby="tenant-usage-heading">
                <div className="section-heading"><div><span className="eyebrow">CURRENT MONTH</span><h3 id="tenant-usage-heading">Measured usage</h3></div><small>Informational only — quota blocking is not enabled</small></div>
                <div className="form-grid">
                  <UsageMeter label="Exams started" used={Number(selectedTenant.usage_exams_started || 0)} limit={selectedTenant.quota_exams_per_month} />
                  <UsageMeter label="AI gradings" used={Number(selectedTenant.usage_ai_gradings || 0)} limit={selectedTenant.quota_ai_gradings_per_month} />
                  <UsageMeter label="Emails sent" used={Number(selectedTenant.usage_emails_sent || 0)} limit={selectedTenant.quota_emails_per_month} />
                  <div className="field"><span>Recording measured</span><strong>{Number(selectedTenant.usage_recording_minutes || 0).toFixed(1)} minutes</strong><small>Configured storage quota: {selectedTenant.quota_recording_gb == null ? 'Unlimited' : `${selectedTenant.quota_recording_gb} GB`}</small></div>
                  <div className="field"><span>Code runs tracked</span><strong>{Number(selectedTenant.usage_code_runs || 0).toLocaleString()}</strong><small>No code-run quota decision has been made.</small></div>
                </div>
              </section>

              <section className="provision-card">
                <div className="section-heading"><div><span className="eyebrow">INFRASTRUCTURE</span><h3>Terraform deployment</h3></div>{latestJob && <span className={`status-badge job-${latestJob.status}`}>{statusLabel(latestJob.status)}</span>}</div>
                <div className="resource-grid">
                  <div><span>Instance</span><strong>{selectedTenant.instance_id || 'Not created'}</strong></div>
                  <div><span>Public IPv6</span><strong>{selectedTenant.ipv6_address || 'Pending'}</strong></div>
                  <div><span>IPv4 fallback</span><strong>{selectedTenant.public_ip || 'Pending'}</strong></div>
                  <div><span>Practice compiler</span><strong>{selectedTenant.compiler_enabled ? (selectedTenant.compiler_lambda_arn || 'Pending Lambda') : 'Local / EC2'}</strong></div>
                  <div><span>Latest backup</span><strong>{selectedTenant.last_backup_at ? new Date(selectedTenant.last_backup_at).toLocaleString() : 'Not reported'}</strong><small>{selectedTenant.last_backup_size_bytes ? `${(selectedTenant.last_backup_size_bytes / 1024 / 1024).toFixed(1)} MB` : 'Size unavailable'}</small></div>
                  <div><span>Latest restore check</span><strong>{selectedTenant.last_restore_test_at ? new Date(selectedTenant.last_restore_test_at).toLocaleString() : 'Not tested'}</strong><small>{selectedTenant.last_restore_test_status || 'No result'}</small></div>
                  <div><span>State</span><strong>{selectedTenant.terraform_state_key || `tenants/${selectedTenant.slug}/terraform.tfstate`}</strong></div>
                </div>
                {selectedTenant.last_error && <div className="notice notice-error"><strong>Last error:</strong> {selectedTenant.last_error}</div>}
                <div className="provision-actions">
                    <button className="btn btn-secondary" disabled={selectedTenant.status !== 'approved' || !!action} onClick={handlePlan}>{action === 'plan' ? 'Queuing...' : 'Run plan'}</button>
                    <button className="btn btn-primary" disabled={selectedTenant.status !== 'approved' || !hasReviewedPlan || !!action} onClick={handleProvision}>{action === 'provision' ? 'Queuing...' : 'Create / update server'}</button>
                    <button className="btn btn-danger-outline" disabled={selectedTenant.status === 'suspended' || !!action} onClick={handleSuspend}>Suspend access</button>
                </div>
                {latestJob?.log_output && (
                  <details className="terraform-log">
                    <summary>Latest Terraform log · {new Date(latestJob.created_at).toLocaleString()}</summary>
                    <pre>{latestJob.log_output}</pre>
                  </details>
                )}
              </section>

              <section className="provision-card" aria-labelledby="tenant-log-heading">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">READ-ONLY OBSERVABILITY</span>
                    <h3 id="tenant-log-heading">Operational logs</h3>
                    <small>{selectedTenantUrl || 'Configure a dedicated tenant domain before approval.'}</small>
                  </div>
                  <button className="btn btn-secondary" type="button" disabled={issueLoading} onClick={() => void loadTenantIssues(selectedTenant.id)}>
                    {issueLoading ? 'Loading...' : 'Refresh logs'}
                  </button>
                </div>
                <p className="text-slate-500">
                  Superadmin can observe safe operational failures for this tenant but cannot resolve or delete them. Tenant administrators retain issue ownership.
                </p>
                <div className="mb-4 flex flex-wrap items-end gap-3">
                  <label className="field min-w-[11rem]">
                    <span>Status</span>
                    <select value={issueStatus} onChange={(event) => setIssueStatus(event.target.value as typeof issueStatus)}>
                      <option value="">All</option>
                      <option value="open">Open</option>
                      <option value="resolved">Resolved</option>
                      <option value="archived">Archived</option>
                    </select>
                  </label>
                  <label className="field min-w-[11rem]">
                    <span>Severity</span>
                    <select value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)}>
                      <option value="">All</option>
                      <option value="warning">Warning</option>
                      <option value="error">Error</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                </div>
                {issueError && <div className="notice notice-error" role="alert">{issueError}</div>}
                <div className="overflow-x-auto">
                  <table>
                    <thead>
                      <tr><th>Time</th><th>Severity</th><th>Issue</th><th>Request</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => (
                        <tr key={issue.id}>
                          <td className="whitespace-nowrap align-top text-slate-600">{new Date(issue.created_at).toLocaleString()}</td>
                          <td><strong>{issue.severity.toUpperCase()}</strong></td>
                          <td>
                            <div><code>{issue.code}</code> · {issue.source}</div>
                            <div className="max-w-md break-words text-slate-800">{issue.message}</div>
                            <small className="text-slate-500">Request ID: {issue.request_id || 'n/a'}</small>
                            {issue.metadata && <details><summary>Safe metadata</summary><pre>{JSON.stringify(issue.metadata, null, 2)}</pre></details>}
                          </td>
                          <td><code>{issue.http_method || '-'} {issue.request_path || '-'}</code><div>{issue.http_status || '-'}</div></td>
                          <td>{issue.status}</td>
                        </tr>
                      ))}
                      {!issueLoading && !issueError && issues.length === 0 && (
                        <tr><td colSpan={5} className="py-10 text-center text-slate-500">No issues match these filters.</td></tr>
                      )}
                      {issueLoading && <tr><td colSpan={5} className="py-10 text-center text-slate-500">Loading tenant log database…</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}
        </div>
      )}

      <SecretsPanel />

      {showCreate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-tenant-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><span className="eyebrow">ONBOARD CUSTOMER</span><h2 id="create-tenant-title">Create tenant</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowCreate(false)}>×</button></div>
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <label className="field"><span>Customer name</span><input value={createForm.name} onChange={(event) => handleCreateChange('name', event.target.value)} required /></label>
                <label className="field"><span>Stable slug</span><input placeholder="acme-vietnam" value={createForm.slug} onChange={(event) => handleCreateChange('slug', event.target.value.toLowerCase())} required pattern="[a-z][a-z0-9-]{2,30}" /></label>
                <label className="field"><span>Tenant domain</span><input value={createForm.domain_name} placeholder="epoc.acme-vietnam.devfasttrack.com" readOnly /></label>
                <label className="field"><span>Contact email</span><input type="email" value={createForm.contact_email} onChange={(event) => handleCreateChange('contact_email', event.target.value)} required /></label>
                <label className="field"><span>Tenant admin username</span><input value={createForm.admin_username} onChange={(event) => handleCreateChange('admin_username', event.target.value)} required minLength={3} /></label>
                <label className="field field-wide"><span>Tenant admin password</span><input type="password" autoComplete="new-password" value={createForm.admin_password} onChange={(event) => handleCreateChange('admin_password', event.target.value)} required minLength={8} maxLength={128} /></label>
              </div>
              <div className="form-footer"><p>Only superadmin can configure, approve, and provision tenant infrastructure.</p><div className="button-row"><button className="btn btn-ghost" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create workspace'}</button></div></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default TenantManagement;
