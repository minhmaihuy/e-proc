import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Monaco failed to mount');
  return <p>Nội dung bình thường</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React log lỗi ra console khi boundary bắt được — im lặng để output test sạch.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hiển thị con bình thường khi không có lỗi', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Nội dung bình thường')).toBeInTheDocument();
  });

  it('bắt lỗi render thay vì để trắng màn hình', () => {
    render(
      <ErrorBoundary area="trang làm bài">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Đã xảy ra lỗi hiển thị/)).toBeInTheDocument();
    expect(screen.getByText(/trang làm bài/)).toBeInTheDocument();
  });

  it('nêu thông điệp lỗi để thí sinh đọc cho giám thị', () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Monaco failed to mount')).toBeInTheDocument();
  });

  it('chỉ trấn an về bài đã lưu khi được yêu cầu', () => {
    const { unmount } = render(
      <ErrorBoundary reassureSavedWork>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/vẫn được lưu trên máy chủ/)).toBeInTheDocument();
    unmount();

    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    // Trang quản trị không có bài làm nào để trấn an — nói vậy sẽ gây hiểu nhầm.
    expect(screen.queryByText(/vẫn được lưu trên máy chủ/)).not.toBeInTheDocument();
  });

  it('nút tải lại gọi window.location.reload', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Tải lại trang/ }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
