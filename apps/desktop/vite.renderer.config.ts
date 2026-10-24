import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  plugins: [react()],
  optimizeDeps: {
    // workspace 包默认不预构建；首屏加载后才优化会触发整页 reload（窗口短暂空白）。
    include: ['@miaoma/video-project'],
  },
  build: {
    // renderer root 是 client/，必须把输出固定回 desktop/.vite，
    // 否则主进程按 ../renderer/<name>/index.html 找不到页面。
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
