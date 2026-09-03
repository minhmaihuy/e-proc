import { Component, ErrorInfo, ReactNode } from 'react';

/**
 * Chặn lỗi render để một component hỏng không làm trắng cả ứng dụng.
 *
 * Với hệ thống thi, màn hình trắng giữa buổi thi là sự cố nặng: thí sinh mất luôn
 * giao diện làm bài dù bài làm vẫn nằm trên server (client debounce lưu 2 giây/lần).
 * Boundary này giữ lại thông điệp trấn an đó và cho phép tải lại để quay về đúng bài
 * đang làm, thay vì bỏ mặc màn hình trắng không giải thích.
 *
 * Phải là class component — React chưa có hook tương đương getDerivedStateFromError.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Mô tả khu vực để thông báo nói đúng ngữ cảnh, vd "trang làm bài". */
  area?: string;
  /** Bài thi cần trấn an về dữ liệu đã lưu; trang admin thì không cần. */
  reassureSavedWork?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // console.* bị esbuild.drop xóa khỏi bản production, nên đây chỉ phục vụ lúc dev.
    console.error('[ErrorBoundary]', this.props.area ?? 'app', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { area = 'giao diện', reassureSavedWork = false } = this.props;

    return (
      <div
        role="alert"
        style={{
          maxWidth: 560,
          margin: '80px auto',
          padding: 28,
          borderRadius: 12,
          border: '1px solid var(--border, #e5e7eb)',
          background: 'var(--surface, #fff)',
          textAlign: 'center',
        }}
      >
        <h2 style={{ margin: '0 0 10px' }}>Đã xảy ra lỗi hiển thị</h2>
        <p style={{ color: 'var(--text-light, #6b7280)', lineHeight: 1.7, margin: '0 0 6px' }}>
          Không tải được {area}. Đây là lỗi phía trình duyệt, không phải do thao tác của bạn.
        </p>
        {reassureSavedWork && (
          <p style={{ color: 'var(--text-light, #6b7280)', lineHeight: 1.7, margin: '0 0 6px' }}>
            <strong>Bài làm của bạn vẫn được lưu trên máy chủ.</strong> Tải lại trang để quay về
            đúng câu đang làm; thời gian làm bài do máy chủ giữ nên không bị mất.
          </p>
        )}
        {Boolean(error.message?.includes('dynamically imported module')) && (
          <p style={{ color: '#0369a1', background: '#f0f9ff', padding: '8px 12px', borderRadius: 6, fontSize: 13, margin: '10px 0' }}>
            Hệ thống vừa có bản cập nhật mới. Nhấn <strong>Tải lại trang</strong> bên dưới để tải phiên bản mới nhất.
          </p>
        )}
        <p style={{ color: 'var(--text-light, #6b7280)', fontSize: 13, margin: '14px 0 18px' }}>
          Nếu tải lại vẫn lỗi, báo cho giám thị kèm nội dung sau:
        </p>
        <code
          style={{
            display: 'block',
            padding: 10,
            borderRadius: 6,
            background: 'var(--bg, #f8f8f8)',
            fontSize: 12,
            textAlign: 'left',
            overflowWrap: 'anywhere',
          }}
        >
          {error.message || error.name || 'Unknown render error'}
        </code>
        <button type="button" className="btn btn-primary" style={{ marginTop: 18 }} onClick={this.handleReload}>
          Tải lại trang
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
