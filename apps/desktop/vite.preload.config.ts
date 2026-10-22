import { defineConfig } from 'vite';

// Forge 的 Vite 插件会合并 preload 的入口与 CJS 输出配置。
export default defineConfig({
  build: {
    sourcemap: true,
  },
});
