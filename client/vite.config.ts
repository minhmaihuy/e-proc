import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import obfuscator from 'vite-plugin-javascript-obfuscator';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Obfuscate bundle app khi BUILD production (không áp lúc dev để vẫn debug được).
    // Loại trừ Monaco + node_modules: obfuscate Monaco gần như chắc chắn vỡ editor / phình bundle.
    // Preset vừa phải: bật stringArray + base64 để chuỗi (endpoint, violation type, ngưỡng)
    // không grep thẳng ra được; KHÔNG bật controlFlowFlattening/selfDefending/debugProtection
    // ở mức nặng vì làm bundle chậm & to, và dễ gây lỗi khó chẩn đoán trên máy thí sinh.
    obfuscator({
      apply: 'build',
      // App.tsx PHẢI được loại trừ: nó chứa các import() động của lazy-route, mà
      // stringArrayThreshold:1 sẽ mã hóa luôn đường dẫn module bên trong import().
      // Khi đó rollup không phân giải tĩnh được nữa → KHÔNG emit chunk nào cho các
      // trang, build vẫn "thành công" nhưng app 404 chunk ngay khi điều hướng.
      // App.tsx chỉ có bảng route, không chứa ngưỡng chống gian lận nào cần giấu.
      exclude: [/node_modules/, /monaco-editor/, /src[\/]App\.tsx$/],
      options: {
        compact: true,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 1,          // mã hóa toàn bộ chuỗi (endpoint, message...)
        transformObjectKeys: true,        // giấu key object (vd: {suspicious_paste: ...})
        numbersToExpressions: true,       // biến số (300, 80, 3000...) thành biểu thức, khó dò ngưỡng
        renameGlobals: false,
        controlFlowFlattening: false,     // giữ tắt: nặng & dễ vỡ; ưu tiên ổn định
        deadCodeInjection: false,
        debugProtection: false,
        selfDefending: false,
        disableConsoleOutput: false,      // console đã bị esbuild.drop xử lý bên dưới
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  // Proxy cho `vite preview` (test bản build obfuscated cần gọi backend qua /api).
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ['@monaco-editor/react']
  },
  // Xóa mọi console.* và debugger khỏi output production (sạch hơn sửa 25 chỗ trong source).
  esbuild: {
    drop: ['console', 'debugger'],
  },
  build: {
    // Khóa tường minh: không phát sinh sourcemap (.map) → không khôi phục được source gốc.
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          // Tách Monaco Editor thành chunk riêng để lazy-load
          'monaco-editor': ['@monaco-editor/react']
        }
      }
    }
  }
});
