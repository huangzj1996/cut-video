import { z } from 'zod';
import {
  AssetManifestSchema,
  CreationInputSchema,
  IdSchema,
  type AssetManifest,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import type { WorkflowNodeSpec } from '../types';

const ScanAssetsInputSchema = z.strictObject({
  projectId: IdSchema,
  creation: CreationInputSchema,
});

type ScanAssetsInput = z.infer<typeof ScanAssetsInputSchema>;

export const scanAssetsNode: WorkflowNodeSpec<ScanAssetsInput, AssetManifest> = {
  id: 'scan_assets',
  phase: 'prepare',
  inputSchema: ScanAssetsInputSchema,
  outputSchema: AssetManifestSchema,
  async loadInput(state, ctx): Promise<ScanAssetsInput> {
    return {
      projectId: state.projectId,
      creation: ctx.projects.readCreationInput(state.projectId),
    };
  },
  async execute(input, ctx): Promise<AssetManifest> {
    return ctx.assets.scanAssets({
      projectId: input.projectId,
      ...(input.creation.assetPath !== undefined ? { assetPath: input.creation.assetPath } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      onProgress: (progress) => ctx.emitProgress(progress),
    });
  },
  async persist(output, ctx) {
    if (!output.projectId) {
      throw new WorkflowError('WORKFLOW_OUTPUT_INVALID', '素材清单缺少 projectId。');
    }

    const reference = await ctx.writeArtifact({
      kind: 'asset_manifest',
      data: output,
      schema: AssetManifestSchema,
      fileName: 'analysis/assets/asset-manifest.v1.json',
      version: 1,
    });

    return { assetManifestRef: reference };
  },
};
