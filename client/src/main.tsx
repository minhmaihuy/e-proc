import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// Khi có bản deploy mới, Vite thay đổi hash của các chunk JS (code-split routes).
// Những tab trình duyệt mở từ trước sẽ gặp lỗi dynamic import khi điều hướng tới trang mới.
// Bắt sự kiện vite:preloadError để tự động tải lại trang nạp bundle mới nhất (chống loop bằng sessionStorage).
window.addEventListener('vite:preloadError', () => {
  const lastReload = sessionStorage.getItem('vite-preload-retry');
  const now = Date.now();
  if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
    sessionStorage.setItem('vite-preload-retry', now.toString());
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);