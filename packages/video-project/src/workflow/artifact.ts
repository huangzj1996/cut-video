import { z } from 'zod';
import { IsoDateSchema } from '../schema';

/**
 * 节点产物引用。
 *
 * `ref` 是工程目录内的相对 POSIX 路径；绝对路径、盘符、反斜杠与 `..`
 * 一律拒绝，避免渲染进程或恢复逻辑越出工程目录。
 */
export const ARTIFACT_KINDS = [
  'creation_input',
  'asset_manifest',
  'analyzed_assets',
  'creative_brief',
  'production_spec',
  'scene_plan',
  'approval',
  'voice_segments',
  'asset_matches',
  'video_project',
  'validation_report',
  'saved_project_ref',
] as const;

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

const REF_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const ArtifactRefPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) => {
      if (value.startsWith('/') || value.includes('\\') || value.includes(':')) {
        return false;
      }

      const segments = value.split('/');

      return (
        segments.length > 0 &&
        segments.every(
          (segment) => segment !== '.' && segment !== '..' && REF_SEGMENT.test(segment),
        )
      );
    },
    { message: 'artifact ref must be a project-relative POSIX path' },
  );

export function isArtifactRefPath(value: string): boolean {
  return ArtifactRefPathSchema.safeParse(value).success;
}

export const ArtifactReferenceSchema = z.strictObject({
  kind: ArtifactKindSchema,
  ref: ArtifactRefPathSchema,
  version: z.number().int().positive(),
  contentFingerprint: z.string().trim().min(1).max(128),
  createdAt: IsoDateSchema,
});

export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
