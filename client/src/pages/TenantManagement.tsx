import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { adminApi, Tenant, TenantConfiguration, TenantProvisionJob } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const REGIONS = ['ap-southeast-1', 'ap-southeast-2', 'us-east-1', 'us-west-2', 'eu-west-1'] as const;
const INSTANCE_TYPES = ['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small', 't4g.medium'] as const;

const EMPTY_CONFIG: TenantConfiguration = {
  name: '',
  contact_email: '',
  aws_region: 'ap-southeast-1',
  instance_type: 't3.micro',
  root_volume_size: 12,
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
    compiler_enabled: Boolean(tenant.compiler_enabled),
    compiler_memory_mb: Number(tenant.compiler_memory_mb || 512),
    compiler_timeout_seconds: Number(tenant.compiler_timeout_seconds || 15),
    compiler_concurrency: Number(tenant.compiler_concurrency || 2),
    domain_name: tenant.domain_name || '',
    route53_zone_id: tenant.route53_zone_id || '',
    secret_arn: tenant.secret_arn === 'configured' ? undefined : tenant.secret_arn || '',
    repository_url: tenant.repository_url,
    repository_ref: tenant.repository_ref,
  };
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function TenantManagement() {
  const { isSuperAdmin, isTenantAdmin, logout } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<TenantConfiguration>(EMPTY_CONFIG);
  const [jobs, setJobs] = useState<TenantProvisionJob[]>([]);
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
      const response = await adminApi.getTenants();
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
      const response = await adminApi.getTenantJobs(tenantId);
      setJobs(response.data);
    } catch (requestError) {
      console.error(requestError);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    if (!selectedTenant) return;
    setForm(configFromTenant(selectedTenant));
    void loadJobs(selectedTenant.id);
  }, [loadJobs, selectedTenant]);

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

  const handleConfigChange = (field: keyof TenantConfiguration, value: string | number | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCreateChange = (field: keyof CreateTenantForm, value: string | number | boolean) => {
    setCreateForm((current) => ({ ...current, [field]: value }));
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
      await adminApi.updateTenant(selectedTenant.id, form);
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
      const response = await adminApi.createTenant(createForm);
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
    void performAction('approve', () => adminApi.approveTenant(selectedTenant.id), 'Tenant approved. You can now run a plan.');
  };

  const handleSuspend = () => {
    if (!selectedTenant || !window.confirm(`Suspend ${selectedTenant.name}?`)) return;
    void performAction('suspend', () => adminApi.suspendTenant(selectedTenant.id), 'Tenant suspended. Existing infrastructure was not destroyed.');
  };

  const handlePlan = () => {
    if (!selectedTenant) return;
    void performAction('plan', () => adminApi.planTenant(selectedTenant.id), 'Terraform plan queued.');
  };

  const handleProvision = () => {
    if (!selectedTenant || !window.confirm(`Create or update the AWS server for ${selectedTenant.name}? This may incur AWS costs.`)) return;
    void performAction('provision', () => adminApi.provisionTenant(selectedTenant.id), 'Terraform apply queued.');
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

  if (loading) return <div className="loading">Loading tenant control plane...</div>;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <span className="eyebrow">E-PROC CONTROL PLANE</span>
          <h1>{isSuperAdmin ? 'Tenant operations' : 'My tenant workspace'}</h1>
          <p>{isSuperAdmin ? 'Approve customer environments and control every Terraform deployment.' : 'Configure your environment and submit changes for platform approval.'}</p>
        </div>
        <div className="topbar-actions">
          {isSuperAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>New tenant</button>}
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
          {isSuperAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create tenant</button>}
        </section>
      ) : (
        <div className={`tenant-layout ${isTenantAdmin ? 'tenant-layout-single' : ''}`}>
          {isSuperAdmin && (
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
          )}

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
                {selectedTenant.app_url && <a className="btn btn-secondary" href={selectedTenant.app_url} target="_blank" rel="noreferrer">Open server</a>}
              </div>

              {selectedTenant.status === 'pending' && (
                <div className="approval-banner">
                  <span>Configuration waiting for platform review.</span>
                  {isSuperAdmin && <button className="btn btn-primary" disabled={!!action} onClick={handleApprove}>Approve tenant</button>}
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
                  <label className="field checkbox-field"><span>Practice compiler</span><span><input type="checkbox" checked={form.compiler_enabled} onChange={(event) => handleConfigChange('compiler_enabled', event.target.checked)} /> Execute Run Code with AWS Lambda</span></label>
                  {form.compiler_enabled && <label className="field"><span>Compiler memory (MB)</span><input type="number" min={256} max={3008} step={64} value={form.compiler_memory_mb} onChange={(event) => handleConfigChange('compiler_memory_mb', Number(event.target.value))} /></label>}
                  {form.compiler_enabled && <label className="field"><span>Compiler timeout (seconds)</span><input type="number" min={10} max={30} value={form.compiler_timeout_seconds} onChange={(event) => handleConfigChange('compiler_timeout_seconds', Number(event.target.value))} /></label>}
                  {form.compiler_enabled && <label className="field"><span>Reserved concurrency</span><input type="number" min={1} max={20} value={form.compiler_concurrency} onChange={(event) => handleConfigChange('compiler_concurrency', Number(event.target.value))} /></label>}
                  <label className="field"><span>Domain name</span><input placeholder="customer.example.com" value={form.domain_name} onChange={(event) => handleConfigChange('domain_name', event.target.value)} /></label>
                  <label className="field"><span>Repository</span><input value={form.repository_url} onChange={(event) => handleConfigChange('repository_url', event.target.value)} required /></label>
                  <label className="field"><span>Branch / tag</span><input value={form.repository_ref} onChange={(event) => handleConfigChange('repository_ref', event.target.value)} required /></label>
                  {isSuperAdmin && <label className="field"><span>Route53 zone ID</span><input value={form.route53_zone_id || ''} onChange={(event) => handleConfigChange('route53_zone_id', event.target.value)} /></label>}
                  {isSuperAdmin && <label className="field field-wide"><span>AWS Secrets Manager ARN</span><input type="password" autoComplete="off" placeholder="arn:aws:secretsmanager:..." value={form.secret_arn || ''} onChange={(event) => handleConfigChange('secret_arn', event.target.value)} /></label>}
                </div>
                <div className="form-footer">
                  <p>Secrets remain in AWS Secrets Manager. Only the ARN is stored here.</p>
                  <button className="btn btn-primary" type="submit" disabled={saving || ['planning', 'applying'].includes(selectedTenant.provision_status)}>{saving ? 'Saving...' : 'Save configuration'}</button>
                </div>
              </form>

              <section className="provision-card">
                <div className="section-heading"><div><span className="eyebrow">INFRASTRUCTURE</span><h3>Terraform deployment</h3></div>{latestJob && <span className={`status-badge job-${latestJob.status}`}>{statusLabel(latestJob.status)}</span>}</div>
                <div className="resource-grid">
                  <div><span>Instance</span><strong>{selectedTenant.instance_id || 'Not created'}</strong></div>
                  <div><span>Public IP</span><strong>{selectedTenant.public_ip || 'Pending'}</strong></div>
                  <div><span>Practice compiler</span><strong>{selectedTenant.compiler_enabled ? (selectedTenant.compiler_lambda_arn || 'Pending Lambda') : 'Local / EC2'}</strong></div>
                  <div><span>State</span><strong>{selectedTenant.terraform_state_key || `tenants/${selectedTenant.slug}/terraform.tfstate`}</strong></div>
                </div>
                {selectedTenant.last_error && <div className="notice notice-error"><strong>Last error:</strong> {selectedTenant.last_error}</div>}
                {isSuperAdmin && (
                  <div className="provision-actions">
                    <button className="btn btn-secondary" disabled={selectedTenant.status !== 'approved' || !!action} onClick={handlePlan}>{action === 'plan' ? 'Queuing...' : 'Run plan'}</button>
                    <button className="btn btn-primary" disabled={selectedTenant.status !== 'approved' || !hasReviewedPlan || !!action} onClick={handleProvision}>{action === 'provision' ? 'Queuing...' : 'Create / update server'}</button>
                    <button className="btn btn-danger-outline" disabled={selectedTenant.status === 'suspended' || !!action} onClick={handleSuspend}>Suspend access</button>
                  </div>
                )}
                {latestJob?.log_output && (
                  <details className="terraform-log">
                    <summary>Latest Terraform log · {new Date(latestJob.created_at).toLocaleString()}</summary>
                    <pre>{latestJob.log_output}</pre>
                  </details>
                )}
              </section>
            </section>
          )}
        </div>
      )}

      {showCreate && isSuperAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-tenant-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><span className="eyebrow">ONBOARD CUSTOMER</span><h2 id="create-tenant-title">Create tenant</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShowCreate(false)}>×</button></div>
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <label className="field"><span>Customer name</span><input value={createForm.name} onChange={(event) => handleCreateChange('name', event.target.value)} required /></label>
                <label className="field"><span>Stable slug</span><input placeholder="acme-vietnam" value={createForm.slug} onChange={(event) => handleCreateChange('slug', event.target.value.toLowerCase())} required pattern="[a-z][a-z0-9-]{2,30}" /></label>
                <label className="field"><span>Contact email</span><input type="email" value={createForm.contact_email} onChange={(event) => handleCreateChange('contact_email', event.target.value)} required /></label>
                <label className="field"><span>Tenant admin username</span><input value={createForm.admin_username} onChange={(event) => handleCreateChange('admin_username', event.target.value)} required minLength={3} /></label>
                <label className="field field-wide"><span>Tenant admin password</span><input type="password" autoComplete="new-password" value={createForm.admin_password} onChange={(event) => handleCreateChange('admin_password', event.target.value)} required minLength={8} maxLength={128} /></label>
              </div>
              <div className="form-footer"><p>The customer can configure infrastructure but cannot approve or provision it.</p><div className="button-row"><button className="btn btn-ghost" type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create workspace'}</button></div></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default TenantManagement;
