import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LiveMonitor from './LiveMonitor';

const apiMocks = vi.hoisted(() => ({
  getLiveStudents: vi.fn(),
  createLiveSession: vi.fn(),
  endLiveSession: vi.fn(),
}));
const viewerMocks = vi.hoisted(() => ({ startLiveViewer: vi.fn() }));

vi.mock('../services/api', () => ({ adminApi: apiMocks }));
vi.mock('../services/liveViewer', () => ({ startLiveViewer: viewerMocks.startLiveViewer }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isLoading: false, isTenantAdmin: true }) }));
vi.mock('../components/AdminNav', () => ({ default: () => null }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/batches/7/live']}>
      <Routes><Route path="/admin/batches/:id/live" element={<LiveMonitor />} /></Routes>
    </MemoryRouter>,
  );
}

describe('LiveMonitor multi-student view', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    viewerMocks.startLiveViewer.mockReset();
    apiMocks.getLiveStudents.mockResolvedValue({ data: { students: [
      { id: 11, email: 'first@example.test', status: 'in_progress', exam_started_at: null },
      { id: 12, email: 'second@example.test', status: 'in_progress', exam_started_at: null },
    ] } });
    apiMocks.createLiveSession.mockImplementation(async (_batchId: number, studentId: number) => ({
      data: { enabled: true, viewerSessionId: `00000000-0000-4000-8000-${String(studentId).padStart(12, '0')}` },
    }));
    viewerMocks.startLiveViewer.mockResolvedValue({ stop: vi.fn() });
    apiMocks.endLiveSession.mockResolvedValue({ data: { success: true } });
  });

  it('opens a separate viewer session for every active student in the batch', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('first@example.test');
    await user.click(screen.getByRole('button', { name: 'Xem tất cả (2)' }));

    await waitFor(() => expect(apiMocks.createLiveSession).toHaveBeenCalledTimes(2));
    expect(apiMocks.createLiveSession).toHaveBeenCalledWith(7, 11);
    expect(apiMocks.createLiveSession).toHaveBeenCalledWith(7, 12);
    expect(viewerMocks.startLiveViewer).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('button', { name: /Dừng/ })).toHaveLength(3);
  });
});
