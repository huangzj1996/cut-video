import { z } from 'zod';
import {
  AnalyzedAssetCollectionSchema,
  AssetManifestSchema,
  type AnalyzedAsset,
  type AnalyzedAssetCollection,
  type AnalyzedAssetFailure,
  type AssetManifest,
  type AssetManifestItem,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';
import { formatDuration } from './asset-summary';

const AnalyzeAssetsInputSchema = z.strictObject({
  manifest: AssetManifestSchema,
  previousAnalysisVersion: z.number().int().nonnegative(),
});

type AnalyzeAssetsInput = z.infer<typeof AnalyzeAssetsInputSchema>;

const TECHNICAL_STOPWORDS = new Set([
  'final',
  'copy',
  'video',
  'clip',
  'img',
  'image',
  'dsc',
  'mov',
  'mp4',
  'png',
  'jpg',
  'jpeg',
]);

function tokenizeFileName(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const cjk = stem.match(/[一-鿿]{2,}/g) ?? [];
  const ascii = stem.match(/[A-Za-z0-9]{2,}/g) ?? [];
  const tokens = [...cjk, ...ascii]
    .map((token) => token.trim().slice(0, 40))
    .filter((token) => token.length > 1 && !TECHNICAL_STOPWORDS.has(token.toLowerCase()));

  return [...new Set(tokens)].slice(0, 8);
}

function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  if (width === height) {
    return 'square';
  }

  return width > height ? 'landscape' : 'portrait';
}

function orientationLabel(orientation: 'landscape' | 'portrait' | 'square'): string {
  switch (orientation) {
    case 'landscape':
      return '横屏';
    case 'portrait':
      return '竖屏';
    default:
      return '方形';
  }
}

function durationBucket(durationMs: number): string {
  if (durationMs < 5_000) {
    return '短片段';
  }

  if (durationMs < 30_000) {
    return '中片段';
  }

  return '长片段';
}

function analyzeItem(item: AssetManifestItem): AnalyzedAsset {
  const probe = item.probe!;
  const orientation = orientationOf(probe.width, probe.height);
  const orientationText = orientationLabel(orientation);
  const durationText = formatDuration(probe.durationMs);
  const fileTags = tokenizeFileName(item.fileName);
  const tags = [
    orientationText,
    `${probe.width}x${probe.height}`,
    durationBucket(probe.durationMs),
    ...(probe.hasAudio ? ['含音轨'] : ['无音轨']),
    ...(probe.fps !== undefined && probe.fps >= 50 ? ['高帧率'] : []),
    ...fileTags,
  ];

  const descriptionParts = [
    `${orientationText}${item.kind === 'image' ? '图片' : '视频'}`,
    `${probe.width}x${probe.height}`,
    durationText,
    ...(probe.fps !== undefined ? [`${Math.round(probe.fps)}fps`] : []),
    probe.hasAudio ? '含音轨' : '无音轨',
  ];
  const description = `${descriptionParts.join('，')}；关键帧 ${item.keyframes.length} 张${
    fileTags.length > 0 ? `；文件名标签：${fileTags.join('、')}` : ''
  }。`.slice(0, 600);

  return {
    assetId: item.assetId!,
    path: item.path,
    mediaType: item.kind === 'image' ? 'image' : 'video',
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    ...(probe.fps !== undefined ? { fps: probe.fps } : {}),
    keyframes: item.keyframes,
    tags: [...new Set(tags)].slice(0, 20),
    description,
    technical: {
      orientation,
      resolutionLabel: `${probe.width}x${probe.height}`,
      durationLabel: durationText,
      hasAudio: probe.hasAudio,
      isVfr: probe.isVfr,
    },
    status: 'analyzed',
  };
}

export function analyzeAssets(
  manifest: AssetManifest,
  previousAnalysisVersion: number,
  generatedAt: string,
): AnalyzedAssetCollection {
  const assets: AnalyzedAsset[] = [];
  const failures: AnalyzedAssetFailure[] = [];

  for (const item of manifest.items) {
    if (item.kind === 'audio') {
      failures.push({
        ...(item.assetId !== null ? { assetId: item.assetId } : {}),
        path: item.path,
        code: 'UNSUPPORTED_ASSET_KIND',
        message: '首版只分析视频/图片素材，音频文件已跳过。',
        retryable: false,
      });
      continue;
    }

    if (item.status !== 'ready' || item.assetId === null || item.probe === undefined) {
      const code =
        item.status === 'unreadable'
          ? 'ASSET_UNREADABLE'
          : item.status === 'rejected'
            ? 'ASSET_REJECTED'
            : 'ASSET_PROBE_MISSING';

      failures.push({
        ...(item.assetId !== null ? { assetId: item.assetId } : {}),
        path: item.path,
        code,
        message:
          item.status === 'ready'
            ? '缺少可用的媒体元数据，未纳入分析结果。'
            : `素材状态为 ${item.status}，未纳入分析结果。`,
        retryable: item.status === 'unreadable',
      });
      continue;
    }

    assets.push(analyzeItem(item));
  }

  const inputFingerprint = computeFingerprint({
    projectId: manifest.projectId,
    items: manifest.items.map((item) => ({
      assetId: item.assetId,
      path: item.path,
      status: item.status,
      probe: item.probe ?? null,
      keyframes: item.keyframes.map((frame) => ({
        thumbnailId: frame.thumbnailId,
        timeMs: frame.timeMs,
      })),
    })),
  });

  return AnalyzedAssetCollectionSchema.parse({
    schemaVersion: '1.0.0',
    analysisVersion: previousAnalysisVersion + 1,
    projectId: manifest.projectId,
    generatedAt,
    inputFingerprint,
    analysisSource: 'technical',
    assets,
    failures: failures.slice(0, 500),
  });
}

export const analyzeAssetsNode: WorkflowNodeSpec<AnalyzeAssetsInput, AnalyzedAssetCollection> = {
  id: 'analyze_assets',
  phase: 'prepare',
  inputSchema: AnalyzeAssetsInputSchema,
  outputSchema: AnalyzedAssetCollectionSchema,
  async loadInput(state, ctx): Promise<AnalyzeAssetsInput> {
    if (!state.assetManifestRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少素材清单。');
    }

    return {
      manifest: await ctx.readArtifact(state.assetManifestRef, AssetManifestSchema),
      previousAnalysisVersion: state.analysisRef?.version ?? 0,
    };
  },
  async execute(input, ctx): Promise<AnalyzedAssetCollection> {
    return analyzeAssets(input.manifest, input.previousAnalysisVersion, ctx.now().toISOString());
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'analyzed_assets',
      data: output,
      schema: AnalyzedAssetCollectionSchema,
      fileName: `analysis/assets/analyzed-assets.v${output.analysisVersion}.json`,
      version: output.analysisVersion,
      cacheKey: output.inputFingerprint,
    });

    return { analysisRef: reference };
  },
};
