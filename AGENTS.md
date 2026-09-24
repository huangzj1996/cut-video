# Repository Guidelines

## 项目结构与模块划分

本仓库是 pnpm monorepo。桌面端按运行边界划分：`apps/desktop/src/main/` 放 Electron 主进程，`renderer/` 放 React 页面与 Tailwind 样式，`preload/` 放预加载入口，`shared/` 放跨进程共用的纯 TypeScript 代码。`apps/desktop/tests/` 按相同模块划分测试；本地示例素材放在已忽略的 `src/renderer/assets/`，需要提交的素材应确认来源后调整忽略规则。`packages/video-project` 定义项目与素材类型；`packages/video-agent` 提供智能助手占位接口。生成的 `dist/`、`.vite/` 和 `out/` 不应提交。

## 构建、测试与开发命令

使用 Node.js 20.19+、pnpm 10，并在仓库根目录运行：

- `pnpm install --frozen-lockfile`：按锁文件安装工作区依赖。
- `pnpm start`：构建本地包并通过 Vite 启动桌面应用。
- `pnpm build:packages`：编译两个共享 TypeScript 包。
- `pnpm typecheck`：构建共享包并检查桌面端 TypeScript。
- `pnpm test`：构建共享包并运行 Vitest 模块测试。
- `pnpm build`：将 Windows 应用打包到 `apps/desktop/out/`。
- `pnpm make`：在 `apps/desktop/out/make/` 生成 Windows 安装包和 ZIP。

目前没有 lint 脚本。修改 Forge 入口时同步检查 `forge.config.ts`、`index.html` 与 `.vite/build/` 中的产物名称。

## 编码风格与命名

TypeScript 沿用现有文件的两空格缩进、单引号和分号。React 组件及接口使用 PascalCase，函数和变量使用 camelCase，包目录使用 kebab-case。Electron 与文件系统操作放在主进程或预加载脚本中；渲染进程使用 React 和 Tailwind，不启用 Node 集成。工作区依赖使用 `workspace:*`。

## 测试要求

测试使用 Vitest，文件放在 `apps/desktop/tests/<模块>/`，命名为 `*.test.ts` 或 `*.test.tsx`。目前没有覆盖率目标；预加载脚本尚无对外行为，因此该模块暂为空。提交前运行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`；修改桌面交互时再用 `pnpm start` 人工检查。

## 提交与拉取请求

提交信息建议使用简短的 `type(scope): summary` 格式，例如 `feat(desktop): add timeline shell`。拉取请求应说明改动、列出验证命令、关联相关 issue；界面改动附截图。若升级 Electron，需同步更新 `forge.config.ts` 中锁定的 Windows 安装包校验值。
