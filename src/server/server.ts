import dotenv from 'dotenv';
import { AppSecretsError, isAppSecretsEnabled, loadAppSecrets } from './services/appSecrets.js';

dotenv.config();

// Secrets Manager phải nạp xong TRƯỚC khi import ./index.js: module đó kiểm tra
// JWT_SECRET và đọc DATABASE_URL ngay lúc load, nên static import sẽ chạy quá sớm.
// Mặc định tính năng tắt → loadAppSecrets() trả về ngay, không gọi AWS, hành vi như cũ.
async function bootstrap(): Promise<void> {
  try {
    const loaded = await loadAppSecrets();
    if (loaded) {
      console.log(
        `[Secrets] Đã nạp ${loaded.appliedKeys.length} khóa từ Secrets Manager: ${loaded.appliedKeys.join(', ')}`,
      );
      if (loaded.ignoredKeys.length > 0) {
        console.warn(`[Secrets] Bỏ qua khóa ngoài danh sách quản lý: ${loaded.ignoredKeys.join(', ')}`);
      }
    } else if (isAppSecretsEnabled(process.env)) {
      console.log('[Secrets] Đang bật nhưng không nạp được khóa nào.');
    }
  } catch (error) {
    const message = error instanceof AppSecretsError ? error.message : 'Không nạp được cấu hình từ Secrets Manager.';
    console.error(`FATAL: ${message}`);
    console.error('Đặt APP_SECRETS_ENABLED=false để quay lại đọc cấu hình từ .env.');
    process.exit(1);
  }

  const { default: app, initialization } = await import('./index.js');
  const PORT = parseInt(process.env.PORT || '3001');
  let server: ReturnType<typeof app.listen> | null = null;

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (!server) {
      process.exit(0);
    }
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  try {
    await initialization;
  } catch (error) {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
    console.log(`API Base: http://localhost:${PORT}/api`);
  });
}

void bootstrap();
