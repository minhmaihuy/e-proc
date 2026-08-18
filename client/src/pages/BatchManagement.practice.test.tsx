import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import BatchManagement from './BatchManagement';

const apiMocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  getBatches: vi.fn(),
  getModuleGroupStats: vi.fn(),
  getModuleGroupTypeStats: vi.fn(),
  getModuleGroups: vi.fn(),
  getModuleStats: vi.fn(),
  getModuleTypeStats: vi.fn(),
  getModules: vi.fn(),
  getPracticeExams: vi.fn(),
  getRecordingConfig: vi.fn(),
  getTypeStats: vi.fn(),
}));

vi.mock('../services/api', () => ({
  adminApi: apiMocks,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, userId: 1 }),
}));

vi.mock('../components/AdminNav', () => ({
  default: () => null,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <BatchManagement />
    </MemoryRouter>,
  );
}

describe('BatchManagement Practice creation', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getRecordingConfig.mockResolvedValue({
      data: {
        allowed_record_modes: ['none'],
        can_change: true,
        s3_configured: false,
        identity_verification: 'off',
        identity_s3_configured: false,
      },
    });
    apiMocks.getBatches.mockResolvedValue({ data: [] });
    apiMocks.getModules.mockResolvedValue({ data: [] });
    apiMocks.getModuleGroups.mockResolvedValue({ data: [] });
    apiMocks.getModuleGroupStats.mockResolvedValue({ data: [] });
    apiMocks.getModuleGroupTypeStats.mockResolvedValue({ data: [] });
    apiMocks.getModuleStats.mockResolvedValue({ data: [] });
    apiMocks.getTypeStats.mockResolvedValue({ data: [] });
    apiMocks.getModuleTypeStats.mockResolvedValue({ data: [] });
    apiMocks.getPracticeExams.mockResolvedValue({
      data: [{ id: 7, name: 'Practice C++', created_at: '2026-08-18T00:00:00.000Z', batches_count: 0 }],
    });
    apiMocks.createBatch.mockResolvedValue({ data: { id: 99 } });
  });

  it('enables submission and sends practice_exam_id without a blueprint', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Create New Batch' }));
    await user.click(screen.getByRole('radio', { name: /Practice/ }));

    const practiceSelect = await screen.findByLabelText('Đề Practice');
    await user.selectOptions(practiceSelect, '7');

    const createButton = screen.getByRole('button', { name: 'Create Batch' });
    expect(createButton).toBeEnabled();

    await user.type(screen.getByPlaceholderText('e.g. Midterm Fall 2023'), 'Practice Test');
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(dateInputs).toHaveLength(2);
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-19T08:00' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-19T09:00' } });

    await user.click(createButton);

    await waitFor(() => expect(apiMocks.createBatch).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createBatch.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      name: 'Practice Test',
      duration: 30,
      practice_exam_id: 7,
      record_mode: 'none',
      exam_type: 'essay',
      identity_verification: 'off',
    }));
    expect(payload).not.toHaveProperty('blueprint');
    expect(await screen.findByText('Invite Students to Batch #99')).toBeInTheDocument();
  });
});
