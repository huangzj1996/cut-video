import { z } from 'zod';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export const TimeMsSchema = z.number().int().nonnegative();

export const ProjectSettingsSchema = z.object({
  aspectRatio: z.literal('16:9'),
  resolution: z.literal('1920x1080'),
  fps: z.literal(30),
  sourceAudioMuted: z.literal(true),
});

export const ProjectHeaderSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  projectId: z.string().min(1),
  contentRevision: z.number().int().nonnegative(),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const DEFAULT_PROJECT_SETTINGS = {
  aspectRatio: '16:9',
  resolution: '1920x1080',
  fps: 30,
  sourceAudioMuted: true,
} as const satisfies z.infer<typeof ProjectSettingsSchema>;

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type ProjectHeader = z.infer<typeof ProjectHeaderSchema>;
