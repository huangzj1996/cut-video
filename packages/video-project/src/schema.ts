import { z } from 'zod';

/**
 * 妙剪 Magicut 视频项目模型。
 *
 * 分层顺序与设计图一致：
 * 1. 基础原子类型
 * 2. 资产层
 * 3. 片段层
 * 4. 分镜层
 * 5. 项目层
 *
 * 图中未给出、按需求文档推导的字段均以 `inferred` 标注。
 * 跨轨业务不变量（覆盖、重叠、总时长）不在此处校验，留给 T14/T15。
 */

// ===== 第 1 层：基础原子类型 =====

export const PROJECT_SCHEMA_VERSION = '1.0.0' as const;

export const IdSchema = z.string().min(1);
export const IsoDateSchema = z.iso.datetime({ offset: true });
export const TimeMsSchema = z.number().int().nonnegative();

const volumeSchema = z.number().min(0).max(1);
const speedSchema = z.number().min(0.5).max(2);

// ===== 第 2 层：资产层 =====

export const VideoAssetSchema = z
  .object({
    durationMs: TimeMsSchema,
    // inferred：图片素材没有帧率；视频素材由 refine 强制要求
    fps: z.number().positive().optional(),
    height: z.number().int().positive(),
    id: IdSchema,
    // inferred：需求 §7.1/T14 要求图片静态片段，需要区分视频与图片
    mediaType: z.enum(['video', 'image']),
    path: z.string().min(1),
    thumbnailIds: z.array(IdSchema),
    width: z.number().int().positive(),
  })
  .refine((asset) => asset.mediaType !== 'video' || asset.fps !== undefined, {
    message: 'video asset requires fps',
    path: ['fps'],
  });

export const VoiceAssetSchema = z.object({
  durationMs: TimeMsSchema,
  id: IdSchema,
  // inferred：需求 §4.2/§7.1 要求显式标注模拟配音
  isMock: z.boolean(),
  path: z.string().min(1),
  provider: z.string().min(1),
  voice: z.string().min(1),
});

export const MusicAssetSchema = z.object({
  artist: z.string().min(1).optional(),
  durationMs: TimeMsSchema,
  id: IdSchema,
  path: z.string().min(1),
  title: z.string().min(1).optional(),
});

export const SubtitleAssetSchema = z.object({
  id: IdSchema,
  language: z.string().min(1).optional(),
  text: z.string().min(1),
});

export const ThumbnailAssetSchema = z.object({
  height: z.number().int().positive(),
  id: IdSchema,
  path: z.string().min(1),
  // inferred：关键帧在源视频中的采样位置
  timeMs: TimeMsSchema,
  width: z.number().int().positive(),
});

export const ProjectAssetsSchema = z.object({
  music: z.array(MusicAssetSchema),
  subtitles: z.array(SubtitleAssetSchema),
  thumbnails: z.array(ThumbnailAssetSchema),
  videos: z.array(VideoAssetSchema),
  voices: z.array(VoiceAssetSchema),
});

// ===== 第 3 层：片段层 =====

export const CropSchema = z
  .object({
    height: z.number().gt(0).max(1),
    width: z.number().gt(0).max(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1, {
    message: 'crop exceeds source frame',
    path: ['width'],
  });

export const TransformSchema = z.object({
  scale: z.number().positive(),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
});

const ClipBaseSchema = z
  .object({
    endMs: TimeMsSchema,
    id: IdSchema,
    sceneId: IdSchema.optional(),
    startMs: TimeMsSchema,
  })
  .refine((clip) => clip.endMs > clip.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });

export const VideoClipSchema = ClipBaseSchema.extend({
  assetId: IdSchema,
  crop: CropSchema,
  kind: z.literal('video'),
  sourceEndMs: TimeMsSchema,
  sourceStartMs: TimeMsSchema,
  speed: speedSchema.optional(),
  transform: TransformSchema,
}).refine((clip) => clip.sourceEndMs > clip.sourceStartMs, {
  message: 'sourceEndMs must be greater than sourceStartMs',
  path: ['sourceEndMs'],
});

export const VoiceClipSchema = ClipBaseSchema.extend({
  assetId: IdSchema,
  kind: z.literal('voice'),
  speed: speedSchema.optional(),
  volume: volumeSchema.optional(),
  voicePreset: IdSchema,
});

export const SubtitleClipSchema = ClipBaseSchema.extend({
  assetId: IdSchema,
  kind: z.literal('subtitle'),
  // 可编辑的展示文本；允许与 SubtitleAsset.text 不同
  text: z.string().min(1),
});

export const MusicClipSchema = ClipBaseSchema.extend({
  assetId: IdSchema,
  kind: z.literal('music'),
  // inferred：需求 §9.5 的裁剪/循环
  loop: z.boolean().optional(),
  sourceEndMs: TimeMsSchema,
  sourceStartMs: TimeMsSchema,
  volume: volumeSchema.optional(),
}).refine((clip) => clip.sourceEndMs > clip.sourceStartMs, {
  message: 'sourceEndMs must be greater than sourceStartMs',
  path: ['sourceEndMs'],
});

export const TimelineClipSchema = z.discriminatedUnion('kind', [
  VideoClipSchema,
  VoiceClipSchema,
  SubtitleClipSchema,
  MusicClipSchema,
]);

// ===== 第 4 层：分镜层 =====

export const SceneSchema = z.object({
  durationMs: TimeMsSchema,
  goal: z.string().min(1),
  id: IdSchema,
  index: z.number().int().positive(),
  matchedVideoAssetIds: z.array(IdSchema),
  notes: z.string(),
  script: z.string().min(1),
  subtitleIds: z.array(IdSchema),
  title: z.string().min(1),
  visualIntent: z.string().min(1),
  voiceAssetId: IdSchema,
});

// ===== 第 5 层：项目层 =====

export const ProjectMetadataSchema = z.object({
  contentRevision: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  name: z.string().min(1),
  projectId: IdSchema,
  updatedAt: IsoDateSchema,
});

export const CanvasConfigSchema = z.object({
  aspectRatio: z.literal('16:9'),
  fps: z.literal(30),
  height: z.literal(1080),
  width: z.literal(1920),
});

export const RenderConfigSchema = z.object({
  audioBitrateKbps: z.literal(192),
  audioCodec: z.literal('aac'),
  burnSubtitles: z.literal(true),
  container: z.literal('mp4'),
  sourceAudioMuted: z.literal(true),
  videoCodec: z.literal('h264'),
});

export const AiRunMetadataSchema = z.object({
  completedAt: IsoDateSchema.optional(),
  inputFingerprint: z.string().min(1),
  model: z.string().min(1),
  modelConfigVersion: z.string().min(1),
  provider: z.string().min(1),
  runId: IdSchema,
  startedAt: IsoDateSchema,
});

export const SUBTITLE_PRESET_IDS = [
  'white-outline',
  'classic-white',
  'yellow',
  'red',
  'cyan',
  'pink',
  'blue',
] as const;

export const SubtitleStyleSchema = z.object({
  fontSize: z.number().int().min(24).max(72),
  presetId: z.enum(SUBTITLE_PRESET_IDS),
});

export const VideoTrackSchema = z.object({
  clips: z.array(VideoClipSchema),
  id: IdSchema,
  kind: z.literal('video'),
});

export const VoiceTrackSchema = z.object({
  clips: z.array(VoiceClipSchema),
  id: IdSchema,
  kind: z.literal('voice'),
});

export const SubtitleTrackSchema = z.object({
  clips: z.array(SubtitleClipSchema),
  id: IdSchema,
  kind: z.literal('subtitle'),
  style: SubtitleStyleSchema,
  visible: z.boolean(),
});

export const MusicTrackSchema = z.object({
  clips: z.array(MusicClipSchema),
  id: IdSchema,
  kind: z.literal('music'),
});

export const TimelineTrackSchema = z.discriminatedUnion('kind', [
  VideoTrackSchema,
  VoiceTrackSchema,
  SubtitleTrackSchema,
  MusicTrackSchema,
]);

export const VideoProjectSchema = z.object({
  ai: AiRunMetadataSchema,
  assets: ProjectAssetsSchema,
  canvas: CanvasConfigSchema,
  project: ProjectMetadataSchema,
  render: RenderConfigSchema,
  scenes: z.array(SceneSchema),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  tracks: z.array(TimelineTrackSchema),
});

// ===== 类型导出（全部由 Zod 推导） =====

export type VideoAsset = z.infer<typeof VideoAssetSchema>;
export type VoiceAsset = z.infer<typeof VoiceAssetSchema>;
export type MusicAsset = z.infer<typeof MusicAssetSchema>;
export type SubtitleAsset = z.infer<typeof SubtitleAssetSchema>;
export type ThumbnailAsset = z.infer<typeof ThumbnailAssetSchema>;
export type ProjectAssets = z.infer<typeof ProjectAssetsSchema>;

export type Crop = z.infer<typeof CropSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type VoiceClip = z.infer<typeof VoiceClipSchema>;
export type SubtitleClip = z.infer<typeof SubtitleClipSchema>;
export type MusicClip = z.infer<typeof MusicClipSchema>;
export type TimelineClip = z.infer<typeof TimelineClipSchema>;

export type Scene = z.infer<typeof SceneSchema>;

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export type CanvasConfig = z.infer<typeof CanvasConfigSchema>;
export type RenderConfig = z.infer<typeof RenderConfigSchema>;
export type AiRunMetadata = z.infer<typeof AiRunMetadataSchema>;
export type SubtitleStyle = z.infer<typeof SubtitleStyleSchema>;
export type SubtitlePresetId = (typeof SUBTITLE_PRESET_IDS)[number];

export type VideoTrack = z.infer<typeof VideoTrackSchema>;
export type VoiceTrack = z.infer<typeof VoiceTrackSchema>;
export type SubtitleTrack = z.infer<typeof SubtitleTrackSchema>;
export type MusicTrack = z.infer<typeof MusicTrackSchema>;
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>;

export type VideoProject = z.infer<typeof VideoProjectSchema>;
