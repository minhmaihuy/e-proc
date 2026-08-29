import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TenantManagement from './TenantManagement';

const apiMocks = vi.hoisted(() => ({
  getTenants: vi.fn(),
  getTenantJobs: vi.fn(),
  getTenantIssues: vi.fn(),
  updateTenant: vi.fn(),
}));

vi.mock('../services/tenantControlApi', () => ({
  tenantControlApi: {
    ...apiMocks,
    approveTenant: vi.fn(),
    changePassword: vi.fn(),
    createTenant: vi.fn(),
    planTenant: vi.fn(),
    provisionTenant: vi.fn(),
    suspendTenant: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('../components/SecretsPanel', () => ({ default: () => null }));
vi.mock('./tenant/TenantIssuesPanel', () => ({ default: () => null }));

const legacyTenant = {
  id: 7,
  slug: 'legacy-school',
  name: 'Legacy School',
  contact_email: 'admin@legacy.example',
  status: 'pending' as const,
  aws_region: 'ap-southeast-1',
  instance_type: 't3.micro',
  root_volume_size: 12,
  backup_retention_days: 14,
  email_enabled: false,
  email_daily_limit: 200,
  identity_verification: 'photo' as const,
  identity_retention_days: null,
  recording_retention_days: null,
  allowed_record_modes: 'none',
  compiler_enabled: false,
  compiler_memory_mb: 512,
  compiler_timeout_seconds: 15,
  compiler_concurrency: 2,
  domain_name: 'epoc.legacy-school.devfasttrack.com',
  route53_zone_id: 'legacy/hosted-zone',
  secret_arn: '',
  repository_url: 'https://github.com/minhmaihuy/e-proc.git',
  repository_ref: 'main',
  provision_status: 'not_started' as const,
  created_at: '2026-08-01T00:00:00.000Z',
};

describe('TenantManagement draft update', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getTenants.mockResolvedValue({ data: [legacyTenant] });
    apiMocks.getTenantJobs.mockResolvedValue({ data: [] });
    apiMocks.getTenantIssues.mockResolvedValue({ data: [] });
    apiMocks.updateTenant.mockResolvedValue({ data: { success: true, status: 'pending' } });
  });

  it('saves Local recording even when unrelated legacy draft values are invalid', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TenantManagement />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByLabelText('Route53 zone ID')).toHaveValue('legacy/hosted-zone'));
    await user.click(screen.getByRole('checkbox', { name: /Record Local/ }));
    await user.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() => expect(apiMocks.updateTenant).toHaveBeenCalledTimes(1));
    expect(apiMocks.updateTenant).toHaveBeenCalledWith(7, expect.objectContaining({
      allowed_record_modes: 'none,local',
      identity_verification: 'photo',
      identity_retention_days: null,
      recording_retention_days: null,
      route53_zone_id: 'legacy/hosted-zone',
    }));
  });
});
