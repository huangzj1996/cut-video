import { z } from 'zod';
import { IdSchema, IsoDateSchema } from '../schema';

export const SCENE_PLAN_SCHEMA_VERSION = '1.0.0' as const;

export const SCENE_ID_PATTERN = /^scene-\d{2,}$/;

/** 模型输出：不包含 ID、毫秒时长等由工作流派生的元数据。 */
export const ScenePlanContentSceneSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  script: z.string().trim().min(1).max(2_000),
  visualIntent: z.string().trim().min(1).max(300),
  goal: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).optional(),
  estimatedSeconds: z.number().int().min(1).max(300),
});

export type ScenePlanContentScene = z.infer<typeof ScenePlanContentSceneSchema>;

export const ScenePlanContentSchema = z.strictObject({
  scenes: z.array(ScenePlanContentSceneSchema).min(1).max(30),
  summary: z.string().trim().min(1).max(600).optional(),
  issues: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
});

export type ScenePlanContent = z.infer<typeof ScenePlanContentSchema>;

export const ScenePlanIssueSchema = z.strictObject({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(['warning', 'info']),
  message: z.string().trim().min(1).max(300),
  sceneId: IdSchema.optional(),
});

export type ScenePlanIssue = z.infer<typeof ScenePlanIssueSchema>;

export const ScenePlanSceneSchema = z.strictObject({
  id: z.string().regex(SCENE_ID_PATTERN),
  index: z.number().int().positive(),
  title: z.string().trim().min(1).max(80),
  script: z.string().trim().min(1).max(2_000),
  visualIntent: z.string().trim().min(1).max(300),
  goal: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500),
  estimatedDurationMs: z.number().int().positive(),
  shotType: z.literal('cut'),
  sourceBeatIndex: z.number().int().nonnegative().optional(),
  issues: z.array(ScenePlanIssueSchema).max(10),
});

export type ScenePlanScene = z.infer<typeof ScenePlanSceneSchema>;

export const ScenePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(SCENE_PLAN_SCHEMA_VERSION),
    scenePlanVersion: z.number().int().positive(),
    projectId: IdSchema,
    inputFingerprint: z.string().trim().min(1).max(128),
    generatedAt: IsoDateSchema,
    scenes: z.array(ScenePlanSceneSchema).min(1).max(30),
    issues: z.array(ScenePlanIssueSchema).max(30),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set<string>();
    const indexes = new Set<number>();

    plan.scenes.forEach((scene, position) => {
      if (ids.has(scene.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate scene id: ${scene.id}`,
          path: ['scenes', position, 'id'],
        });
      }

      if (indexes.has(scene.index)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate scene index: ${scene.index}`,
          path: ['scenes', position, 'index'],
        });
      }

      if (scene.index !== position + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `scene index must equal its 1-based position (${position + 1})`,
          path: ['scenes', position, 'index'],
        });
      }

      ids.add(scene.id);
      indexes.add(scene.index);
    });
  });

export type ScenePlan = z.infer<typeof ScenePlanSchema>;
