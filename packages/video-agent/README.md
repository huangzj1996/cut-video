# @miaoma/video-agent

视频剪辑智能体核心，后续承载 LangGraph 工作流。

## 媒体处理（`src/media/`）

- `video-probe.ts`：调用 ffprobe 提取时长、显示/编码分辨率、帧率、VFR/HDR、编码、旋转与音频流；`probeVideoResult` 返回结构化成功/失败，`probeVideo` 保留 `null` 兼容行为。
- `keyframe-extractor.ts`：按视频时长动态抽帧（每 5 秒一帧，最多 8 帧），长边不超过 768，JPEG 输出；按文件内容 SHA-256 缓存到 `<cacheRoot>/<hash>/`，单帧失败不影响其余帧。
- `media-error.ts`：统一的 `MediaError` 分类（损坏、不支持格式、权限、超时、二进制缺失、输出失败）与带超时/输出上限的 `runMediaProcess`。

这些模块只依赖 Node 内置模块，由调用方传入 ffmpeg/ffprobe 路径，可在 Electron 主进程、utilityProcess 或测试中复用。

## LLM Provider（`./llm`）

通过子路径 `@miaoma/video-agent/llm` 引入，不从包根 barrel 导出，避免只是导入媒体能力时把 LangChain 一并带入 bundle。

```ts
import { chat, createDeepSeekProviderFromEnv } from '@miaoma/video-agent/llm';

const provider = createDeepSeekProviderFromEnv();
const result = await chat(provider, '你好');
console.log(result.text);
```

- `LlmProvider` 当前提供两个基础方法：
  - `generate(messages, options?)`：非流式对话，返回文本、`reasoning`、usage、finishReason。
  - `stream(messages, options?)`：SSE 流式事件（`reasoning` / `content` / `usage` / `done`）。
- `chat(provider, input, options?)` 是基础对话封装：字符串输入会自动组装 system + user 消息；也接受完整消息历史。
- `createDeepSeekProvider(config)` 使用 ChatOpenAI + DeepSeek 兼容接口，默认 `https://api.deepseek.com`、`deepseek-chat`、120s 超时。
  - 显式 `maxRetries: 0`，禁用 LangChain `AsyncCaller` 与 SDK 重试；重试预算留给后续工作流层。
  - 错误统一为 `LlmError`（认证、余额、权限、限流、上下文溢出、超时、取消、网络、空响应等），消息为安全中文，不包含 key、prompt 或原始响应。
  - 显式传入 API Key，并阻断 `OPENAI_API_KEY` / `OPENAI_ORG_ID` / `OPENAI_PROJECT_ID` 回退。
- 结构化输出（function calling / jsonMode）暂未实现，后续在 Provider 之上单独设计。

开发态环境变量（仓库根 `.env`）：

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

真实 API 冒烟测试默认跳过；显式开启：

```bash
MIAOMA_LLM_LIVE=1 pnpm --filter @miaoma/video-agent exec vitest run src/llm/deepseek.live.test.ts
```

## LangGraph 工作流契约

T01 只建立稳定的节点/阶段契约：

- 10 个内部节点，顺序与需求文档一致。
- 4 个用户可见阶段：准备、创建分镜、配音生成、视频生成。
- `synthesize_voice` 位于 `match_assets` 之前，保证素材入出点以配音时长为准。

依赖已按 Node 20 兼容性锁定：

- `@langchain/langgraph` 1.5.2
- `@langchain/core` 1.2.20
- `@langchain/openai` 1.5.0（1.6.x 要求 Node >= 22）
- `@langchain/langgraph-checkpoint` 1.2.1
- `zod` 4.6.7

T02 将验证 LangGraph 在 Electron utilityProcess 中的运行、JSON checkpointer、`interrupt`/`Command` 和打包；T07 实现完整运行时。
