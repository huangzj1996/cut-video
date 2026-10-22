# @miaoma/video-agent

视频剪辑智能体核心，后续承载 LangGraph 工作流。

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
