# Issue #10 端到端验收记录

> 本票只做跨切片验收与收口，不新增横向测试层。
> **能由单测/门禁证明的写「通过」；需要在 GUI 中点击、播放、听声、看画面的条目一律列在
> 「需人工验证」，没有写成已通过。** 数据级核对用的一次性 vitest 脚本运行后已删除，未提交。

## 1. 元信息

| 项       | 值                                                                       |
| -------- | ------------------------------------------------------------------------ |
| 验收日期 | 2026-10-29（Asia/Shanghai）                                              |
| 分支     | `sandcastle/issue-10`，从基线 `4da2796`（已含 #2～#9 全部切片）拉出      |
| 执行者   | Sandcastle implementer agent（DSH desktop profile，模型 deepseek-flash） |
| 应用版本 | `0.1.0`，工程 `schemaVersion` 为 `1.0.0`                                 |
| 本票改动 | 时间线假开关收口（S2）+ 本验收记录；无产品行为变更                       |

## 2. 环境

| 项                      | 值                                                                          |
| ----------------------- | --------------------------------------------------------------------------- |
| 机器                    | `ADMINH`（Windows 11 家庭中文版 10.0.22000，build 22000）                   |
| CPU / 内存              | Intel Core i5-12400F / 15.8 GB                                              |
| Node.js                 | v20.19.2                                                                    |
| pnpm                    | 10.28.1（`packageManager` 固定 `pnpm@10.28.1`，`nodeLinker: hoisted`）      |
| TypeScript / Vitest     | 5.9.3 / 4.1.12                                                              |
| Electron / React / Vite | 38.8.6 / 19.3.1 / 6.4.5（`apps/desktop` 声明值）                            |
| DSH                     | desktop profile，GUI `http://127.0.0.1:49731`；DSH 版本号未通过环境变量暴露 |
| 项目目录                | `C:\Users\11132\Documents\妙剪`（应用设置默认目录，共 6 个工程）            |

**限制（决定了本票只能做数据级验收）**：

- 本 worktree 只安装了 JS 依赖，`node_modules/electron` 缺 `dist`，`electron --version`
  直接报 `Electron failed to install correctly` —— agent 无法启动桌面应用。
- `resources/ffmpeg` 在 worktree 与主工作区都不存在，`workflow-integration.test.ts` 的 2 例
  按设计 `skipIf(!HAS_FFMPEG)` 跳过。
- agent 没有可交互的 GUI 会话，也不能写主工作区/用户工程，因此播放、切镜、听感、视觉、
  关窗时序等只能人工验证。

## 3. 样本

### 3.1 真实工程（只读，未改动）

| 样本        | 路径                                                                                 | 分镜 | 时长                | 轨道片段（video/voice/subtitle/music） | 素材文件                                       |
| ----------- | ------------------------------------------------------------------------------------ | ---- | ------------------- | -------------------------------------- | ---------------------------------------------- |
| 4 分镜      | `C:\Users\11132\Documents\妙剪\b0fca062-095e-4c25-b871-9f3d8af6f175`（「城市美景」） | 4    | 6822 ms（`00:06`）  | 4 / 4 / 4 / 0                          | videos 3、voices 4（均为 `mock-tts` 模拟配音） |
| 8 分镜      | `C:\Users\11132\Documents\妙剪\06b07add-c295-414b-9707-54e0ed45e168`（「顶顶顶」）   | 8    | 36844 ms（`00:36`） | 8 / 8 / 11 / 0                         | videos 3、voices 8（均为 `mock-tts` 模拟配音） |
| 备用 4 分镜 | `...\bfa260ea-fbab-4179-b7cd-7eea3ebee295`（「城市美景」）                           | 4    | 8275 ms             | 4 / 4 / 5 / 0                          | —                                              |
| 草稿样本    | `...\416de714-…`、`...\e2f5a9f4-…`、`...\f7a99330-…`                                 | 0    | —                   | —                                      | 无 `ai` 字段                                   |

两个验收工程的画面素材路径指向主仓库 `docs\video\*.mp4`，配音 WAV 位于工程目录
`generated\voices\…`；数据级核对确认 **全部素材文件存在**（见 4.1）。

### 3.2 临时副本（需人工创建）

本 worktree 的写入边界只允许写 worktree，agent **没有创建**下面两份副本。
人工验收时在系统临时目录创建，不提交、不动用户原工程：

```powershell
$src = 'C:\Users\11132\Documents\妙剪'
$tmp = Join-Path $env:TEMP 'magicut-acceptance'

# 1) 音乐副本：复制 4 分镜工程
New-Item -ItemType Directory -Force "$tmp\music" | Out-Null
Copy-Item -Recurse "$src\b0fca062-095e-4c25-b871-9f3d8af6f175" "$tmp\music\"

# 2) 缺失素材副本：复制 8 分镜工程后删掉一条副本内的配音
New-Item -ItemType Directory -Force "$tmp\missing" | Out-Null
Copy-Item -Recurse "$src\06b07add-c295-414b-9707-54e0ed45e168" "$tmp\missing\"
Remove-Item (Get-ChildItem "$tmp\missing\06b07add-c295-414b-9707-54e0ed45e168\generated\voices" -Recurse -Filter 'scene-03.wav' | Select-Object -First 1).FullName
```

启动应用指向临时目录（目录名必须保持工程 UUID）：

```powershell
$env:MIAOMA_PROJECT_DIR = "$tmp\music"     # 或 "$tmp\missing"
pnpm --filter @miaoma/desktop start
```

音乐副本还需在 `project.json` 里登记一条音乐素材并给已有 `music` 轨加片段（v1 音乐面板写操作
disabled，只能外部构造）：准备一个本地音频文件（mp3/m4a/wav）放到副本目录，然后加
`assets.music: [{ id, path, durationMs, title? }]`，并在 `tracks` 的 `kind: "music"` 轨
`clips` 里加 `{ id, kind: "music", assetId, startMs, endMs, sourceStartMs, sourceEndMs, loop }`，
`path` 用绝对路径。

## 4. 通过项（可由测试/门禁证明）

### 4.1 数据级核对：真实工程 → 主进程 → 编辑器纯函数

方法：一次性 vitest 脚本（运行后删除，不提交）用 `ProjectStore` 读取真实 `project.json`，
再调用 `buildEditorProjectView` / `buildEditorTimeline` / `buildPreviewMediaPlan` /
`resolveSubtitleOverlay` / `collectMissingMedia` / `loadEditorProject`。

| 核对项                                                    | 结果                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectStore.list()`                                     | 列出 6 个工程目录；其中 3 个有分镜（4/8/4）+ 3 个草稿（`isDraft`，直接读 JSON 统计）                                                                                                               |
| 两个验收工程 `ProjectStore.get()` + `StoredProjectSchema` | 通过；`contentRevision` 均为 1                                                                                                                                                                     |
| 素材文件存在性（videos + voices）                         | 两个工程均 `assetFilesMissing=0`                                                                                                                                                                   |
| 编辑器视图                                                | 4 分镜工程 `scenes=4 / duration=00:06`；8 分镜工程 `scenes=8 / duration=00:36`                                                                                                                     |
| 时间线四轨片段数                                          | 4 分镜：video 4 / voice 4 / subtitle 4 / music 0；8 分镜：8 / 8 / 11 / 0                                                                                                                           |
| 缺失素材检测                                              | 两个工程 `collectMissingMedia=0`                                                                                                                                                                   |
| 预览计划（播放头=时长一半）                               | 4 分镜 `t=3.411s` → `clip-video-scene-02`、source `2.402s`、next `clip-video-scene-03`；8 分镜 `t=18.422s` → `clip-video-scene-05`、source `7.258s`、next `clip-video-scene-06`；均无 `videoIssue` |
| 模拟配音标记                                              | 两个工程 `voice.isMock=true`（预览显示「模拟配音」的数据来源成立）                                                                                                                                 |
| 空音乐轨                                                  | 两个工程 `music=null`（不创建音频元素的数据前提成立）                                                                                                                                              |
| 字幕叠层                                                  | 两个工程均解析出文本、`preset=white-outline`、`fontSize=40`、字号换算 CSS                                                                                                                          |
| 缺失素材变体（内存内移除一条视频素材，不写盘）            | 时间线报「视频素材缺失：分镜 01」，预览 `video=null`、`issue=missing-asset`（不静默黑屏）                                                                                                          |
| 草稿工程                                                  | `loadEditorProject` 返回 `kind=draft`                                                                                                                                                              |
| 损坏工程                                                  | 返回 `kind=error`、`code=PROJECT_INVALID`（走错误页分支，不崩溃）                                                                                                                                  |

### 4.2 跨切片单测（`pnpm test` 全绿）

| 范围          | 文件（用例数）                                                                                                  | 与本票验收点的关系                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 编辑模型      | `project-edit.test.ts`（47）                                                                                    | 排序/裁剪/分割/删除/不变量拒绝                                    |
| 会话与撤销    | `editor-session.test.ts`（21）、`undo-stack.test.ts`（7）                                                       | 选中、dirty、undo/redo、只读/冲突不可编辑                         |
| 自动保存      | `autosave.test.ts`（10）                                                                                        | 2s 防抖、30s 上限、flush                                          |
| 保存契约      | `project-store.test.ts`（20）                                                                                   | `expectedRevision` 匹配/冲突不覆盖、草稿/损坏/版本不支持          |
| 关窗 flush    | `close-flush.test.ts`（6）                                                                                      | 收到回执才关窗、2s 超时放行、重复 close 复用握手                  |
| 媒体协议      | `asset-protocol.test.ts`（19）                                                                                  | assetId 白名单、路径穿越、MIME、Range/416/404、GET/HEAD           |
| 预览          | `preview-media.test.ts`（30）、`media-sync.test.ts`（18）、`playback.test.ts`（15）、`video-slots.test.ts`（9） | 时间映射/活动片段/漂移 50ms/音乐循环/双 video 交换调度/播放状态机 |
| 字幕          | `subtitle-overlay.test.ts`（24）                                                                                | 活动区间、preset、字号 clamp、canonical 文本                      |
| 时间线        | `timeline-geometry.test.ts`（21）、`reorder-drag.test.ts`（5）、`waveform.test.ts`（15）                        | 刻度/缩放/片段布局/拖拽排序/真实峰值                              |
| 右侧面板      | `project-view.test.ts`（24）                                                                                    | 真实分镜上下文、标签、模拟配音标签、更新时间                      |
| 工作流        | `editor-status.test.ts`（7）、`run-manager.test.ts`（2）                                                        | 只读状态映射、运行态                                              |
| 领域/工作流包 | `video-project` 72、`video-agent` 146（另有 2 例 live LLM 测试按 `MIAOMA_LLM_LIVE=0` skip）                     | Schema、校验器、时间线组装                                        |

### 4.3 收口清理

- **S2（假开关）已修**：时间线「吸附」「联动」此前只切本地 state、没有任何行为。现改为
  `disabled` + `title="吸附将在后续版本提供" / "联动将在后续版本提供"`，与「新增轨道」一致
  （`EditorVideoScreen.tsx` 的 `TimelineTool.future`、工具栏渲染处）。「波形」保留真实行为
  （真实峰值柱，`useAudioWaveforms` + `waveformsVisible`）。
- mock 残留审计（`EditorVideoScreen` + `editor-video/*` + `panels/*` + `EditorStates`）：时间线、
  左侧分镜列表、画面面板、顶栏都只用真实工程数据，未再发现 mock 分镜/文稿/音乐文案；这些
  编辑器文件里没有「既无 handler 又未 disabled」的按钮（创建页的「输入文稿」标签是当前选中的
  标签页，不属于死按钮）。
- 保留但已**明确标注后续**的 UI（符合「保留按钮必须有真实行为或明确后续提示」）：
  渲染导出（点击提示 T19）、快捷调整输入/解除关联/发送（disabled + tooltip）、新增轨道
  （disabled + `title`）、口播/字幕/音乐面板（PRD D7：面板保持 mock，写操作 disabled 且
  带「后续」说明）。
- 范围外观察：`WorkspaceScreen.tsx` 仍有 `DEMO_PROJECTS`，只在没有 `window.miaoma.project`
  桥接时（浏览器调试）作为回退；Electron 内不会出现，且不属于本票点名的编辑器 mock 残留，
  未改动。

### 4.4 门禁

`pnpm typecheck && pnpm test && pnpm lint && pnpm format:check` 全部通过（退出码 0）：

```
typecheck: packages/video-project Done；packages/video-agent Done；apps/desktop Done
test:      video-project  6 files /  72 passed
           video-agent   20 passed | 1 skipped files；146 passed | 2 skipped tests
           desktop       36 passed | 1 skipped files；418 passed | 2 skipped tests
lint:      eslint .（0 error，退出码 0）
format:    All matched files use Prettier code style!
```

## 5. 未通过 / 需人工验证项（agent 无法验证，均未标记为通过）

1. **4 分镜工程闭环**：进入编辑器 → 播放/暂停/拖动播放头/时间码跳转 → 编辑（排序/裁剪/分割）
   → 自动保存 → 关闭重开，轨道与内容恢复。
2. **8 分镜工程闭环**：同上，并关注长时间播放的累计漂移与切镜。
3. **编辑后立即关窗不丢最后编辑**：2s flush 握手的真实时序（单测只覆盖协调器逻辑，
   没有覆盖 Electron 关窗时序）。
4. **临时音乐工程**：可播放、可裁剪、可分割音乐；音乐与画面同步；`loop` 听感。
5. **临时缺失素材工程**：删除真实媒体文件后工程仍可打开，视频/配音显示占位与「缺失」
   标记，无静默黑屏（数据级只覆盖「素材未登记」路径，未覆盖「文件 404」路径）。
6. **工作流只读**：运行/等待审批时只读横幅、编辑被拒绝、解锁后恢复；以及 S1 场景
   （只读期间关窗，dirty 编辑丢失是否发生）。
7. **保存冲突 UI**：另一处修改工程 → 保存冲突红色状态 + 「重新加载」入口 + 重新加载后内容。
8. **空音乐轨界面**：音乐轨空状态文案与时间线占位（数据级只证明 `music=null`）。
9. **草稿/损坏工程 UI**：草稿进入编辑器跳回创作消息页；损坏工程显示错误页并可返回工作台。
10. **双 video 交换**：切镜瞬间无长时间黑屏；主时钟唯一。
11. **字幕视觉**：`white-outline` 样式、字号 40、底部安全区、全屏/窗口缩放跟随。
12. **波形与音频**：真实峰值柱、静音平线、播放声音与画面同步、静音按钮。
13. **全屏与快捷键**：全屏作用于预览舞台并可退出；Space/Delete/Ctrl+Z/Ctrl+Y/Ctrl+S/
    方向键/PageUp/PageDown/Home/End。
14. **控制台**：整个验收流程无未捕获错误（需 DevTools 观察）。

## 6. 遗留问题

1. **S1（已知，未修）**：只读或保存冲突时 `canSaveSession` 为 false，`persistProject` 直接
   返回；关窗 flush 也走这条路径。因此「先编辑产生 dirty → 工作流开始运行/等待审批变为只读
   → 关窗」时，最后一次未保存编辑会丢失（冲突态同理，属于不覆盖别处新修订的既定取舍）。
   需要用户提示或只读时强制保存策略，本票未改行为。
2. **S3（已知，未修）**：画面面板「创作倾向」是固定值 `AI 智能创作（默认）`
   （`project-view.ts` 注释指向 PRD §9.2：v1 仅 AI 智能创作），无法反映真实工程意图；
   属于已接受的 v1 偏离。
3. **新偏离 D9**：时间线「吸附/联动」从可切换改为禁用（见第 7 节），需要写回 PRD 偏离表。
4. **工作流集成测试 2 例 skip**：本机/worktree 缺 `resources/ffmpeg`，`workflow-integration`
   的完整流程测试没有执行；门禁仍绿，但不能据此宣称工作流端到端通过。
5. **临时副本未创建**：受「只写 worktree」边界限制，音乐/缺失素材副本需人工按 3.2 创建。
6. **内嵌 dev 回退**：`WorkspaceScreen` 的 `DEMO_PROJECTS` 仅在没有 preload 桥接时出现，
   本票未清理（范围外，建议后续票处理）。
7. **Electron 未安装**：worktree 的 Electron 二进制缺失，若后续要跑 GUI 冒烟，需先在有
   Electron 的环境安装依赖（本票禁止 `pnpm install`，未执行）。

## 7. 新偏离（需写回 spec）

| 编号 | 偏离                                                               | 原因                                                               | 影响                                                                                                       |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| D9   | 时间线「吸附」「联动」开关不再是可切换控件，改为禁用并提示后续版本 | 两者此前只切本地 state、无任何行为（S2），保留可点击开关会误导用户 | PRD 中「吸附默认开启；联动开关表现为选中联动高亮」在本轮不成立；吸附/联动实现需后续票，PRD 偏离表应补记 D9 |

> 按 Sandcastle 边界，本票未直接编辑 GitHub issue #1（PRD）正文；D9 记录于此，
> 由 Lead/后续票同步到 PRD 的「已记录的偏离」表。
