import { z } from 'zod';

/**
 * 文稿内容分析（CreativeBrief.scriptAnalysis）。
 *
 * 与 CreativeBriefContent 分开定义：
 * - 结构化简报仍由 JSON mode 生成并做 Zod 校验；
 * - 这里的五段文案由独立流式调用生成，用于消息页的“文稿内容分析”渲染。
 * 两者都随创意简报产物落盘，旧产物缺少该字段时仍可读取。
 */

function sectionText(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

export const ScriptAnalysisContentSchema = z.strictObject({
  intro: sectionText(1_200).describe('文稿分析开场：说明分析对象、整体结构与接下来要做什么'),
  structureIntro: sectionText(600).describe('文稿结构摘要标题：概括主题与段落数量'),
  scriptType: sectionText(1_000).describe('文稿类型判断：类型、依据以及是否需要转写为纯口播'),
  voiceoverScript: sectionText(12_000).describe('纯口播文稿预览，段落之间用空行分隔'),
  schemeRecommendation: sectionText(1_200).describe('制作方案推荐说明及推荐理由'),
});

export type ScriptAnalysisContent = z.infer<typeof ScriptAnalysisContentSchema>;

/** 流式过程中的一段文案；允许为空，尚未生成时前端显示加载态。 */
export const ScriptAnalysisSectionsDraftSchema = z.strictObject({
  intro: z.string().max(1_200),
  structureIntro: z.string().max(600),
  scriptType: z.string().max(1_000),
  voiceoverScript: z.string().max(12_000),
  schemeRecommendation: z.string().max(1_200),
});

export type ScriptAnalysisSectionsDraft = z.infer<typeof ScriptAnalysisSectionsDraftSchema>;

export const ScriptAnalysisDraftSchema = ScriptAnalysisSectionsDraftSchema.extend({
  beats: z
    .array(
      z.strictObject({
        label: z.string().max(80),
        estimatedSeconds: z.number().nonnegative().optional(),
      }),
    )
    .max(8),
});

export type ScriptAnalysisDraft = z.infer<typeof ScriptAnalysisDraftSchema>;

export const EMPTY_SCRIPT_ANALYSIS_SECTIONS: ScriptAnalysisSectionsDraft = {
  intro: '',
  structureIntro: '',
  scriptType: '',
  voiceoverScript: '',
  schemeRecommendation: '',
};

export const EMPTY_SCRIPT_ANALYSIS_DRAFT: ScriptAnalysisDraft = {
  ...EMPTY_SCRIPT_ANALYSIS_SECTIONS,
  beats: [],
};
