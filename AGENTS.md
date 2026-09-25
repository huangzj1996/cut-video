# Repository Guidelines

## 项目结构与模块划分

本仓库是 pnpm monorepo。桌面端按运行边界划分：`apps/desktop/src/main/` 放 Electron 主进程，`renderer/` 放 React 页面与 Tailwind 样式，`preload/` 放预加载入口，`shared/` 放跨进程共用的纯 TypeScript 代码。渲染进程的静态数据放在 `renderer/constants/`，公共类型放在 `renderer/types/`，组件按功能放在 `renderer/components/` 的子目录。`apps/desktop/tests/` 按模块划分测试；本地示例素材放在已忽略的 `src/renderer/assets/`，需要提交的素材应确认来源后调整忽略规则。`packages/video-project` 定义项目与素材类型；`packages/video-agent` 提供智能助手占位接口。生成的 `dist/`、`.vite/` 和 `out/` 不应提交。

## 需求处理流程

每次收到新增需求，先分析目标、范围和现有实现，再拆解为可验证的开发任务，明确执行顺序与验收方式。遇到会影响方案或验收的不明确之处，先提醒需求提出者并获取详细信息。将需求分析、任务清单和实施方案提交给开发人员确认；确认前只进行只读调研和方案准备，不开始开发或修改业务代码。收到明确确认后，依次执行任务、完成验证并反馈结果。

简单改动直接列出简短任务清单；多步骤或跨模块需求使用项目级 `writing-plans` 技能，列明任务依赖、交付结果与验收命令。该技能只辅助任务拆解，不要求 TDD、逐步提交、工作树或子代理。缺陷先复现并定位根因，再按风险决定是否补充回归测试。完成前使用 `verification-before-completion` 核对实际验证结果；收到代码审查意见时使用 `receiving-code-review` 核实问题。项目级技能及上游来源见 `.agents/skills/README.md`。

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

## 桌面端状态与组件复用

跨面板使用的状态由最近的共同上层持有，再通过受控属性传给组件；不要在配置面板和预览面板分别保存同一份设置。字幕字号、预设和显示开关应实时作用于当前分镜的预览字幕，切换右侧工具后保持设置；预览缩放时确保字幕不被画布裁切。口播参数与字幕字号共用 `ConfigRange`，字幕预设数据与类型分别维护在 `constants/` 和 `types/`，不要在组件内复制选项或滑杆实现。

## 测试要求

测试使用 Vitest，文件放在 `apps/desktop/tests/<模块>/`，命名为 `*.test.ts` 或 `*.test.tsx`。目前没有覆盖率目标；预加载脚本尚无对外行为，因此该模块暂为空。修改字幕设置时验证当前分镜、字号、预设和显示开关在预览区的效果。提交前运行 `pnpm typecheck`、`pnpm test` 和 `pnpm build`；修改桌面交互时再用 `pnpm start` 人工检查。

## 提交与拉取请求

提交信息建议使用简短的 `type(scope): summary` 格式，例如 `feat(desktop): add timeline shell`。拉取请求应说明改动、列出验证命令、关联相关 issue；界面改动附截图。若升级 Electron，需同步更新 `forge.config.ts` 中锁定的 Windows 安装包校验值。
