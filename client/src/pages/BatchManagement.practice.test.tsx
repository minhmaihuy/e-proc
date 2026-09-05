import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  updateBatch: vi.fn(),
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
    apiMocks.updateBatch.mockResolvedValue({ data: { success: true } });
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

  it('offers only superadmin-granted recording modes and submits Local for this batch', async () => {
    apiMocks.getRecordingConfig.mockResolvedValue({
      data: {
        allowed_record_modes: ['none', 'local'],
        can_change: true,
        s3_configured: false,
        identity_verification: 'off',
        identity_s3_configured: false,
      },
    });
    const user = userEvent.setup();
    const { container } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Create New Batch' }));
    await user.click(screen.getByRole('radio', { name: /Practice/ }));
    await user.selectOptions(await screen.findByLabelText('Đề Practice'), '7');

    const recordingSelect = screen.getByLabelText('Screen recording for this batch');
    expect(within(recordingSelect).getByRole('option', { name: 'No recording' })).toBeInTheDocument();
    expect(within(recordingSelect).getByRole('option', { name: /Record Local/ })).toBeInTheDocument();
    expect(within(recordingSelect).queryByRole('option', { name: /Record S3/ })).not.toBeInTheDocument();
    await user.selectOptions(recordingSelect, 'local');

    await user.type(screen.getByPlaceholderText('e.g. Midterm Fall 2023'), 'Recorded Practice');
    const dateInputs = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-19T08:00' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-19T09:00' } });
    await user.click(screen.getByRole('button', { name: 'Create Batch' }));

    await waitFor(() => expect(apiMocks.createBatch).toHaveBeenCalledTimes(1));
    expect(apiMocks.createBatch).toHaveBeenCalledWith(expect.objectContaining({
      practice_exam_id: 7,
      record_mode: 'local',
    }));
  });

  it('explains why default-only monitoring controls cannot be changed', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Create New Batch' }));

    expect(await screen.findByLabelText('Screen recording for this batch')).toBeDisabled();
    expect(screen.getByLabelText('Identity verification')).toBeDisabled();
    expect(screen.getByText(/Superadmin cần bật Local hoặc S3/)).toBeInTheDocument();
    expect(screen.getByText(/ảnh giấy tờ tùy thân và ảnh khuôn mặt hiện tại/)).toBeInTheDocument();
    expect(screen.getByText(/không tự động nhận diện khuôn mặt/)).toBeInTheDocument();
    expect(screen.getByText(/Dropdown được giữ ở Off/)).toBeInTheDocument();
  });

  it('disables the edit selector without tenant-admin permission and preserves a revoked stored mode', async () => {
    apiMocks.getRecordingConfig.mockResolvedValue({
      data: {
        allowed_record_modes: ['none', 'local'],
        can_change: false,
        s3_configured: false,
        identity_verification: 'off',
        identity_s3_configured: false,
      },
    });
    apiMocks.getBatches.mockResolvedValue({
      data: [{
        id: 12,
        name: 'Existing batch',
        start_time: '2026-08-19T01:00:00.000Z',
        end_time: '2026-08-19T02:00:00.000Z',
        duration: 60,
        blueprint: [],
        record_mode: 's3',
        identity_verification: 'off',
        exam_type: 'essay',
        created_by: 1,
      }],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const recordingSelect = screen.getByLabelText('Screen recording for this batch');
    expect(recordingSelect).toBeDisabled();
    expect(recordingSelect).toHaveValue('s3');
    const revokedOption = within(recordingSelect).getByRole('option', { name: /no longer granted by superadmin/ });
    expect(revokedOption).toBeDisabled();
    expect(within(recordingSelect).getByRole('option', { name: /Record Local/ })).toBeInTheDocument();
    expect(screen.getByText(/A tenant admin must choose an available mode/)).toBeInTheDocument();
    expect(screen.queryByText(/Choose an available mode before saving this batch/)).not.toBeInTheDocument();
  });

  it('lets tenant admin reconcile a revoked stored photo mode to Off before saving', async () => {
    apiMocks.getRecordingConfig.mockResolvedValue({
      data: {
        allowed_record_modes: ['none', 'local'],
        can_change: true,
        s3_configured: false,
        identity_verification: 'off',
        identity_s3_configured: false,
      },
    });
    apiMocks.getBatches.mockResolvedValue({
      data: [{
        id: 13,
        name: 'Legacy photo batch',
        start_time: '2026-08-19T01:00:00.000Z',
        end_time: '2026-08-19T02:00:00.000Z',
        duration: 60,
        blueprint: [],
        record_mode: 'none',
        identity_verification: 'photo',
        exam_type: 'essay',
        created_by: 1,
      }],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const identitySelect = screen.getByLabelText('Identity verification for this batch');
    expect(identitySelect).toHaveValue('photo');
    expect(within(identitySelect).getByRole('option', { name: /no longer granted by superadmin/ })).toBeDisabled();
    expect(within(identitySelect).getByRole('option', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByText(/Choose Off before saving this batch/)).toBeInTheDocument();

    await user.selectOptions(identitySelect, 'off');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(apiMocks.updateBatch).toHaveBeenCalledTimes(1));
    expect(apiMocks.updateBatch).toHaveBeenCalledWith(13, expect.objectContaining({
      record_mode: 'none',
      identity_verification: 'off',
    }));
  });
});
