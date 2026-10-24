import {
  ProductionSpecSchema,
  type CreativeBriefContent,
  type ProductionSpec,
  type VoicePresetId,
} from '@miaoma/video-project';
import { computeFingerprint } from '../fingerprint';
import { getVoicePreset } from '@miaoma/video-project';

const CONTENT_TYPE_LABELS: Record<CreativeBriefContent['contentType'], string> = {
  knowledge: '知识口播',
  product_promo: '产品种草',
  brand_story: '品牌故事',
  tutorial: '教程讲解',
  opinion: '观点表达',
  vlog: '生活记录',
  other: '短视频',
};

const PACING_LABELS: Record<CreativeBriefContent['style']['pacing'], string> = {
  slow: '舒缓',
  medium: '平稳',
  fast: '快节奏',
};

const NARRATIVE_LABELS: Record<CreativeBriefContent['narrativeStructure']['type'], string> = {
  hook_explain_cta: '开场钩子 → 解释 → 行动号召',
  problem_solution: '提出问题 → 给出方案',
  chronological: '按时间顺序推进',
  listicle: '要点列表式推进',
  story_arc: '故事起承转合',
  other: '自由叙事结构',
};

export function buildProductionSpec(input: {
  brief: CreativeBriefContent;
  voicePresetId: VoicePresetId;
  specVersion: number;
}): ProductionSpec {
  const { brief, voicePresetId, specVersion } = input;
  const voice = getVoicePreset(voicePresetId);
  const targetSeconds = brief.durationSeconds;
  const minSeconds = Math.max(15, Math.round(targetSeconds * 0.85));
  const maxSeconds = Math.min(300, Math.round(targetSeconds * 1.15));
  const base = {
    schemaVersion: '1.0.0' as const,
    specVersion,
    videoType: CONTENT_TYPE_LABELS[brief.contentType],
    recommendedScheme: 'material_edit' as const,
    visualStyle: brief.style.visualTone,
    palette: {
      name: '中性自然',
      description: '低饱和暖色，突出真实素材与口播内容。',
    },
    font: {
      family: '思源黑体',
      usage: '字幕与标题',
    },
    voiceProfile: {
      presetId: voice.id,
      displayName: voice.name,
      description: voice.description,
      speed: voice.speed,
    },
    subtitleStyle: {
      presetId: 'white-outline' as const,
      fontSize: 40,
    },
    materialStrategy:
      '从已导入素材中按分镜画面意图匹配，只使用直切；缺失或覆盖不足的素材写入校验问题。',
    rhythm: `${PACING_LABELS[brief.style.pacing]}；${NARRATIVE_LABELS[brief.narrativeStructure.type]}`,
    deliverySpec: {
      container: 'mp4' as const,
      videoCodec: 'h264' as const,
      audioCodec: 'aac' as const,
      audioBitrateKbps: 192 as const,
      burnSubtitles: true as const,
    },
    aspectRatio: '16:9' as const,
    resolution: '1920x1080' as const,
    fps: 30 as const,
    durationRange: {
      minSeconds,
      maxSeconds,
      targetSeconds,
    },
    sourceAudioMuted: true as const,
    normalizationNotes: [] as string[],
  };

  return ProductionSpecSchema.parse({
    ...base,
    contentFingerprint: computeFingerprint(base),
  });
}
