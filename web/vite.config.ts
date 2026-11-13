import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

function apiPort(): string {
  try {
    const text = fs.readFileSync(path.join(root, '..', '.env'), 'utf8');
    return /^PORT\s*=\s*(\d+)/m.exec(text)?.[1] || '8787';
  } catch {
    return '8787';
  }
}

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort()}`,
        configure: (proxy) => {
          proxy.on('error', (_error, _request, response) => {
            // 直接断开浏览器侧连接：EventSource 把断连当临时网络错误会继续重试。
            // 不能回 502 —— Chrome 对非 200 状态码会永久停止重连（CLOSED）
            response?.destroy?.();
          });
        },
      },
      '/assets': `http://127.0.0.1:${apiPort()}`,
      '/exports': `http://127.0.0.1:${apiPort()}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'zustand'],
          flow: ['@xyflow/react'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
