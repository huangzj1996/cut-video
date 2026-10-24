# 创作消息页：结构化数据 Schema + 首轮真实 AI 对话

> 状态：已评审，**暂不执行实现**，仅作为范围与数据契约基线。
> 日期：2026-10-24
> 关联页面：`#/create-chat`（设计稿 frame `K4Avtd`）

## Context

`#/create-chat` 的「妙剪创作消息页」目前是纯静态 mock（`apps/desktop/client/src/screens/CreateChatScreen.tsx`）：所有卡片、文案、执行计划都是常量；创作页创建项目后丢弃了 projectId，文稿/音色没有持久化；输入框不会调用模型。

本次目标（已与用户确认）：
1. 从设计稿 frame `K4Avtd` 提取结构化数据，落成 Zod Schema。
2. 接入真实 AI：首轮生成 **创意简报 + 纯口播文稿**，确定性派生文稿分析、方案推荐、成片需求与 A1/A2 审批；页面改为消息驱动。
3. 输入框每次输入视为「修改需求」，重新生成简报与口播稿并产生新版本；不做通用自由聊天。
4. 不做分镜、配音、素材匹配、时间线、视频概览与导出（当前没有这些节点）。

设计稿中的竖屏 1080×1920、MG 动画属于 v1.0 原型内容；v1.1 要求 16:9 / 1920×1080 / 30fps、仅 `material_edit`。Schema 与 UI 以需求文档 §4.3 为准。

### 文档状态

本文档即仓库内的范围基线（`docs/plans/creative-chat-schema-and-ai.md`）。本次只落盘计划，不修改代码、不运行应用；后续评审与任务拆解以本文档为准。

---

## 一、从设计稿提取的结构化数据

| 设计区域 | 结构化字段 | Schema |
| --- | --- | --- |
| 时间 `18:26` | `createdAt`（ISO），UI 格式化 | 消息信封 |
| 用户需求正文 | `script`、可选 `requirementsText`、`voicePresetId`、`assetCount` | `user_requirement.initial_request` |
| 标签组 `[视频画面, 智能匹配素材]`、`[旁白配音, 清朗青年]` | `tags: [{ group: 'visual'\|'voice'\|'other', values: string[] }]` | 同上 |
| 分析开场白 | 由 `brief.summary` / `contentType` 渲染 | `script_analysis` |
| 摘要卡标题 + 4 个时间段 | `brief.title` + `brief.narrativeStructure.beats`，UI 累加计算时间范围 | `script_analysis.brief` |
| 文稿类型判断 | `brief.contentType`，UI 映射中文标签 | 同上 |
| 纯口播稿卡片 | `title`、`paragraphs[]`、`changeNotes[]` | `script_rewrite` |
| 方案推荐文案 | `recommendedScheme`（固定 `material_edit`）、`summary`、`reasons[]`、`candidates[]` | `scheme_recommendation` |
| A1 / A2 用户输入 | `gate`、`artifactRef`、`title`、`summary`、`prompt`；用户回复分为确认 / 需求修改两个分支 | `approval_request` + `user_confirmation` |
| 成片需求表 10 行 | 完整 `ProductionSpec`，UI 按固定顺序派生 10 行 | `production_spec.spec` |
| 4 个执行要点 | `phase`、`nodeId`、`status`、`detail`、`progress?` | `execution_update` |
| 视频概览 | 时长、导出状态、项目修订号、spec 引用 | `video_overview`（本轮只定义，不生成） |
| 错误 / 通知 | 错误码/消息/可重试；级别/文本 | `error` / `system_notice` |
| 折叠状态、tone 色、toast、按钮 disabled | **纯展示**，由语义字段派生 | 不落库（payload 用 `strictObject` 拒绝） |

关键规则：
- **A1/A2 不是按钮，而是用户输入**：`approval_request` 只是「等待用户输入」的 gate 标记；用户在输入框回复确认或修改要求，主进程据此走两个分支，并写入 `user_confirmation`。UI 不渲染独立审批按钮。
- `script_analysis` 只嵌入一份完整 `CreativeBriefContent`；方案/成片需求/审批通过 `ArtifactReference { ref, version, contentFingerprint }` 引用，不重复。
- `production_spec` 只嵌入一份完整 spec；`video_overview` 通过引用取风格/音色。
- 执行要点的 4 个阶段标题/说明是 UI 固定文案；消息只存语义状态。阶段 id 必须与现有 `WorkflowPhaseId` 一致：`prepare | storyboard | voice | video`（注意不是 `scenes`）。

---

## 二、Schema 文件（`packages/video-project/src/`）

新增：

- `workflow.ts` — 把 `WORKFLOW_NODE_IDS` / `WORKFLOW_PHASES` / `WorkflowNodeId` / `WorkflowPhaseId` 从 `packages/video-agent/src/index.ts` 迁入（数据契约归属 video-project），video-agent 改为 import 后原样 re-export，保持现有公开 API。
- `voice-presets.ts` — `VOICE_PRESET_IDS`（wenrou-xuejie / xinwen-bobao / chenwen-nansheng / huoli-jiangjie）、`VoicePresetIdSchema`、`VOICE_PRESETS`、`getVoicePreset()`；`CreateVideoScreen` 删除本地副本。
- `production-spec.ts` — `ProductionSpecSchema`（`strictObject`）。
- `creation-input.ts` — `CreationInputDraftSchema` + `CreationInputSchema`。
- `script-rewrite.ts` — `ScriptRewriteContentSchema`（模型输出）+ `ScriptRewriteSchema`（含版本/指纹）。
- `chat/enums.ts` — 11 种 `CHAT_MESSAGE_TYPES`、role/status、`ApprovalGateSchema`（A1/A2/A3）、`ApprovalDecisionSchema`（approve/request_changes）、`ExecutionStatusSchema`、`SchemeIdSchema`、`ExportStatusSchema`。
- `chat/artifact.ts` — `ArtifactReferenceSchema`。
- `chat/user-messages.ts` — `UserRequirementPayloadSchema`（按 `kind` 判别：initial_request / follow_up）、`UserConfirmationPayloadSchema`。
- `chat/assistant-messages.ts` — 其余 9 种 payload。
- `chat/message.ts` — `ChatMessageBaseSchema` + `ChatMessageSchema = z.discriminatedUnion('type', [...])`，每个分支固定 role。
- `chat/chat-log.ts` — `ChatLogSchema { schemaVersion: '1.0.0', projectId, messages[] }`。
- `chat/index.ts` — barrel。

修改：
- `index.ts` 导出以上模块。
- `json-schema.ts` 注册 `chatMessage`、`chatLog`、`creationInput`、`productionSpec`、`scriptRewriteContent`。
- `json-schema.test.ts` 断言 `chatMessage` 为 11 分支 `oneOf`、spec 必填字段等。

### 关键 payload 形状

```ts
// 信封
{ id, projectId, runId?, role, type, payload, artifactRef?, relatedSceneIds?,
  revision, status: 'pending'|'completed'|'failed', createdAt }

// user_requirement
| { kind: 'initial_request', script, requirementsText?, voicePresetId,
    assetCount, tags: [{ group: 'visual'|'voice'|'other', values[] }] }
| { kind: 'follow_up', text }

// user_confirmation（用户在输入框提交的 gate 决策）
// - approve：确认当前 artifact，进入下一 gate
// - request_changes：feedback 必填，回到生成节点，旧 artifact 失效
{ gate, decision: 'approve'|'request_changes', rawText, feedback?, artifact, approvalMessageId }

// script_analysis（唯一嵌入完整 brief 的地方）
{ brief: CreativeBriefContent, briefVersion, contentFingerprint }

// script_rewrite
{ content: { title, paragraphs[], changeNotes[] }, sourceBrief: ArtifactReference,
  rewriteVersion, contentFingerprint }

// scheme_recommendation
{ recommendedScheme: 'material_edit', summary, reasons[], candidates[],
  sourceBrief, normalizationNotes[] }

// production_spec
{ spec: ProductionSpec, sourceBrief }

// approval_request：gate 标记，不是按钮；prompt 是给用户的输入提示
{ gate, artifact, title, summary, prompt }  // 例：回复「确认」继续，或直接说明要修改的内容

// execution_update
{ phase: 'prepare'|'storyboard'|'voice'|'video', nodeId?, status, detail,
  progress?: { current, total }, attempt? }

// video_overview（本轮不生成）
{ title, description, durationSeconds, exportStatus, projectRevision, spec: ArtifactReference }

// error
{ code, message, retryable, fieldPaths?, attempt? }

// system_notice
{ code?, level: 'info'|'warning', message }
```

### ProductionSpec（v1 约束写进 Schema）

`videoType`、`recommendedScheme: 'material_edit'`、`visualStyle`、`palette {name, description}`、`font {family, usage}`、`voiceProfile {presetId, displayName, description, speed}`、`subtitleStyle`（复用 `SubtitleStyleSchema`）、`materialStrategy`、`rhythm`、`deliverySpec {mp4, h264, aac, 192kbps, burnSubtitles: true}`、`aspectRatio: '16:9'`、`resolution: '1920x1080'`、`fps: 30`、`durationRange {minSeconds, maxSeconds, targetSeconds}`、`sourceAudioMuted: true`、`normalizationNotes[]`、`specVersion`、`contentFingerprint`。

`9:16`、`1080x1920`、`24fps`、`mg_animation`、`sourceAudioMuted: false` 一律被 Zod 拒绝。不支持的模型建议只写入 `normalizationNotes`，并显示说明，不静默改变用户预期。

### ScriptRewriteContent

```ts
{ title: 1-120 字,
  paragraphs: 1-20 段，每段 1-2000 字,
  changeNotes: 0-20 条，每条 1-300 字 }
```

---

## 三、持久化与 IPC

### 1. 项目上下文

- `CreateVideoScreen` 保留 `project.create()` 返回值，路由改为 `#/create-chat/<projectId>`（`App.tsx` 用正则解析；无/非法 id 显示回退页）。
- `ProjectCreateInput` 增加可选 `creation: CreationInputDraft`（script / requirementsText / voicePresetId）。
- 主进程校验后写 `<projectDir>/inputs/creation.json`，结构为 `CreationInputSchema`（补 `schemaVersion`、`projectId`、`assetCount`、`createdAt`）。**不改 `DraftProjectSchema`**，避免 `1.0.0` 版本迁移；长期再迁入 project.json。写入失败时沿用现有创建回滚逻辑，删除刚创建的项目目录。
- `ChatStore` 通过新增的 `ProjectStore.getProjectDirectory()`（主进程内部方法，复用 `parseProjectId`）访问工程目录。

### 2. messages.json

- 文件：`<projectDir>/messages.json`，结构 `ChatLogSchema`。
- 只追加、无更新/删除；数组顺序即消息顺序。
- 原子写：同目录临时文件 + `renameSync`；复用 `ProjectStore.writeProject` 模式。
- 每项目内存 promise 队列串行化 append，避免并发丢消息。
- 限制：最多 2000 条、8 MB；损坏文件返回 `CHAT_LOG_INVALID` 且不覆盖；缺失视为空日志。
- 写入前过 `ChatMessageSchema`，拒绝 tone/color/collapsed/disabled 等展示字段。

### 3. IPC 契约

```ts
ProjectCreateInput += { creation?: CreationInputDraft }

'chat:list':  { params: [projectId]; result: { creation, messages, projectName } }
'chat:start': { params: [projectId]; result: { messages } }
'chat:send':  { params: [{ projectId, content }]; result: { messages } }
'chat:retry': { params: [projectId]; result: { messages } }
```

- **没有 `chat:confirm` 按钮通道**：A1/A2 的确认/修改都由 `chat:send` 的文本输入驱动。主进程若检测到当前处于 pending gate，先分类输入：确认语义 → `user_confirmation.approve`；其余文本 → `user_confirmation.request_changes` + 重新生成；无 pending gate → `user_requirement.follow_up`。
- Preload 暴露 `window.miaoma.chat.{list,start,send,retry}`；**不暴露 append**，助手消息只能由主进程写，防止 UI 伪造流程状态。
- 新增错误码：`CHAT_INVALID_ARGUMENT`、`CHAT_CONTEXT_MISSING`、`CHAT_READ_FAILED`、`CHAT_WRITE_FAILED`、`CHAT_LOG_INVALID`、`CHAT_LOG_TOO_LARGE`、`CHAT_BUSY`、`CHAT_APPROVAL_NOT_FOUND`、`CHAT_STALE_APPROVAL`、`CHAT_APPROVAL_ALREADY_RESOLVED`。
- 更新 `ipc-contract.test.ts`。

### 4. 工作台恢复

- `ProjectSummary` 增加 `isDraft`（`!('ai' in project)`）。
- 工作台点击草稿项目 → `#/create-chat/<projectId>`；已完成项目继续进编辑器。

---

## 四、真实 AI 生成

### 1. 提示词

- 现有 `.agents/prompts/system.md`、`creative-brief.md` 复用；新增 `.agents/prompts/script-rewrite.md`（输入：原文稿、创作要求、已确认的 CreativeBrief JSON、项目设置；输出纯 JSON：title/paragraphs/changeNotes）。
- 主进程 `apps/desktop/main/chat/prompts.ts` 用 `?raw` 导入模板（Vite 构建期内联，打包不依赖 `.agents`）。若 Vite 拒绝越根导入，退化为把模板复制到 `main/chat/prompts/` 并加一致性测试。
- JSON Schema 从 `getJsonSchema(CreativeBriefContentSchema)` / `ScriptRewriteContentSchema` 注入 system 消息。
- 渲染 `{{script}}`、`{{requirements}}`、`{{assetSummary}}`、`{{projectSettings}}`；缺失填「无」；未解析占位符直接抛错。
- 项目设置文案明确 v1 约束：16:9 / 1920×1080 / 30fps / 仅 material_edit / 不推荐 MG 动画或竖屏。

### 2. 结构化生成

新增 `packages/video-agent/src/llm/structured.ts`：

```ts
generateStructured<T>(provider, messages, {
  schema, maxAttempts = 3, temperature, maxOutputTokens, timeoutMs, signal
}): Promise<{ data, attempts, model, usage }>
```

- `extractJsonObject()` 去掉代码围栏/前后说明后 `JSON.parse`，再 `schema.safeParse`。
- JSON/Zod 失败：在预算内追加一条只含字段路径与原因的修复消息重试（最多 3 次含首次）。
- `LlmError`：仅 `retryable` 错误重试，尊重 `retryAfterMs`；鉴权/权限/余额/模型不存在/上下文超限立即失败。
- 预算耗尽抛 `StructuredOutputError { fieldPaths, attempts }`；无效结果绝不落库。

### 3. 生成器

- `CreativeBriefGenerator`（接口 + LLM 实现 + 开发 mock）。
- `ScriptRewriteGenerator`（同上）。
- `MIAOMA_LLM_MOCK=1` 且 `!app.isPackaged` 时使用确定性 mock；mock 输出带 `mock: true`，并写一条 warning `system_notice`，绝不伪装真实调用。

### 4. 首轮消息顺序（`chat:start`）

1. 确保 `user_requirement.initial_request` 已落库。
2. 调用 brief 生成 → 校验 → 立即追加 `script_analysis`（若失败追加 `error`，保留用户消息，不写假卡片）。
3. 调用 rewrite 生成 → 校验 → 追加 `script_rewrite`（失败只追加 `error`，已生成的简报保留；`chat:retry` 只补缺失阶段）。
4. 确定性派生并追加：
   - `scheme_recommendation`：固定 material_edit；理由来自 brief 的 pacing/tone/coverageIssues；`assetCount === 0` 时明确写「未导入画面素材」，不虚构素材。
   - `approval_request(A1)`，payload 带 `prompt: '回复「确认」继续，或直接说明要修改的内容'`。
   - `execution_update(prepare, waiting_user)`。

### 5. A1/A2 用户输入的两个分支（`chat:send`）

主进程先判断当前是否处于 pending gate（最新的 `approval_request` 之后没有对应的 `user_confirmation`）：

```ts
classifyGateInput(text): 'approve' | 'request_changes'
```

- 归一化：去首尾空白、去标点、压缩空白后比较。
- 只有明确的确认白名单才走 `approve`：`确认`、`确认并继续`、`可以`、`同意`、`通过`、`没问题`、`就这样`、`继续`。
- 其余任何输入一律走 `request_changes`，并附上用户原文作为 `feedback`；**绝不静默确认**。

**分支 A：确认**
- 追加 `user_confirmation { gate, decision: 'approve', rawText: 用户原文, artifact, approvalMessageId }`，保留原始输入便于审计与渲染。
- A1 → 派生 `production_spec`（v1 固定值 + brief + 音色预设 + durationRange；扫描 MG/竖屏等词写入 `normalizationNotes`）→ `approval_request(A2)`。
- A2 → 追加 4 条 `execution_update`：prepare `succeeded`，storyboard/voice/video `pending`，detail 明确「尚未接入当前版本」；再追加 warning `system_notice`。**不生成 `video_overview`，不显示「视频制作完成」CTA。**

**分支 B：需求修改**
- 追加 `user_confirmation { gate, decision: 'request_changes', rawText: 用户原文, feedback: 用户原文, artifact, approvalMessageId }`；不重复写 `user_requirement.follow_up`。
- 重新生成 brief + rewrite，追加新的 `script_analysis`、`script_rewrite`、`scheme_recommendation`、`approval_request(A1)` 与 `execution_update(prepare, waiting_user)`。
- `briefVersion` / `rewriteVersion` 递增，计算新指纹；旧 A1/A2 通过 artifact ref/version/fingerprint 比对自动 stale。
- 追加提示：本阶段只支持调整创意需求；分镜/配音/成片能力尚未接入，不得声称已完成。

**无 pending gate 时**：输入落为 `user_requirement.follow_up`，同样触发 brief + rewrite 重新生成和新一轮 A1。

### 6. 并发与恢复

- 每项目 in-flight promise：`start` 重复调用返回同一 promise（React StrictMode 安全）；`send` 在生成中返回 `CHAT_BUSY`（retryable）。
- `retry` 找到最后一条无后续 assistant 结果的用户消息，只补缺失阶段，不重复用户消息。
- 存储/项目错误走 `IpcResponse` 错误；模型失败落为持久化 `error` 消息，便于内联重试。

### 7. 流式

本轮不做。现有 preload 只有 invoke，没有事件订阅；结构化输出也必须完整校验后才能渲染卡片。UI 用「正在生成创意简报… / 正在转化口播文稿…」+ 已用秒数的 pending 状态，不显示假进度。

---

## 五、UI 改造

`CreateChatScreen` 改为消息渲染器，删除全部 mock 常量（`USER_REQUEST`、`USER_TAGS`、`SUMMARY_TITLE/ITEMS`、`SCRIPT_PARAGRAPHS`、`SPEC_ROWS`、`PLAN_STEPS`、`OVERVIEW_METRICS`、`TIMESTAMP`）。

新增 `client/src/screens/create-chat/`：
- `view-model.ts`（纯函数）：时间/时长格式化、brief → 分析卡视图、spec → 10 行表格、消息 → 4 步执行计划、审批状态派生（waiting/approved/changes_requested/stale）、标签派生。
- `ChatMessageItem.tsx`：按 `message.type` switch 渲染。
- `PlanList.tsx`、`ChatStates.tsx`（loading/empty/missing-context/error）。

复用现有 `create-chat.css` 类：`.cc-request`、`.cc-summary-card`、`.cc-doc-card`、`.cc-table`、`.cc-plan`、`.cc-overview`、`.cc-prose`。新增 `.cc-pending`、`.cc-error`、`.cc-notice`、`.cc-gate-hint`、`.cc-loading`、`.cc-empty` 等状态样式。

行为：
- 挂载时 `chat:list`；无消息且存在 creation → 自动 `chat:start` 一次。
- 发送时先乐观显示用户气泡，返回后替换为持久化消息；生成中禁用输入框。
- **A1/A2 不渲染独立按钮**：`approval_request` 渲染为一张 gate 提示卡（展示 artifact 摘要 + 输入提示），输入框 placeholder 切换为「回复「确认」继续，或说明要修改的内容」；用户直接输入并发送，由 `chat:send` 分类。
- 已确认 / 已提交修改 / 版本失效三种状态只改变 gate 卡的文案与样式，不再生成可点击按钮；版本失效时提示「需求已更新，请在新一轮确认」。用户若想修改，直接继续输入。
- 用户输入确认词后，气泡显示原文；gate 卡变为「已确认」；修改输入则显示为修改气泡，旧 gate 卡变为 stale。
- 仅当存在真实 `video_overview` 时渲染概览；否则不出现完成 CTA。
- 保留现有 IME 守卫、Enter 发送、Shift+Enter 换行、自动滚动。
- 错误卡显示 code/message，`retryable` 时提供重试按钮。
- 返回按钮：已有项目回 `#/workspace`，避免重复创建。

修复设计稿与 v1.1 的冲突：
- 成片需求表由 spec 派生：16:9 / 1920×1080 / 30fps / material_edit / source audio muted；不出现 1080×1920、MG 动画。
- 方案文案固定「素材匹配 + 基础剪辑（material_edit）」；不支持建议只进 normalizationNotes。
- 执行计划只显示真实状态：A2 后 01 已完成、02–04 待开始。
- 音色名来自保存的 `voicePresetId`。

---

## 六、验证

### 单元测试

- `packages/video-project`：11 类消息正反样例；role/type 不匹配；展示字段被拒绝；初始文稿 >10k、非法音色、follow_up 超长、request_changes 无 feedback 均失败；ProductionSpec 拒绝 MG/竖屏/24fps/未静音；durationRange 一致性；CreationInput/ChatLog 边界；JSON Schema 11 分支与必填字段。
- `packages/video-agent`：`structured.test.ts` — 围栏/前后说明/嵌套 JSON 提取；1 次成功、2 次修复成功、3 次失败；retryable 与非 retryable；调用次数不超过 3。
- `apps/desktop/main/chat`：
  - `chat-store.test.ts`：creation 往返、消息追加/顺序/唯一 id、并发串行化、损坏文件、超大日志、项目不存在。
  - `prompts.test.ts`：占位符全部解析、v1 约束与 JSON Schema 注入、修订包含旧简报。
  - `derive.test.ts`：brief → 时间轴/方案/spec 映射；MG/竖屏词只进 normalizationNotes；assetCount 0 不虚构素材；A2 后仅 prepare succeeded。
  - `gate-input.test.ts`：确认白名单（确认/确认并继续/可以/同意/通过/没问题/就这样/继续，含空白与标点）返回 `approve`；其余文本（「把时长改成 45 秒」「换一个风格」）返回 `request_changes`；空输入被拒绝。
  - `chat-service.test.ts`：首轮消息顺序；并发 start 不重复；A1 输入确认→spec→A2，A2 输入确认→execution updates；A1/A2 输入修改→重新生成与新 A1、旧审批 stale；stale/重复审批；生成失败落 error；retry 不重复用户消息；send 在生成中返回 CHAT_BUSY。
  - `fingerprint.test.ts`：键序无关、内容变则指纹变。
- `client/src/screens/create-chat/view-model.test.ts`：时间/时长、计划状态映射、10 行 spec、gate 状态（waiting/approved/changes_requested/stale）、无硬编码残留。

### 手动端到端

1. 根 `.env` 配 `DEEPSEEK_API_KEY`，`pnpm dev`。
2. `#/create` 输入 60–90 秒中文文稿、选音色、可选素材路径 → 创建。
3. 确认跳到 `#/create-chat/<uuid>`，出现真实 AI 简报（标题/摘要/3–8 段带时间轴/覆盖问题）和纯口播文稿卡片。
4. 确认方案为 material_edit，成片需求表为 16:9/1920×1080/30fps。
5. 在输入框回复「确认」→ 生成 spec 与 A2 gate 提示；再回复「确认」→ 01 已完成、02–04 待开始 + 范围提示；无视频概览/完成 CTA。
6. 在新一轮 A1 回复「把时长缩短到 45 秒」→ 新版本简报/口播稿与新 A1，旧审批卡变为 stale。
7. 刷新窗口、关闭重开应用、从工作台草稿项目进入，消息与审批状态恢复。
8. 无 Key：显示 `LLM_NOT_CONFIGURED` 错误卡，可重试；`MIAOMA_LLM_MOCK=1` 可离线跑通全流程（带 mock 提示）。
9. 检查 `inputs/creation.json`、`messages.json`：无 API Key、无绝对素材路径、追加顺序正确。

### 命令

```bash
pnpm --filter @miaoma/video-project test
pnpm --filter @miaoma/video-agent test
pnpm --filter @miaoma/desktop test
pnpm typecheck && pnpm lint && pnpm format:check
pnpm package   # 冒烟：main bundle 内已内联提示词，不运行时读取 .agents
```

---

## 七、范围边界与风险

不做：
- LangGraph 十节点运行时、检查点、interrupt/resume（T07/T08 后续接管）。
- 流式 IPC / token 打字机。
- 分镜、A3、TTS、素材匹配、时间线、视频概览、导出、编辑器联动。
- 打包态模型密钥配置（仍待 T08 settings + safeStorage）。

风险：
- `?raw` 从 `apps/desktop` 越根导入 `.agents/prompts`，需在第 4 步最早验证；失败则复制模板并加一致性测试。
- 本轮把简报/spec 存在消息 payload 中，未单独写 `analysis/` 文件；后续 T10 可按同一指纹镜像产物，避免双份真相。
- `ProductionSpec` 的 palette/font 使用 v1 固定默认值，文案丰富度会低于原型；后续可加 spec 提示词，但仍保留 literal 校验。
