import type { PromptName, PromptProvider, PromptTemplate } from '@miaoma/video-agent/workflow';
import creativeBriefSystem from '../../../../.agents/prompts/creative-brief.system.md?raw';
import creativeBriefUser from '../../../../.agents/prompts/creative-brief.user.md?raw';
import planScenesSystem from '../../../../.agents/prompts/plan-scenes.system.md?raw';
import planScenesUser from '../../../../.agents/prompts/plan-scenes.user.md?raw';
import scriptAnalysisSystem from '../../../../.agents/prompts/script-analysis.system.md?raw';
import scriptAnalysisUser from '../../../../.agents/prompts/script-analysis.user.md?raw';

const TEMPLATES: Record<PromptName, PromptTemplate> = {
  'creative-brief': {
    system: creativeBriefSystem,
    user: creativeBriefUser,
  },
  'script-analysis': {
    system: scriptAnalysisSystem,
    user: scriptAnalysisUser,
  },
  'plan-scenes': {
    system: planScenesSystem,
    user: planScenesUser,
  },
};

/**
 * 提示词在构建期内联进 main bundle，打包后不依赖仓库里的 `.agents`。
 * 如果 Vite 打包失败，退化为把模板复制到 main/workflow/prompts/ 并加一致性测试。
 */
export const desktopPromptProvider: PromptProvider = {
  get(name: PromptName): PromptTemplate {
    return TEMPLATES[name];
  },
};
