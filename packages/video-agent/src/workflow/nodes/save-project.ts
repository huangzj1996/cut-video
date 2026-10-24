import { z } from 'zod';
import {
  IdSchema,
  SavedProjectRefSchema,
  ValidationReportSchema,
  VideoProjectSchema,
  type SavedProjectRef,
  type VideoProject,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';

const SaveProjectInputSchema = z.strictObject({
  projectId: IdSchema,
  project: VideoProjectSchema,
  validation: ValidationReportSchema,
});

type SaveProjectInput = z.infer<typeof SaveProjectInputSchema>;

function isStaleRevisionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'PROJECT_STALE_REVISION'
  );
}

export const saveProjectNode: WorkflowNodeSpec<SaveProjectInput, SavedProjectRef> = {
  id: 'save_project',
  phase: 'video',
  inputSchema: SaveProjectInputSchema,
  outputSchema: SavedProjectRefSchema,
  async loadInput(state, ctx): Promise<SaveProjectInput> {
    if (!state.projectRef || !state.validationRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少待保存工程或校验报告。');
    }

    const [project, validation] = await Promise.all([
      ctx.readArtifact(state.projectRef, VideoProjectSchema),
      ctx.readArtifact(state.validationRef, ValidationReportSchema),
    ]);

    if (!validation.passed) {
      throw new WorkflowError('WORKFLOW_VALIDATION_FAILED', '工程校验未通过，不能保存。');
    }

    if (validation.validatedRevision !== project.project.contentRevision) {
      throw new WorkflowError('WORKFLOW_STALE_RESULT', '校验报告与当前工程修订不一致。');
    }

    return { projectId: state.projectId, project, validation };
  },
  async execute(input, ctx): Promise<SavedProjectRef> {
    const now = ctx.now().toISOString();
    const project: VideoProject = {
      ...input.project,
      ai: {
        ...input.project.ai,
        completedAt: now,
      },
    };

    let saved: VideoProject;

    try {
      saved = (await ctx.projects.save(
        input.projectId,
        project,
        project.project.contentRevision,
      )) as VideoProject;
    } catch (error) {
      if (isStaleRevisionError(error)) {
        throw new WorkflowError('WORKFLOW_STALE_RESULT', '工程内容已被修改，请重新生成。');
      }

      throw error;
    }

    return SavedProjectRefSchema.parse({
      schemaVersion: '1.0.0',
      projectId: input.projectId,
      runId: ctx.runId,
      savedProjectPath: ctx.projects.getDirectory(input.projectId),
      contentRevision: saved.project.contentRevision,
      contentFingerprint: computeFingerprint(saved),
      savedAt: now,
    });
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'saved_project_ref',
      data: output,
      schema: SavedProjectRefSchema,
      fileName: `analysis/saved/saved-project-ref.v${output.contentRevision}.json`,
      version: output.contentRevision,
      cacheKey: computeFingerprint({
        runId: output.runId,
        contentRevision: output.contentRevision,
        contentFingerprint: output.contentFingerprint,
      }),
    });

    return {
      savedProjectRef: reference,
      savedProjectPath: output.savedProjectPath,
    };
  },
};
