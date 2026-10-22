# 花生AI（妙剪 Magicut）任务清单与验收标准

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.1 |
| 更新日期 | 2026-10-23 |
| 对应需求 | `花生AI_妙剪Magicut_需求文档_v1.1.md` |
| 数据模型 | `packages/video-project`（`schemaVersion: '1.0.0'`） |
| 前端依据 | `docs/design/miaoma-magicut.pen` |
| 用途 | 把需求拆成可执行、可验收、可并行开发的任务 |

## 使用说明

- 每个任务都有目标、依赖、交付物、验收标准和明确不包含的范围。
- 验收标准使用复选框；全部勾选才算完成。
- 后端任务优先用 mock 模型/TTS 和固定素材夹具验收，不依赖真实 API。
- UI 任务以对应原型 frame 为准；验收时并排对照原型截图。
- 通用完成定义：代码合并、类型检查通过、相关测试通过、无密钥泄漏、文档/契约同步更新。

## 数据模型基线

`packages/video-project` 已落地 `VideoProjectSchema`（`schemaVersion: '1.0.0'`），是四轨工程、编辑器和导出的唯一结构契约：

- `project`：`ProjectMetadata`（projectId、contentRevision、名称、创建/修改时间）
- `canvas`：`CanvasConfig`（16:9 / 1920×1080 / 30fps）
- `render`：`RenderConfig`（MP4 / H.264 / AAC 192kbps、源声静音、字幕烧录）
- `ai`：`AiRunMetadata`（runId、模型/提供者配置版本、输入指纹）
- `assets`：`ProjectAssets`（videos / voices / music / subtitles / thumbnails）
- `scenes`：`Scene[]`
- `tracks`：`TimelineTrack[]`，video / voice / subtitle / music 四轨判别联合
- `schemaVersion`：semver 字符串，当前 `'1.0.0'`

约定：

- `VideoClip` 必须包含 `assetId`、`crop`、`transform`、`sourceStartMs`、`sourceEndMs`；图片素材的 `VideoAsset.mediaType = 'image'`，不要求 `fps`。
- `Scene` 必须引用 `voiceAssetId`、`subtitleIds`、`matchedVideoAssetIds`。
- 片段正时长、源区间、crop 边界、音量/语速范围、字幕字号由 Zod refine 校验；跨轨覆盖、重叠、总时长、ID 引用由 T15 校验。
- 新建工程在 AI 运行前没有 `ai`/分镜/轨道，使用 T04 的 `DraftProjectSchema`；AI 运行完成后升级为 `VideoProjectSchema`。
- JSON Schema 导出（`getJsonSchema()`）只覆盖结构约束，不包含 refine。

## 任务总览

| ID | 任务 | 依赖 | 预估（人日） | 风险 |
| --- | --- | --- | --- | --- |
| T01 | 工程脚手架与 Windows 打包 | 无 | 1–2 | 低 |
| T02 | LangGraph/Electron 技术验证 | T01 | 1–2 | **高** |
| T03 | Zod 契约与 IPC | T01 | 2–3 | 中 |
| T04 | 工程仓库、自动保存、备份、重定位、项目锁 | T03 | 2–3 | 中 |
| T05 | 本地素材导入、扫描、文稿与音乐输入 | T04 | 2–3 | 低 |
| T06 | 媒体预处理、关键帧、代理、字体、FFmpeg 打包 | T05 | 3–5 | 中高 |
| T07 | LangGraph 运行时、检查点、事件桥、取消 | T02、T03、T04 | 3–5 | **高** |
| T08 | ChatOpenAI 适配、能力验证、结构化输出、重试预算 | T03、T07 | 3–4 | **高** |
| T09 | analyze_assets 视觉分析 | T06、T08 | 3–5 | 中 |
| T10 | creative_brief + ProductionSpec + A1/A2 | T08、T09 | 2–3 | 中 |
| T11 | plan_scenes + scene_approval + A3 | T07、T10 | 2–3 | 中 |
| T12 | synthesize_voice 模拟 TTS | T07、T11 | 1–2 | 低 |
| T13 | match_assets 基于配音时长匹配 | T08、T09、T11、T12 | 2–3 | 中 |
| T14 | assemble_timeline 四轨组装 | T04、T12、T13 | 3–4 | 中高 |
| T15 | validate_project + save_project | T03、T14 | 2–3 | 中 |
| T16 | 创作页与创作消息页 UI | T03、T07 | 3–5 | 中高 |
| T17 | 四轨编辑器与时间线工具 | T04、T15 | 5–8 | **高** |
| T18 | 预览同步与代理 | T06、T17 | 3–5 | **高** |
| T19 | 导出重校验、FFmpeg 渲染、进度与取消 | T15、T18 | 4–6 | **高** |
| T20 | 快捷调整 EditIntent 解析与执行 | T08、T17 | 2–4 | 中 |
| T21 | Windows 打包与整体验收 | T01–T20 | 2–4 | 中 |

合计约 **51–82 人日**。按熟悉 Electron/React/TypeScript 的独立开发者估算；不熟悉 LangGraph、FFmpeg 或时间线同步时取上限，并预留 20–30% 缓冲。

---

## T01 工程脚手架与 Windows 打包

**目标**：创建可开发、可测试、可打包的 Electron + React + TypeScript + Vite 工程，并抽象 FFmpeg 路径。

**依赖**：无

**交付物**：工程骨架、开发/构建/测试脚本、Windows 打包配置、README。

**状态**：已完成（真实 FFmpeg 二进制的 `-version` 冒烟移交 T06 选型后执行）。

**验收标准**

- [x] 干净环境执行安装命令成功，`dev` 能打开 Electron 窗口并加载 React 页面。
- [x] Vite + React 插件配置完成；dev 启动通过与打包态渲染均通过。
- [x] `package` 命令生成可启动的 Windows 应用；不依赖开发服务器。
- [x] 开发态和打包态都能解析 `ffmpeg`、`ffprobe` 路径；路径解析单测通过。
- [ ] 真实 `ffmpeg`/`ffprobe` 二进制 `-version` 冒烟（T06 选定构建后执行）。
- [x] TypeScript strict、ESLint/Prettier、Vitest 配置完成；类型检查、测试、Lint、格式检查通过。
- [x] 应用设置写入 Electron `userData`；默认工程目录为 `Documents/妙剪`，支持 `MIAOMA_PROJECT_DIR` 覆盖。
- [x] README 包含安装、开发、测试、打包命令和目录说明。

**不包含**：业务功能、LangGraph、FFmpeg 实际转码。

**验证方式**：本地命令 + 打包后启动 + 渲染进程 IPC/设置冒烟。

---

## T02 LangGraph/Electron 技术验证

**目标**：在投入业务开发前，验证 LangGraph.js + LangChain.js + 自定义 JSON checkpointer + interrupt/resume 在 Electron utilityProcess 和打包应用中可行。

**依赖**：T01

**交付物**：最小 spike 应用、验证报告、go/no-go 结论与回退方案。

**验收标准**

- [ ] utilityProcess 中运行一个最小 3 节点 `StateGraph`，渲染进程能收到节点开始/结束事件。
- [ ] 自定义 JSON checkpointer 能写入/读取检查点；杀掉工作进程并重启应用后可恢复。
- [ ] `interrupt()` 能暂停；`Command({ resume })` 能继续；审批 payload 跨应用重启保留。
- [ ] `ChatOpenAI` 使用自定义 `baseURL` 完成一次图片输入 + function calling 的结构化输出；失败时记录原因并验证 `jsonMode` 降级路径。
- [ ] 打包后的 Electron 应用能运行该图，无 ESM/CJS 加载错误。
- [ ] `AbortSignal` 能取消长任务；取消/退出时能杀掉测试用的 ffmpeg 子进程。
- [ ] 报告记录版本、Electron/Node 版本、打包限制、LangGraph 与自定义调度器的取舍结论。

**不包含**：10 节点业务图、真实模型业务提示词。

**验证方式**：spike 应用 + 打包冒烟 + 书面报告。

**风险处理**：若打包或 checkpointer 卡住，记录失败点并回退自定义调度器；`NodeSpec` 与 Zod 契约不受影响。

---

## T03 Zod 契约与 IPC

**目标**：用 Zod 定义所有节点、消息、产物、审批、编辑意图、事件和 IPC 契约。

**依赖**：T01

**状态**：部分完成。`VideoProject` 五层模型、类型推导、JSON Schema 导出和正反单测已落地在 `packages/video-project`（commit `4b42578`）。剩余节点/消息/审批/编辑意图/运行事件/校验报告和 IPC 契约。

**交付物**：`packages/video-project/src/` 下的模型与 JSON Schema 导出、其余节点/消息/产物/审批/编辑意图/事件 Schema、IPC 契约、正反样例。

**验收标准**

- [ ] 10 个节点均有 InputSchema/OutputSchema；每个 Schema 至少一个正例和一个反例。
- [x] `VideoProject` 五层模型、`z.infer` 类型、JSON Schema 导出和正反单测完成（`packages/video-project`）。
- [ ] `ChatMessage` 覆盖 11 种消息类型；`ProductionSpec`、`ScenePlan`、`ApprovalResult`、`AssetMatchCollection`、`VoiceSegmentCollection`、`ValidationReport`、`EditIntent`、`RunEvent` 均有 Schema。
- [ ] TypeScript 类型由 Zod 推导，不维护重复 interface。
- [ ] 模型提交节点的 JSON Schema 可导出，并用于 function calling/json mode；`getJsonSchema()` 已提供 `VideoProject`、`Scene`、`TimelineClip` 导出。
- [ ] IPC 通道使用 `模块:动作` 命名；通道名、参数类型、返回值类型和错误结构集中在独立契约文件。
- [ ] 每个通道只承担一个职责；应用信息、设置、媒体探测不混用。
- [ ] 主进程异常统一返回 `IpcResponse`；不把原始异常、堆栈或文件路径传给渲染进程。
- [ ] IPC 请求、响应、事件通道有类型；Preload 只暴露允许的方法；渲染进程无 `ipcRenderer` 直接访问。
- [ ] 无效样例失败时返回字段路径和原因；`PROJECT_SCHEMA_VERSION` 为 semver 字符串（当前 `'1.0.0'`）。
- [ ] JSON Schema 只覆盖结构约束；`refine` 业务约束由 T15 校验，不重复实现。
- [ ] Schema 单测通过。

**不包含**：节点业务实现、UI 组件、T04 的 `DraftProjectSchema`。

**验证方式**：Vitest 正反样例 + 类型检查。

---

## T04 工程仓库、自动保存、备份、重定位、项目锁

**目标**：实现工程创建、读写、自动保存、写入队列、备份、损坏恢复、素材重新定位和单写锁。

**依赖**：T03

**交付物**：ProjectStore、`DraftProjectSchema`、自动保存调度器、备份/恢复、项目锁、测试。

**验收标准**

- [ ] 创建工程生成合法目录和 `project.json`；新建草稿使用 `DraftProjectSchema`（工程头 + 默认画布/渲染 + 空 assets/scenes/tracks，不含 `ai`），关闭重开后内容一致。
- [ ] AI 运行完成后 `project.json` 升级为 `VideoProjectSchema`（`ai` 必填），加载时能区分草稿与成片工程。
- [ ] 停止编辑 2 秒后自动保存；持续编辑最多 30 秒保存一次；Ctrl+S 立即保存。
- [ ] 同一工程写操作排队；并发保存测试不丢修订、不出现旧快照覆盖新修订。
- [ ] 先写临时文件再替换；模拟写入失败时上一份有效工程仍可打开。
- [ ] 保留最近 3 份有效备份；损坏工程可从备份恢复。
- [ ] 高 schemaVersion 工程不被旧应用覆盖；schemaVersion 为 semver 字符串，按 semver 比较；不兼容检查点给出提示。
- [ ] `project.json` 的 `contentRevision` 来自 `ProjectMetadata`；运行状态写入不提升内容修订。
- [ ] 移动素材后工程可打开并标记缺失；重新定位后 assetId 和时间线关联不变。
- [ ] 同一工程第二个写入实例被拒绝或只读，不能双写。
- [ ] 工程文件中不存在 API 密钥。

**不包含**：素材分析、时间线编辑。

**验证方式**：单元/集成测试 + 写入失败注入 + 手动重开。

---

## T05 本地素材导入、扫描、文稿与音乐输入

**目标**：实现本地素材目录/文件导入、递归扫描、去重、文稿输入和音乐导入。

**依赖**：T04

**交付物**：素材扫描器、导入 UI 入口、文稿输入、音乐导入、AssetManifest。

**验收标准**

- [ ] 支持递归扫描嵌套目录；识别 MP4/MOV/JPG/JPEG/PNG/MP3/WAV。
- [ ] 记录路径、类型、大小、修改时间；assetId 稳定，重开工程不变。
- [ ] 素材映射到工程模型：视频 `mediaType = 'video'` 且必须带 `fps`，图片 `mediaType = 'image'` 不要求 `fps`；导入结果写入 `ProjectAssets`，AssetManifest 只作扫描产物。
- [ ] 同一文件重复导入不产生重复素材记录；同路径更新文件有明确处理策略。
- [ ] 单个不可读文件被记录且不阻断其他文件；没有可用画面素材时给出明确提示。
- [ ] 文稿支持粘贴和 UTF-8 TXT；超过 10,000 字有提示；空文稿禁止启动生成。
- [ ] 创作页有本地素材导入入口；选择结果持久化到工程。
- [ ] 音乐可选导入；未导入音乐时工程合法；音乐丢失可重新定位或移除。

**不包含**：ffprobe 深度分析、关键帧、视觉模型。

**验证方式**：素材夹具 + 手动导入 + 重开校验。

---

## T06 媒体预处理、关键帧、代理、字体、FFmpeg 打包

**目标**：实现 ffprobe 元数据、关键帧、按需代理、字幕字体和 FFmpeg 随包。

**依赖**：T05

**交付物**：媒体处理器、缓存、代理生成、字体资源、FFmpeg/ffprobe 打包配置。

**验收标准**

- [ ] ffprobe 提取视频/音频/图片元数据；旋转信息被正确处理；导出启用自动旋转。
- [ ] ffprobe 结果映射到 `VideoAsset.durationMs/fps/width/height`；图片不写 `fps`，视频必须写 `fps`。
- [ ] 能识别 VFR、HEVC、HDR；按策略转代理或明确拒绝，不静默失败。
- [ ] 关键帧提取遵守每视频最多 8 帧、长边 768；按内容哈希缓存。
- [ ] 关键帧映射为 `ThumbnailAsset`（id/path/width/height/timeMs），并由 `VideoAsset.thumbnailIds` 引用。
- [ ] 删除 `cache/` 后可重建缩略图、关键帧和代理，不触发云端分析。
- [ ] 代理按需生成 960×540、H.264/AAC、30fps；H.264/AAC MP4/MOV 可直接预览。
- [ ] 中文字体随包；ASS 测试能正确渲染中文；开发态/打包态路径一致。
- [ ] ffmpeg/ffprobe 随包；中文/空格路径冒烟通过。
- [ ] 后台处理不阻塞界面；损坏文件单独失败，不影响其他素材。
- [ ] FFmpeg 构建、版本和分发许可记录在案。

**不包含**：视觉模型分析、时间线组装。

**验证方式**：媒体夹具 + 缓存重建 + 打包冒烟。

---

## T07 LangGraph 运行时、检查点、事件桥、取消

**目标**：实现 10 节点图的运行时骨架、NodeSpec 包装、JSON checkpointer、事件桥、取消和恢复。

**依赖**：T02、T03、T04

**交付物**：WorkflowRuntime、NodeSpec 适配器、JSON checkpointer、RunEvent 桥、取消/恢复测试。

**验收标准**

- [ ] 10 个 mock 节点按依赖顺序执行；4 个阶段状态正确更新。
- [ ] NodeSpec 包装器执行 Zod 输入/输出校验，并发出包含 runId、nodeId、seq、attempt、status 的事件。
- [ ] 每个 superstep 写入检查点；杀掉工作进程/重启应用后可恢复。
- [ ] `interrupt`/`Command` 审批流可用；interrupt 前无副作用；重复 resume 不产生重复写入。
- [ ] 取消模型/FFmpeg 任务后状态为 cancelled，不再发起新请求。
- [ ] 输入修订变化后，旧输出不能提交；stale 结果被拦截。
- [ ] 显式设置 recursionLimit；连续 3 轮审批修改不会误触上限。
- [ ] LangGraph state 只含引用和状态；检查点大小有上限测试。

**不包含**：真实模型调用、真实业务节点内容。

**验证方式**：图运行单测 + 重启恢复 + 取消测试。

---

## T08 ChatOpenAI 适配、能力验证、结构化输出、重试预算

**目标**：实现 OpenAI 兼容模型适配器，覆盖图片输入、function calling、结构化输出、能力验证和统一重试预算。

**依赖**：T03、T07

**交付物**：ModelAdapter、能力验证、结构化输出封装、AttemptBudget、错误分类。

**验收标准**

- [ ] 可配置 `baseURL`、模型名、密钥；能力验证报告图片、function calling、json mode、strict 支持情况。
- [ ] 使用 `withStructuredOutput(zodSchema, { method: "functionCalling", strict: false })`；不支持时降级 `jsonMode` + 本地 Zod。
- [ ] 图片以 base64 data URL 发送；遵守单请求图片数和尺寸上限。
- [ ] `ChatOpenAI` 设置 `maxRetries: 0`；mock 提供者测试证明每个请求总尝试不超过 3 次。
- [ ] 网络重试和 Schema 修复共享预算；不存在嵌套重试。
- [ ] 密钥错误、权限不足、模型拒绝不自动重试；限流遵守 Retry-After。
- [ ] 无效输出被 Zod 拦截，错误包含字段路径；无效结果不流入下游。
- [ ] 调用上限（帧数、并发、单次运行调用数）生效；启动前可估算调用数。
- [ ] 密钥不出现在日志、消息、工程文件和模型提示中。

**不包含**：具体节点提示词、业务校验。

**验证方式**：mock 模型单测 + 真实 API 冒烟 + 调用计数断言。

---

## T09 analyze_assets 视觉分析

**目标**：完成素材分析节点，持久化片段描述和内容索引。

**依赖**：T06、T08

**交付物**：AnalyzedAssetCollection、视觉提示词、按素材缓存、失败清单。

**验收标准**

- [ ] 每个成功素材包含元数据、关键帧引用与时间位置、内容描述、主体/动作/场景标签。
- [ ] 描述可追溯到真实 assetId 和时间范围；不虚构素材。
- [ ] 按素材成功结果可复用；重开工程不重复调用云端分析。
- [ ] 失败/不支持的素材进入失败清单，不冒充已分析结果。
- [ ] 视觉调用遵守帧数、尺寸、并发和预算限制。
- [ ] 损坏或不可解码素材单独失败，不阻断其他素材。
- [ ] 分析结果写入 `analysis/assets/`；UI 能显示进度、数量和失败原因。

**不包含**：分镜规划、素材匹配。

**验证方式**：媒体夹具 + mock 视觉模型 + 真实 API 冒烟。

---

## T10 creative_brief + ProductionSpec + A1/A2

**目标**：完成文稿分析、纯口播稿转换、方案推荐、成片需求文档和 A1/A2 审批。

**依赖**：T08、T09

**交付物**：CreativeBrief、ProductionSpec、A1/A2 聊天卡片、审批与版本失效。

**验收标准**

- [ ] 文稿分析输出类型、时间结构、分段摘要；纯口播稿转换保留原意并记录改写说明。
- [ ] 方案推荐首版只包含 `material_edit`；不支持方案被归一化并明确提示。
- [ ] ProductionSpec 包含视频类型、风格、配色、字体、音色、字幕、素材策略、节奏、交付规格、16:9/1920×1080/30fps。
- [ ] A1/A2 卡片可见并可批准/修改；修改后重新生成，保留反馈和旧版本。
- [ ] A2 批准后冻结 specVersion 与内容指纹；旧批准不能放行新版本。
- [ ] 不生成未经用户要求的事实性补充作为原文；素材覆盖问题明确列出。
- [ ] 消息持久化；重开恢复等待审批状态；模型不能代替用户审批。
- [ ] 输出通过 Zod 和业务校验。

**不包含**：分镜规划、配音。

**验证方式**：mock 模型 + UI E2E + 重启恢复。

---

## T11 plan_scenes + scene_approval + A3

**目标**：完成分镜规划、版本管理和 A3 人工审批。

**依赖**：T07、T10

**交付物**：ScenePlan、分镜审批卡、修改回路、版本/指纹校验。

**验收标准**

- [ ] ScenePlan 包含分镜版本、场景 ID、顺序、文稿段落、画面描述、旁白、预计时长、直切设置、镜头建议、待处理问题。
- [ ] ScenePlan 是生产产物；确认后映射到 `Scene`：`index/title/script/visualIntent/goal/notes` 来自 ScenePlan，`durationMs` 在 T12 配音生成后以配音时长为准（未生成时用预计时长），`matchedVideoAssetIds`/`subtitleIds`/`voiceAssetId` 由 T13/T12/T14 填充。
- [ ] 文稿内容可追溯；只使用直切；修改后生成新版本；旧审批失效。
- [ ] A3 审批卡可批准/请求修改；批准后才允许 TTS 和素材匹配。
- [ ] 请求修改返回 `plan_scenes`，保留反馈、旧版本和可复用素材分析。
- [ ] 重开工程恢复等待审批；模型不能批准；旧版本批准被拒绝。
- [ ] 分镜数量和时长在 UI 正确显示；错误可定位到场景。

**不包含**：配音、素材匹配、时间线组装。

**验证方式**：图运行测试 + UI E2E + 版本失效测试。

---

## T12 synthesize_voice 模拟 TTS

**目标**：实现模拟 TTS，为每个分镜生成静音占位音频和句级估算时间。

**依赖**：T07、T11

**交付物**：MockTTSProvider、VoiceSegmentCollection、模拟标记。

**验收标准**

- [ ] 无真实 TTS 密钥也能为每个已批准分镜生成音频文件。
- [ ] 输出为静音 WAV；时长与估算规则一致。
- [ ] 提供句级字幕时间；`timingSource = mock_estimate`、`isMock = true`。
- [ ] 输出映射到 `VoiceAsset`（durationMs/path/provider/voice/isMock=true）和 `VoiceClip`（assetId/voicePreset/speed）；`timingSource` 保留在 VoiceSegmentCollection，不进入 VideoProject。
- [ ] 界面和执行要点明确显示“模拟”，不会把估算时间标成真实时间戳。
- [ ] 更换音色或语速会改变估算时长，并使下游匹配/组装/校验结果 stale。
- [ ] 支持重新生成当前分镜；生成文件写入 `generated/` 并在工程中引用。
- [ ] 单个分镜生成失败有记录，不阻断其他分镜。
- [ ] 导出时静音配音轨存在，音频参数合法。

**不包含**：真实 TTS、音色克隆、参考音频。

**验证方式**：音频时长断言 + 重开复用 + 导出冒烟。

---

## T13 match_assets 基于配音时长匹配

**目标**：为已批准分镜检索候选素材，并按实际/估算配音时长确定入出点。

**依赖**：T08、T09、T11、T12

**交付物**：AssetMatchCollection、候选排序、范围校验、未匹配问题。

**验收标准**

- [ ] 输入包含已批准分镜、配音时长、素材内容索引和元数据。
- [ ] 每个场景返回候选 assetId、排序、建议入点/出点、简短理由、匹配程度。
- [ ] AssetMatchCollection 是生产产物；最终写入 `Scene.matchedVideoAssetIds`，入出点映射到 `VideoClip.sourceStartMs/sourceEndMs`。
- [ ] 素材 ID 必须存在；入出点不越界；覆盖时长不少于分镜时长。
- [ ] 素材不足时标记未匹配/覆盖不足，不擅自拉伸、不自动变速。
- [ ] 复用已有分析结果，不重新触发云端素材分析。
- [ ] 非法 ID、越界、不可修复错误被业务校验拦截；可修复错误在预算内回传模型。
- [ ] UI 能看到候选、未匹配项和原因。

**不包含**：时间线组装、人工替换交互。

**验证方式**：mock 模型 + 边界夹具 + UI 检查。

---

## T14 assemble_timeline 四轨组装

**目标**：把分镜、匹配结果、配音、字幕和音乐组装成可编辑的四轨 VideoProject。

**依赖**：T04、T12、T13

**交付物**：符合 `VideoProjectSchema` 的四轨工程、片段映射、时间不变量实现。

**验收标准**

- [ ] 输出使用 `TimelineTrackSchema` 的四轨判别联合：video/voice/subtitle/music 各一条（音乐可省略），不得混入其他 kind 的片段。
- [ ] 视频轨从 0 到项目结束连续覆盖；每个分镜一个片段；片段时长 = 分镜时长。
- [ ] 图片按分镜时长形成静态片段；视频素材超出时裁剪，不足时记录问题。
- [ ] 每个 `VideoClip` 填充 `assetId`、`crop`、`transform`、`sourceStartMs`、`sourceEndMs`；图片素材的 `VideoAsset.mediaType = 'image'`，crop 用 `{x:0,y:0,width:1,height:1}`，transform 用 `{x:0,y:0,scale:1}`，source 区间用 0..分镜时长。
- [ ] `Scene.voiceAssetId/subtitleIds/matchedVideoAssetIds` 引用真实资产；`SubtitleClip` 必须带 `assetId` 和 `text`。
- [ ] 配音片段按分镜起点对齐；字幕为句级；音乐可选；源视频原声静音由 `RenderConfig.sourceAudioMuted = true` 表达。
- [ ] 项目总时长 = 各分镜时长之和 = 配音轨结束时间。
- [ ] 缺失素材、覆盖不足、越界不被静默忽略；问题写入 ValidationReport（含位置和修复提示），VideoProject 不内嵌问题列表。
- [ ] 人工编辑不会被后台重新生成静默覆盖；需要替换时给出确认。
- [ ] VideoProject 通过 Zod 校验（含 refine）；`contentRevision` 写入 `ProjectMetadata`。
- [ ] 片段时长为正；Zod refine 已覆盖 end>start、source 区间、crop/volume/speed 边界；跨轨覆盖/重叠由 T15 校验。

**不包含**：导出渲染、编辑器交互。

**验证方式**：时间线单测 + 多种素材夹具 + Zod 校验。

---

## T15 validate_project + save_project

**目标**：实现项目校验和原子保存，作为生成流程的完成提交。

**依赖**：T03、T14

**交付物**：ValidationReport、错误码、save_project、SavedProjectRef。

**验收标准**

- [ ] 先执行 Zod 结构校验，再执行业务校验；Zod refine 已覆盖的规则不重复实现。
- [ ] 业务校验覆盖跨轨/跨片段不变量：视频轨连续覆盖、各轨片段不重叠、项目总时长 = 分镜时长之和 = 配音轨结束、ID 引用存在、字幕/配音不越界、缺失素材。
- [ ] ValidationReport 包含 validatedRevision、passed、errors、warnings；每个问题有错误码、位置、相关场景/片段 ID 和修复提示。
- [ ] 缺失素材、无效 ID、越界片段、视频未覆盖、字幕/配音越界阻止导出。
- [ ] 音乐和字幕允许合理空隙，不误判为错误。
- [ ] 报告绑定 contentRevision；任何编辑使旧报告失效。
- [ ] save_project 持久化当前工程文档（Draft 或 VideoProject）；只有通过业务校验的 VideoProject 才允许导出。
- [ ] save_project 原子写盘；失败保留上一份有效工程；成功返回 SavedProjectRef。
- [ ] 重开后四轨、引用、AI 结果一致。
- [ ] 存在待修复业务问题的草稿仍可保存，但导出被阻止。
- [ ] UI 能定位错误场景/片段。

**不包含**：导出渲染。

**验证方式**：单测 + 写入失败注入 + 重开对比。

---

## T16 创作页与创作消息页 UI

**目标**：实现原型中的创作页、聊天消息流、内联卡片、4 个执行要点、A1–A4 和视频概览。

**依赖**：T03、T07

**交付物**：创作页、创作消息页、消息组件、审批卡、执行要点、视频概览。

**验收标准**

- [ ] 创作页包含文稿输入/粘贴、音色下拉、本地素材导入入口、创建按钮；10,000 字限制和禁用态正确。
- [ ] 只带文稿也能创建合法 `DraftProjectSchema` 草稿（无 ai/分镜/轨道）；启动生成前至少 1 个画面素材的提示由业务校验给出。
- [ ] A4 进入编辑器时工程已升级为 `VideoProjectSchema`。
- [ ] 消息流渲染所有 ChatMessage 类型：用户需求、文稿分析、纯口播稿、方案推荐、成片需求表、执行更新、审批、视频概览、错误。
- [ ] A1/A2/A3 审批卡可批准/请求修改；A4 可进入编辑器；不能重复提交。
- [ ] 4 个执行要点与持久化状态一致；不出现 10 节点图或步骤流调试 UI。
- [ ] 重试、取消、失败原因内联展示；重开工程恢复消息和状态。
- [ ] 1920×1080 下与原型 frame 对齐；布局、层级、状态样式一致。
- [ ] 首版非目标控件（上传口播、音色克隆、推荐曲库）隐藏或禁用并有说明。
- [ ] 无死按钮、无未定义交互。

**不包含**：编辑器、导出。

**验证方式**：UI E2E + 原型并排对照 + 重启恢复。

---

## T17 四轨编辑器与时间线工具

**目标**：实现原型中的四轨编辑器、右侧面板、时间线工具和编辑持久化。

**依赖**：T04、T15

**交付物**：编辑器布局、四轨渲染、片段编辑、面板、撤销/重做、分割/吸附/联动/波形/缩放。

**验收标准**

- [ ] 四轨（视频/配音/字幕/音乐）正确渲染；选择、播放头、属性面板可用。
- [ ] 支持移动、排序、裁剪、替换；播放头分割；吸附；联动；波形；缩放。
- [ ] 撤销/重做至少 20 步；空格/Delete/Ctrl+Z/Ctrl+Y/Ctrl+S 快捷键可用。
- [ ] 画面/口播/字幕/音乐面板按 §9 行为工作；字幕字号 24–72 与 `SubtitleStyleSchema` 一致（现有 UI 上限 64 需改为 72）；样式和显示开关读写 `SubtitleTrack.style/visible`。
- [ ] 时间裁剪写 `startMs/endMs/sourceStartMs/sourceEndMs`，空间裁剪写 `crop`，画面变换写 `transform`；编辑后必须通过 Zod refine。
- [ ] `contentRevision` 来自 `ProjectMetadata`，每次编辑递增，使校验/导出 stale，并触发自动保存。
- [ ] 禁止负时长、越界、重叠；缺失素材显示占位和问题。
- [ ] 分镜结构变更不在编辑器执行；提示回创作消息页。
- [ ] 重开工程恢复轨道、面板和撤销栈状态（至少恢复工程内容）。
- [ ] 与原型编辑器 frame 的布局和交互一致。

**不包含**：预览播放、导出。

**验证方式**：UI E2E + 编辑夹具 + 重开恢复。

---

## T18 预览同步与代理

**目标**：实现多轨预览，保证视频、配音、字幕和音乐同步。

**依赖**：T06、T17

**交付物**：预览播放器、主时钟、同步校正、代理播放。

**验收标准**

- [ ] 单个 `<video>`（静音）+ 两个 `<audio>` + DOM 字幕能播放当前时间线。
- [ ] 预览读取 `VideoProjectSchema`；字幕可见性读 `SubtitleTrack.visible`，源声静音读 `RenderConfig.sourceAudioMuted`。
- [ ] 播放、暂停、定位播放头、时间码显示可用。
- [ ] seek 后视频/配音/音乐/字幕统一到同一时间点。
- [ ] 播放中漂移超过 50ms 能校正；基准样例字幕/配音起点偏差不超过 100ms。
- [ ] 编辑后预览读取当前修订；代理按需使用；缺失素材显示占位。
- [ ] 完整播放无明显累计漂移；窗口保持可交互。
- [ ] 不把整个原视频一次读入内存。

**不包含**：最终渲染。

**验证方式**：基准样例播放 + 漂移测量 + 编辑后回归。

---

## T19 导出重校验、FFmpeg 渲染、进度与取消

**目标**：把当前时间线渲染为 16:9 1080p MP4，并保证校验、进度、取消和失败语义正确。

**依赖**：T15、T18

**交付物**：导出弹窗、FFmpeg 命令编译、进度解析、取消、临时文件提交。

**验收标准**

- [ ] 导出前重新校验当前 contentRevision；旧的通过报告不能复用。
- [ ] 输出为 1920×1080、30fps、H.264/AAC MP4；字幕烧录；源声静音；音乐混音。
- [ ] 导出参数来自 `CanvasConfig`（1920×1080/30fps）和 `RenderConfig`（MP4/H.264/AAC 192kbps、`burnSubtitles`、`sourceAudioMuted`）；字幕样式来自 `SubtitleTrack.style` 并映射为 ASS。
- [ ] 导出进度来自 FFmpeg 实际进度，不是伪进度。
- [ ] 取消能终止渲染并杀掉 ffmpeg 进程树；临时文件不展示为成功成品。
- [ ] 失败有明确原因；未完成文件不提交。
- [ ] 输出文件可由常用播放器播放；片段边界误差不超过一个输出帧。
- [ ] 导出成品与预览的时间线一致。
- [ ] 模型不提交任意 Shell 命令。

**不包含**：竖屏/多画幅导出。

**验证方式**：ffprobe 检查 + 播放器播放 + 取消/失败注入。

---

## T20 快捷调整 EditIntent 解析与执行

**目标**：实现编辑器“快捷调整”的白名单意图解析、确定性执行、撤销和版本冲突处理。

**依赖**：T08、T17

**交付物**：EditIntentSchema、意图解析、执行器、撤销记录、错误提示。

**验收标准**

- [ ] 使用 `withStructuredOutput` 解析出白名单意图：改音色、音量、语速、缩短/延长、换素材、改字幕、字幕样式、音乐、重新生成配音。
- [ ] 每个意图正确修改 VideoProject；`contentRevision` 在 `ProjectMetadata` 中递增；校验/导出 stale。
- [ ] 音量在 UI 0–100 与 `VoiceClip/MusicClip.volume` 0–1 之间转换；语速写 `speed`（schema 0.5–2，UI 0.8–1.2）；字幕样式写 `SubtitleTrack.style`，显示开关写 `visible`。
- [ ] `baseRevision` 过期时拒绝执行，不覆盖新编辑。
- [ ] 执行后必须通过 Zod refine（片段正时长、crop 边界、音量/语速范围等）。
- [ ] 撤销/重做包含快捷调整操作。
- [ ] 多意图或歧义要求拆分/确认；不猜测执行。
- [ ] 不支持的意图明确回复支持范围；结构性修改提示回创作消息页。
- [ ] 助手确认消息持久化；重开后可查看。
- [ ] 模型不直接改文件、不执行 Shell。

**不包含**：开放式自然语言剪辑、结构性重规划。

**验证方式**：mock 模型 + 意图夹具 + 编辑器 E2E。

---

## T21 Windows 打包与整体验收

**目标**：在干净 Windows 环境完成安装、运行和完整闭环验收。

**依赖**：T01–T20

**交付物**：Windows 安装包、随包 FFmpeg/字体、验收记录。

**验收标准**

- [ ] `make` 生成 Windows 安装包；干净目标机安装并启动，无需开发环境。
- [ ] FFmpeg/ffprobe 和中文字体路径在打包态有效。
- [ ] LangGraph 工作进程在打包态运行；无 ESM/CJS 错误。
- [ ] 基准样例完整闭环通过（A01–A15）。
- [ ] 安装/更新不覆盖用户工程目录。
- [ ] 工程、消息、日志、流程事件和模型请求快照不包含密钥。
- [ ] 冷启动、恢复审批、恢复中断运行、导出冒烟通过。
- [ ] 验收记录包含环境、版本、通过项和遗留问题。

**不包含**：后续 P1/P2 功能。

**验证方式**：干净 Windows 目标机 + 验收清单。

---

## 里程碑

| 里程碑 | 包含任务 | 完成条件 |
| --- | --- | --- |
| M0 技术验证 | T01、T02 | 打包后的 Electron 能跑 LangGraph，interrupt/resume 和 JSON checkpointer 通过 |
| M1 工程可保存 | T03–T07 | 契约、工程存储、素材导入、媒体预处理、运行时可用；VideoProject 模型已落地 |
| M2 聊天流程可跑通 | T08–T16 | mock 模型/TTS 跑通 4 阶段、A1–A4 和消息流 |
| M3 可编辑可交付 | T17–T20 | 四轨编辑、预览、导出、快捷调整可用 |
| M4 可独立运行 | T21 | 干净 Windows 安装并完成完整闭环 |

## 关键路径

T01 → T02 → T03 → T04 → T05 → T06 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15 → T17 → T18 → T19 → T21。

T07 与 T03/T04 并行推进；T16 在 T03/T07 稳定后可与 T09–T15 并行；T20 在 T17 后进行。

## 风险任务

- **T02**：LangGraph/LangChain 的 Electron ESM 打包与自定义 checkpointer。失败则回退自定义调度器，不影响 NodeSpec。
- **T08**：OpenAI 兼容提供商的图片 + function calling + strict 支持不一致。必须保留 jsonMode 降级。
- **T17–T19**：编辑器、预览同步、FFmpeg 渲染是工作量最大、最易超期的部分。先做 T18 的播放/同步 spike，再全面铺开编辑功能。
- **T16**：原型与需求若再漂移，UI 会返工。每个消息卡/审批卡完成后与原型 frame 并排验收。

## 变更记录

- **v1.1（2026-10-23）**：对齐 `packages/video-project` 的 `VideoProjectSchema`（`schemaVersion: '1.0.0'`）；新增数据模型基线；补充 T04 草稿工程、T14 片段字段映射、T15 结构/业务校验边界、T17/T20 单位与样式位置。
