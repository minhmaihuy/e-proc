import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import RoleLoginForm from './RoleLoginForm';

const defaultProps = {
  theme: 'tenant' as const,
  brandLabel: 'E-PROC TENANT WORKSPACE',
  heroTitle: 'Secure assessment operations',
  heroDescription: 'Manage one tenant without crossing ownership boundaries.',
  features: ['Question banks', 'Results', 'Tenant users'],
  accessLabel: 'TENANT ADMIN ACCESS',
  title: 'Sign in to your workspace',
  subtitle: 'Use a tenant-scoped account.',
  submitLabel: 'Continue to dashboard',
  alternatePrompt: 'Manage infrastructure?',
  alternateLabel: 'Open the control plane',
  alternatePath: '/tenant/login',
};

function renderLogin(onLogin = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MemoryRouter>
      <RoleLoginForm {...defaultProps} onLogin={onLogin} />
    </MemoryRouter>,
  );
  return onLogin;
}

describe('RoleLoginForm', () => {
  it('renders an accessible role-scoped login and alternate portal link', () => {
    renderLogin();

    expect(screen.getByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Open the control plane' })).toHaveAttribute('href', '/tenant/login');
    expect(screen.queryByText(/initialize admin account/i)).not.toBeInTheDocument();
  });

  it('submits trimmed credentials and supports password visibility', async () => {
    const user = userEvent.setup();
    const onLogin = renderLogin();

    await user.type(screen.getByLabelText('Username'), '  tenant-admin  ');
    await user.type(screen.getByLabelText('Password'), 'secure-password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Continue to dashboard' }));

    expect(onLogin).toHaveBeenCalledWith('tenant-admin', 'secure-password');
  });

  it('shows the bounded API error and restores the submit action', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockRejectedValue({ response: { data: { error: 'Wrong portal for this role.' } } });
    renderLogin(onLogin);

    await user.type(screen.getByLabelText('Username'), 'superadmin');
    await user.type(screen.getByLabelText('Password'), 'invalid-password');
    await user.click(screen.getByRole('button', { name: 'Continue to dashboard' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong portal for this role.');
    expect(screen.getByRole('button', { name: 'Continue to dashboard' })).toBeEnabled();
  });
});
