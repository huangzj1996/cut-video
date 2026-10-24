# .agents

AI 技能配置与提示词模板目录。

- `prompts/`：创作智能体的提示词模板。
  - `system.md`：创作制片智能体的通用角色与约束占位模板。
  - `creative-brief.md`：创意简报的合并参考模板（角色、任务、输出约束、示例）。
  - `creative-brief.system.md` / `creative-brief.user.md`：运行时实际使用的 system / user 模板，对应
    `packages/video-project/src/creative-brief.ts` 的 `CreativeBriefContentSchema`。
  - `script-analysis.system.md` / `script-analysis.user.md`：文稿内容分析的流式模板，对应
    `ScriptAnalysisContentSchema`；输出五段带标记的纯文本，供创作消息页流式渲染。
  - `plan-scenes.system.md` / `plan-scenes.user.md`：分镜规划节点的运行时模板，对应
    `ScenePlanContentSchema`。
- 运行时由 `apps/desktop/main/workflow/prompts.ts` 通过 Vite `?raw` 在构建期内联；
  打包后不依赖仓库中的 `.agents` 目录。
- 占位符使用 Mustache 语法（`{{script}}`、`{{brief}}` 等）；缺失输入由 `renderPrompt` 填「无」。
- 不存放 API 密钥、账号信息或用户素材。
- 产品行为以 `docs/requirements/` 为准；UI 以 `docs/design/miaoma-magicut.pen` 为准。
