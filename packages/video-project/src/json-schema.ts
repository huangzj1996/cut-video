import { z } from 'zod';
import { ChatLogSchema, ChatMessageSchema, ChatStreamEventSchema } from './chat';
import { CreativeBriefContentSchema, CreativeBriefSchema } from './creative-brief';
import { ScriptAnalysisContentSchema } from './script-analysis';
import {
  DraftProjectSchema,
  SceneSchema,
  StoredProjectSchema,
  TimelineClipSchema,
  VideoProjectSchema,
} from './schema';
import { AnalyzedAssetCollectionSchema } from './workflow/analyzed-assets';
import { AssetManifestSchema } from './workflow/asset-manifest';
import { AssetMatchCollectionSchema } from './workflow/asset-matches';
import { CreationInputSchema } from './workflow/creation-input';
import { ProductionSpecSchema } from './workflow/production-spec';
import { RunEventSchema } from './workflow/run-event';
import { SavedProjectRefSchema } from './workflow/saved-project';
import { ScenePlanContentSchema, ScenePlanSchema } from './workflow/scene-plan';
import { WorkflowStateSchema } from './workflow/state';
import { ValidationReportSchema } from './workflow/validation-report';
import { VoiceSegmentCollectionSchema } from './workflow/voice-segments';

export type JsonSchema = z.core.JSONSchema.BaseSchema;

const JSON_SCHEMA_OPTIONS = {
  target: 'draft-2020-12',
  io: 'output',
  unrepresentable: 'throw',
  cycles: 'throw',
  reused: 'inline',
} as const;

const cache = new WeakMap<z.ZodType, JsonSchema>();

/**
 * 将 Zod Schema 导出为 JSON Schema（draft 2020-12）。
 *
 * 注意：`z.refine` / `superRefine` 属于业务约束，不会出现在 JSON Schema 中；
 * JSON Schema 仅覆盖结构约束，业务校验由节点执行。
 */
export function getJsonSchema(schema: z.ZodType): JsonSchema {
  const cached = cache.get(schema);
  if (cached !== undefined) {
    return cached;
  }

  const jsonSchema = z.toJSONSchema(schema, JSON_SCHEMA_OPTIONS);
  cache.set(schema, jsonSchema);
  return jsonSchema;
}

export const JSON_SCHEMA_EXPORTS = {
  analyzedAssets: AnalyzedAssetCollectionSchema,
  assetManifest: AssetManifestSchema,
  assetMatches: AssetMatchCollectionSchema,
  chatLog: ChatLogSchema,
  chatMessage: ChatMessageSchema,
  chatStreamEvent: ChatStreamEventSchema,
  creationInput: CreationInputSchema,
  creativeBrief: CreativeBriefSchema,
  creativeBriefContent: CreativeBriefContentSchema,
  draftProject: DraftProjectSchema,
  productionSpec: ProductionSpecSchema,
  runEvent: RunEventSchema,
  savedProjectRef: SavedProjectRefSchema,
  scene: SceneSchema,
  scenePlan: ScenePlanSchema,
  scenePlanContent: ScenePlanContentSchema,
  scriptAnalysis: ScriptAnalysisContentSchema,
  storedProject: StoredProjectSchema,
  timelineClip: TimelineClipSchema,
  validationReport: ValidationReportSchema,
  videoProject: VideoProjectSchema,
  voiceSegments: VoiceSegmentCollectionSchema,
  workflowState: WorkflowStateSchema,
} as const;
