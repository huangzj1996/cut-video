import { defineConfig } from 'vite';

// Forge 的 Vite 插件会合并 main 进程的入口、CJS 输出与 Electron 外部依赖配置。
export default defineConfig({
  build: {
    sourcemap: true,
  },
});
