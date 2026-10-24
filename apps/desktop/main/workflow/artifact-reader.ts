import {
  CreativeBriefSchema,
  ProductionSpecSchema,
  ScenePlanSchema,
  ValidationReportSchema,
  type ArtifactReference,
} from '@miaoma/video-project';
import { FileArtifactStore } from '@miaoma/video-agent/workflow';
import type { ZodType } from 'zod';
import { IpcError } from '../ipc-error';
import type { ProjectStore } from '../projects/project-store';

const PUBLIC_ARTIFACTS = new Set<ArtifactReference['kind']>([
  'creative_brief',
  'production_spec',
  'scene_plan',
  'validation_report',
]);

function schemaFor(kind: ArtifactReference['kind']): ZodType<unknown> {
  switch (kind) {
    case 'creative_brief':
      return CreativeBriefSchema;
    case 'production_spec':
      return ProductionSpecSchema;
    case 'scene_plan':
      return ScenePlanSchema;
    case 'validation_report':
      return ValidationReportSchema;
    default:
      throw new IpcError('WORKFLOW_ARTIFACT_INVALID', '该产物不允许通过 IPC 读取。');
  }
}

/**
 * 只允许渲染进程读取不含绝对路径的产物；读取前做路径 containment 和 Zod 校验。
 */
export async function readPublicArtifact(
  projectStore: ProjectStore,
  projectId: string,
  reference: ArtifactReference,
): Promise<Record<string, unknown>> {
  if (!PUBLIC_ARTIFACTS.has(reference.kind)) {
    throw new IpcError('WORKFLOW_ARTIFACT_INVALID', '该产物不允许通过 IPC 读取。');
  }

  const store = new FileArtifactStore(projectStore.getProjectDirectory(projectId));

  try {
    return (await store.read(reference, schemaFor(reference.kind))) as Record<string, unknown>;
  } catch {
    throw new IpcError('WORKFLOW_ARTIFACT_INVALID', '产物不存在或结构无效。');
  }
}
