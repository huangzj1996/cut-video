# 花生AI（妙剪 Magicut）

AI 视频创作桌面工具：本地素材 + 文稿 → 聊天式需求确认 → 四阶段生成（准备、分镜、配音、视频） → 四轨编辑 → 预览 → 导出 16:9 MP4。

当前处于 **T01 工程脚手架** 阶段：Electron + React + TypeScript + Vite + Forge + pnpm workspace。已按原型落地创作页、工作台、创作消息页，以及编辑器「画面 / 口播 / 字幕 / 音乐」四个静态视图；工作台已接入项目文件 IPC（列表 / 创建 / 删除），创作页已接入素材路径扫描与视频元数据解析（创建时执行），创作消息页与编辑器仍为 mock 数据，不含真实 AI、预览、时间线编辑与导出。

## 项目结构

```text
miaoma-magicut/
├── apps/
│   └── desktop/                 # Electron 桌面应用
│       ├── client/              # 渲染进程 React 代码
│       ├── main/                # 主进程代码
│       ├── preload/             # 预加载脚本
│       ├── shared/              # 主进程/预加载/渲染进程共享类型
│       ├── resources/ffmpeg/    # 打包用 FFmpeg/ffprobe（二进制不提交）
│       └── forge.config.ts      # Electron Forge 构建配置
├── packages/
│   ├── video-agent/             # 视频剪辑智能体核心（LangGraph）
│   └── video-project/           # 视频项目数据模型（Zod Schema）
├── docs/
│   ├── requirements/            # 需求文档与任务清单
│   └── design/                  # 原型文件
├── .agents/                     # AI 技能配置与提示词模板
├── .github/                     # CI/CD 工作流
├── package.json                 # Monorepo 根配置与公共脚本
├── pnpm-workspace.yaml          # pnpm workspace 配置
└── tsconfig.base.json           # 全局 TypeScript 基础配置
```

## 环境要求

- Node.js >= 20.19.0（当前开发环境 20.19.2）
- pnpm >= 10（当前 10.28.1）
- Windows 10/11（首发平台）

> LangChain 包已按 Node 20 兼容性锁定：`@langchain/openai` 使用 1.5.0（1.6.x 要求 Node >= 22）。

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动 Electron 开发模式
pnpm typecheck        # 全仓库类型检查
pnpm test             # 全仓库单元测试
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm package          # 打包 Electron 应用（不生成安装包）
pnpm make             # 生成 Windows 安装包
```

## 页面路由

- `#/create` 创作页（默认）
- `#/workspace` 工作台
- `#/create-chat` 创作消息页
- `#/editor` 四轨编辑器
- `#/status` 脚手架状态页

## 项目文件与 IPC

- 工程文件位于 `defaultProjectDirectory/<projectId>/project.json`，包含 `schemaVersion`（当前 `1.0.0`）。
- 渲染进程只通过 `window.miaoma.project` 调用 `list` / `get` / `create` / `update` / `delete`。
- IPC 通道：`project:list`、`project:get`、`project:create`、`project:update`、`project:delete`。
- 写入使用临时文件 + rename；项目 ID 经过白名单校验，所有操作限制在工程根目录内。
- 主进程只返回结构化 `IpcResponse`，不向渲染进程暴露文件路径、原始异常或 `ipcRenderer`。
- 创作页可输入本机视频素材目录或文件路径；点击创建时扫描并按 ffprobe 解析时长、显示/编码分辨率、帧率、编码、旋转、VFR、HDR、码率和音频流等元数据，`ProjectAssets` 保存时间线字段，完整探测结果写入 `inputs/assets.json`。ffprobe 未配置时创建会返回明确错误。

## 文档

- [需求文档 v1.1](docs/requirements/花生AI_妙剪Magicut_需求文档_v1.1.md)
- [任务清单 v1.1](docs/requirements/花生AI_妙剪Magicut_任务清单_v1.1.md)
- [需求文档 v1.0（历史）](docs/requirements/花生AI桌面创作工具_需求文档_v1.0.md)
- [前端原型](docs/design/miaoma-magicut.pen)

## 约定

- `docs/design/miaoma-magicut.pen` 是唯一前端 UI 依据；需求文档负责行为、数据与验收。
- IPC 通道统一使用 `模块:动作` 命名（如 `settings:get`）；每个通道只做一件事；通道名、参数类型、返回值类型和错误结构集中在 `apps/desktop/shared/ipc-contract.ts`。主进程异常统一返回 `IpcResponse`，不把原始异常或堆栈传给渲染进程。
- API 密钥不进入仓库、工程文件、日志或消息；首版使用主进程 `safeStorage`。
- FFmpeg/ffprobe 二进制不提交。开发态回退到系统 `PATH`；打包前放入 `apps/desktop/resources/ffmpeg/`。
- 所有时间使用非负整数毫秒，导出按 30fps 量化。
