import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Cấu hình test tách khỏi vite.config.ts: bản build production nạp plugin obfuscator,
// hoàn toàn không cần (và không nên) chạy khi test.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
