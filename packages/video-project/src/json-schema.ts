import { z } from 'zod';
import {
  DraftProjectSchema,
  SceneSchema,
  StoredProjectSchema,
  TimelineClipSchema,
  VideoProjectSchema,
} from './schema';

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
 * 注意：`z.refine` 属于业务约束，不会出现在 JSON Schema 中；
 * JSON Schema 仅覆盖结构约束，业务校验由 T14/T15 负责。
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
  draftProject: DraftProjectSchema,
  scene: SceneSchema,
  storedProject: StoredProjectSchema,
  timelineClip: TimelineClipSchema,
  videoProject: VideoProjectSchema,
} as const;
