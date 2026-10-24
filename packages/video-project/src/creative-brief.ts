import { z } from 'zod';
import { IsoDateSchema } from './schema';
import { ScriptAnalysisContentSchema } from './script-analysis';

/**
 * 创意简报（CreativeBrief）——`creative_brief` 节点的内容产物。
 *
 * 需求 §4.2 要求覆盖：主题、受众、风格、时长、核心信息、叙事结构、覆盖问题。
 * 这里把“模型输出”和“落盘产物”分开：
 * - `CreativeBriefContentSchema`：结构化输出（function calling / jsonMode）直接校验的内容，
 *   不包含版本、指纹、时间等由工作流生成的元数据。
 * - `CreativeBriefSchema`：工作流附加 `briefVersion` / `inputFingerprint` / `generatedAt`
 *   后的完整产物，用于持久化和审批指纹。
 *
 * 注意：`style` 只描述内容调性与节奏；配色、字体、字幕、音色等执行细节属于
 * ProductionSpec，不在创意简报中重复定义。
 */

export const CREATIVE_BRIEF_SCHEMA_VERSION = '1.0.0' as const;

export const CREATIVE_BRIEF_CONTENT_TYPES = [
  'knowledge',
  'product_promo',
  'brand_story',
  'tutorial',
  'opinion',
  'vlog',
  'other',
] as const;

export const CreativeBriefContentTypeSchema = z.enum(CREATIVE_BRIEF_CONTENT_TYPES);

export const CREATIVE_BRIEF_PACING_LEVELS = ['slow', 'medium', 'fast'] as const;

export const CreativeBriefPacingSchema = z.enum(CREATIVE_BRIEF_PACING_LEVELS);

export const CREATIVE_BRIEF_NARRATIVE_STRUCTURE_TYPES = [
  'hook_explain_cta',
  'problem_solution',
  'chronological',
  'listicle',
  'story_arc',
  'other',
] as const;

export const CreativeBriefNarrativeStructureTypeSchema = z.enum(
  CREATIVE_BRIEF_NARRATIVE_STRUCTURE_TYPES,
);

export const CREATIVE_BRIEF_COVERAGE_ISSUE_TYPES = [
  'missing_material',
  'insufficient_material',
  'duration_shortfall',
  'quality_risk',
  'other',
] as const;

export const CreativeBriefCoverageIssueTypeSchema = z.enum(CREATIVE_BRIEF_COVERAGE_ISSUE_TYPES);

export const CREATIVE_BRIEF_COVERAGE_SEVERITIES = ['blocking', 'warning', 'info'] as const;

export const CreativeBriefCoverageSeveritySchema = z.enum(CREATIVE_BRIEF_COVERAGE_SEVERITIES);

function text(maxLength: number) {
  return z.string().trim().min(1).max(maxLength);
}

function textList(maxItems: number, maxLength: number) {
  return z.array(text(maxLength)).min(1).max(maxItems);
}

// ===== 子结构 =====

export const CreativeBriefAudienceSchema = z.object({
  description: text(400).describe('受众特征、使用场景与内容偏好'),
  needs: textList(5, 120).describe('受众希望解决的问题或获得的价值，1–5 条'),
  primary: text(120).describe('主要受众的一句话描述'),
});

export const CreativeBriefStyleSchema = z.object({
  pacing: CreativeBriefPacingSchema.describe('叙事节奏：slow / medium / fast'),
  toneKeywords: textList(6, 20).describe('内容调性关键词，1–6 个'),
  visualTone: text(300).describe('视觉调性描述；不涉及配色、字体、字幕等执行细节'),
});

export const CreativeBriefCoreMessageSchema = z.object({
  callToAction: text(120).optional().describe('可选的行动号召；没有则省略该字段'),
  statement: text(200).describe('一句话核心信息'),
  supportingPoints: textList(5, 160).describe('支撑核心信息的要点，1–5 条'),
});

export const CreativeBriefBeatSchema = z.object({
  estimatedSeconds: z.number().int().min(1).max(300).describe('该段落预计时长（秒）'),
  label: text(40).describe('段落标签，如“开场提问”“解释概念”“收束”'),
  purpose: text(200).describe('该段落在叙事中承担的作用'),
  summary: text(300).describe('该段落的内容摘要'),
});

export const CreativeBriefNarrativeStructureSchema = z.object({
  beats: z
    .array(CreativeBriefBeatSchema)
    .min(2)
    .max(8)
    .describe('按播放顺序排列的叙事段落，2–8 个'),
  type: CreativeBriefNarrativeStructureTypeSchema.describe('叙事结构类型'),
});

export const CreativeBriefCoverageIssueSchema = z.object({
  description: text(300).describe('问题描述，必须基于素材分析摘要'),
  severity: CreativeBriefCoverageSeveritySchema.describe(
    'blocking 表示不解决无法开工；warning 表示需要提示；info 表示一般说明',
  ),
  suggestion: text(300).optional().describe('可选的解决建议'),
  type: CreativeBriefCoverageIssueTypeSchema.describe('素材覆盖问题类型'),
});

// ===== 模型输出：创意简报内容 =====

const creativeBriefContentObject = z.object({
  audience: CreativeBriefAudienceSchema,
  contentType: CreativeBriefContentTypeSchema.describe('文稿类型'),
  coreMessage: CreativeBriefCoreMessageSchema,
  coverageIssues: z
    .array(CreativeBriefCoverageIssueSchema)
    .max(20)
    .describe('素材覆盖问题；没有问题时输出空数组 []'),
  durationSeconds: z.number().int().min(15).max(300).describe('目标成片时长（秒），15–300 秒'),
  narrativeStructure: CreativeBriefNarrativeStructureSchema,
  openQuestions: z.array(text(200)).max(10).describe('需要用户确认的问题；没有时输出空数组 []'),
  style: CreativeBriefStyleSchema,
  summary: text(600).describe('简介：概括视频内容与目标的一段话'),
  title: text(80).describe('工作标题'),
  topic: text(200).describe('视频主题'),
});

/**
 * 模型提交的创意简报内容。
 *
 * `superRefine` 校验叙事段落总时长与目标时长的偏差；该约束属于业务校验，
 * 不会出现在导出的 JSON Schema 中，仍需在模型输出通过结构校验后由 Zod 执行。
 */
export const CreativeBriefContentSchema = creativeBriefContentObject.superRefine((brief, ctx) => {
  const totalSeconds = brief.narrativeStructure.beats.reduce(
    (total, beat) => total + beat.estimatedSeconds,
    0,
  );
  const toleranceSeconds = Math.max(5, Math.round(brief.durationSeconds * 0.2));

  if (Math.abs(totalSeconds - brief.durationSeconds) > toleranceSeconds) {
    ctx.addIssue({
      code: 'custom',
      message: `narrative beats total ${totalSeconds}s differs from durationSeconds ${brief.durationSeconds}s by more than ${toleranceSeconds}s`,
      path: ['narrativeStructure', 'beats'],
    });
  }
});

// ===== 落盘产物：内容 + 工作流元数据 =====

/**
 * `scriptAnalysis` 由独立的流式调用生成，作为消息页展示内容随简报落盘。
 * 旧版本产物没有该字段，保持可选以支持直接读取历史工程。
 */
export const CreativeBriefSchema = CreativeBriefContentSchema.extend({
  scriptAnalysis: ScriptAnalysisContentSchema.optional(),
  briefVersion: z.number().int().positive(),
  generatedAt: IsoDateSchema,
  inputFingerprint: z.string().min(1),
  schemaVersion: z.literal(CREATIVE_BRIEF_SCHEMA_VERSION),
});

// ===== 类型导出（全部由 Zod 推导） =====

export type CreativeBriefContentType = z.infer<typeof CreativeBriefContentTypeSchema>;
export type CreativeBriefPacing = z.infer<typeof CreativeBriefPacingSchema>;
export type CreativeBriefNarrativeStructureType = z.infer<
  typeof CreativeBriefNarrativeStructureTypeSchema
>;
export type CreativeBriefCoverageIssueType = z.infer<typeof CreativeBriefCoverageIssueTypeSchema>;
export type CreativeBriefCoverageSeverity = z.infer<typeof CreativeBriefCoverageSeveritySchema>;

export type CreativeBriefAudience = z.infer<typeof CreativeBriefAudienceSchema>;
export type CreativeBriefStyle = z.infer<typeof CreativeBriefStyleSchema>;
export type CreativeBriefCoreMessage = z.infer<typeof CreativeBriefCoreMessageSchema>;
export type CreativeBriefBeat = z.infer<typeof CreativeBriefBeatSchema>;
export type CreativeBriefNarrativeStructure = z.infer<typeof CreativeBriefNarrativeStructureSchema>;
export type CreativeBriefCoverageIssue = z.infer<typeof CreativeBriefCoverageIssueSchema>;

export type CreativeBriefContent = z.infer<typeof CreativeBriefContentSchema>;
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;
