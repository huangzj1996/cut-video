# Cut Video

基于 Electron Forge、React 19、TypeScript、Vite 与 Tailwind CSS 4 的桌面剪辑工具项目骨架。

## 工程结构

- `apps/desktop/src/main/`：Electron 主进程与窗口配置。
- `apps/desktop/src/renderer/`：React 界面、入口与样式。
- `apps/desktop/src/preload/`：预加载脚本，未来通过受控 API 连接主进程与界面。
- `apps/desktop/src/shared/`：主进程和渲染进程共用的纯 TypeScript 代码。
- `apps/desktop/tests/`：按 `main/`、`renderer/`、`preload/`、`shared/` 划分的测试。
- `packages/video-project/`：项目与素材的基础数据类型。
- `packages/video-agent/`：智能剪辑助手的占位接口，目前不连接模型服务。

## 开发

需要 Node.js 20.19+ 和 pnpm 10。所有命令在仓库根目录执行：

```powershell
pnpm install
pnpm start
```

## 检查与打包

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm make
```

`typecheck` 检查桌面端 TypeScript；`test` 运行按模块组织的 Vitest 测试。`build` 生成 Windows 应用目录；`make` 使用 Electron Forge 生成 Windows 安装包和 ZIP。输出位于 `apps/desktop/out/`。当前界面是剪辑工作区原型，尚未接入视频导入、播放、剪辑、导出或 AI 服务。本地示例媒体位于 `apps/desktop/src/renderer/assets/`，不随代码提交。
