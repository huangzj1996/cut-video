import { z } from 'zod';
import {
  AnalyzedAssetCollectionSchema,
  AssetMatchCollectionSchema,
  IdSchema,
  ScenePlanSchema,
  VoiceSegmentCollectionSchema,
  type AnalyzedAsset,
  type AssetMatchCandidate,
  type AssetMatchCollection,
  type AssetMatchIssue,
  type SceneAssetMatch,
  type ScenePlan,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';
import { assertWorkflowApproval } from './creative-brief';

const MatchAssetsInputSchema = z.strictObject({
  projectId: IdSchema,
  scenePlan: ScenePlanSchema,
  voiceSegments: VoiceSegmentCollectionSchema,
  analyzedAssets: AnalyzedAssetCollectionSchema,
  previousMatchVersion: z.number().int().nonnegative(),
});

type MatchAssetsInput = z.infer<typeof MatchAssetsInputSchema>;

interface UsedRange {
  startMs: number;
  endMs: number;
}

function tokenize(text: string): string[] {
  const cjkRuns = text.match(/[一-鿿]{2,}/g) ?? [];
  const ascii = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const cjkTokens = cjkRuns.flatMap((run) =>
    run.length <= 4
      ? [run]
      : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)),
  );

  return [...new Set([...cjkTokens, ...ascii])];
}

function keywordScore(scene: ScenePlan['scenes'][number], asset: AnalyzedAsset): number {
  const sceneTokens = new Set(tokenize(`${scene.visualIntent} ${scene.title} ${scene.goal}`));
  const assetTokens = new Set(tokenize(`${asset.description} ${asset.tags.join(' ')}`));

  if (sceneTokens.size === 0 || assetTokens.size === 0) {
    return 0;
  }

  let overlap = 0;

  for (const token of sceneTokens) {
    if (assetTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / sceneTokens.size;
}

function findWindow(
  assetDurationMs: number,
  requiredMs: number,
  used: readonly UsedRange[],
): { startMs: number; availableMs: number; reused: boolean } {
  const sorted = used.slice().sort((left, right) => left.startMs - right.startMs);
  let cursor = 0;

  for (const range of sorted) {
    if (range.startMs - cursor >= requiredMs) {
      return { startMs: cursor, availableMs: requiredMs, reused: false };
    }

    cursor = Math.max(cursor, range.endMs);
  }

  if (assetDurationMs - cursor >= requiredMs) {
    return { startMs: cursor, availableMs: requiredMs, reused: false };
  }

  // 没有完整空窗：取最大的剩余区间，标记覆盖不足；完全占满时复用起点。
  const gaps: { startMs: number; sizeMs: number }[] = [];
  let gapCursor = 0;

  for (const range of sorted) {
    gaps.push({ startMs: gapCursor, sizeMs: Math.max(0, range.startMs - gapCursor) });
    gapCursor = Math.max(gapCursor, range.endMs);
  }

  gaps.push({ startMs: gapCursor, sizeMs: Math.max(0, assetDurationMs - gapCursor) });
  gaps.sort((left, right) => right.sizeMs - left.sizeMs);
  const best = gaps[0]!;

  if (best.sizeMs > 0) {
    return {
      startMs: best.startMs,
      availableMs: Math.min(requiredMs, best.sizeMs),
      reused: false,
    };
  }

  return {
    startMs: 0,
    availableMs: Math.min(requiredMs, assetDurationMs),
    reused: true,
  };
}

function candidateReasons(
  scene: ScenePlan['scenes'][number],
  asset: AnalyzedAsset,
  keyword: number,
  durationScore: number,
  reused: boolean,
): string[] {
  const reasons: string[] = [];

  if (keyword > 0) {
    const sceneTokens = tokenize(`${scene.visualIntent} ${scene.title}`);
    const assetTokens = new Set(tokenize(`${asset.description} ${asset.tags.join(' ')}`));
    const shared = sceneTokens.filter((token) => assetTokens.has(token)).slice(0, 4);

    reasons.push(`画面意图与素材标签重叠：${shared.join('、') || '部分关键词'}`);
  } else {
    reasons.push('按素材时长与可用性兜底匹配');
  }

  reasons.push(durationScore >= 1 ? '素材时长足够' : '素材可用区间不足以完全覆盖场景');
  reasons.push(reused ? '复用已占用素材区间' : '优先使用未占用素材');

  return reasons.slice(0, 5);
}

function matchScene(
  scene: ScenePlan['scenes'][number],
  requiredMs: number,
  assets: readonly AnalyzedAsset[],
  usedRanges: Map<string, UsedRange[]>,
): SceneAssetMatch {
  const usableAssets = assets.filter((asset) => asset.durationMs > 0);

  if (usableAssets.length === 0) {
    return {
      sceneId: scene.id,
      requiredDurationMs: requiredMs,
      candidates: [],
      status: 'unmatched',
      issues: [
        {
          code: 'NO_VIDEO_MATERIAL',
          severity: 'error',
          message: '没有可用的画面素材。',
          sceneId: scene.id,
        },
      ],
    };
  }

  const scored = usableAssets
    .map((asset) => {
      const keyword = keywordScore(scene, asset);
      const durationScore = Math.min(1, asset.durationMs / requiredMs);
      const used = usedRanges.get(asset.assetId) ?? [];
      const window = findWindow(asset.durationMs, requiredMs, used);
      const unusedScore = window.reused ? 0.5 : 1;
      const score = Math.min(1, keyword * 0.6 + durationScore * 0.25 + unusedScore * 0.15);

      return { asset, keyword, durationScore, window, score };
    })
    .sort((left, right) => right.score - left.score);
  const candidates: AssetMatchCandidate[] = scored.slice(0, 3).map((entry) => ({
    assetId: entry.asset.assetId,
    score: Number(entry.score.toFixed(3)),
    reasons: candidateReasons(
      scene,
      entry.asset,
      entry.keyword,
      entry.durationScore,
      entry.window.reused,
    ),
  }));
  const chosen = scored.find((entry) => entry.window.availableMs >= requiredMs) ?? scored[0]!;
  const issues: AssetMatchIssue[] = [];

  if (chosen.window.reused) {
    issues.push({
      code: 'REUSED_ASSET',
      severity: 'warning',
      message: '该素材区间已被其他分镜使用。',
      sceneId: scene.id,
    });
  }

  if (chosen.window.availableMs < requiredMs) {
    issues.push({
      code: 'COVERAGE_SHORTFALL',
      severity: 'error',
      message: `素材可用时长 ${Math.round(chosen.window.availableMs / 1_000)} 秒，不足以覆盖 ${Math.round(
        requiredMs / 1_000,
      )} 秒场景。`,
      sceneId: scene.id,
    });
  }

  const used = usedRanges.get(chosen.asset.assetId) ?? [];
  used.push({
    startMs: chosen.window.startMs,
    endMs: chosen.window.startMs + chosen.window.availableMs,
  });
  usedRanges.set(chosen.asset.assetId, used);

  return {
    sceneId: scene.id,
    requiredDurationMs: requiredMs,
    candidates,
    selected: {
      assetId: chosen.asset.assetId,
      sourceStartMs: chosen.window.startMs,
      sourceEndMs: chosen.window.startMs + chosen.window.availableMs,
    },
    status: chosen.window.reused || chosen.window.availableMs < requiredMs ? 'partial' : 'matched',
    issues,
  };
}

export function matchAssets(input: MatchAssetsInput, generatedAt: string): AssetMatchCollection {
  const voiceByScene = new Map(
    input.voiceSegments.segments.map((segment) => [segment.sceneId, segment.durationMs]),
  );
  const usedRanges = new Map<string, UsedRange[]>();
  const matches = input.scenePlan.scenes.map((scene) =>
    matchScene(
      scene,
      voiceByScene.get(scene.id) ?? scene.estimatedDurationMs,
      input.analyzedAssets.assets,
      usedRanges,
    ),
  );
  const issues = matches.flatMap((match) => match.issues);

  return AssetMatchCollectionSchema.parse({
    schemaVersion: '1.0.0',
    matchVersion: input.previousMatchVersion + 1,
    projectId: input.projectId,
    generatedAt,
    inputFingerprint: computeFingerprint({
      scenePlan: input.scenePlan,
      voiceSegments: input.voiceSegments,
      analyzedAssets: input.analyzedAssets,
    }),
    matches,
    unmatchedSceneIds: matches
      .filter((match) => match.status === 'unmatched')
      .map((match) => match.sceneId),
    issues,
  });
}

export const matchAssetsNode: WorkflowNodeSpec<MatchAssetsInput, AssetMatchCollection> = {
  id: 'match_assets',
  phase: 'video',
  inputSchema: MatchAssetsInputSchema,
  outputSchema: AssetMatchCollectionSchema,
  async loadInput(state, ctx): Promise<MatchAssetsInput> {
    if (!state.scenePlanRef || !state.voiceRef || !state.analysisRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少分镜、配音或素材分析结果。');
    }

    const [scenePlan, voiceSegments, analyzedAssets] = await Promise.all([
      ctx.readArtifact(state.scenePlanRef, ScenePlanSchema),
      ctx.readArtifact(state.voiceRef, VoiceSegmentCollectionSchema),
      ctx.readArtifact(state.analysisRef, AnalyzedAssetCollectionSchema),
    ]);
    await assertWorkflowApproval(ctx, 'A3', state.a3ApprovalRef, state.scenePlanRef);
    const latestMatch = state.matchRef ?? (await ctx.artifacts.findLatest('asset_matches'));

    return {
      projectId: state.projectId,
      scenePlan,
      voiceSegments,
      analyzedAssets,
      previousMatchVersion: latestMatch?.version ?? 0,
    };
  },
  async execute(input, ctx): Promise<AssetMatchCollection> {
    const inputFingerprint = computeFingerprint({
      scenePlan: input.scenePlan,
      voiceSegments: input.voiceSegments,
      analyzedAssets: input.analyzedAssets,
    });
    const reusable = await ctx.findArtifact('asset_matches', inputFingerprint);

    if (reusable) {
      return ctx.readArtifact(reusable, AssetMatchCollectionSchema);
    }

    return matchAssets(input, ctx.now().toISOString());
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'asset_matches',
      data: output,
      schema: AssetMatchCollectionSchema,
      fileName: `analysis/matches/asset-matches.v${output.matchVersion}.json`,
      version: output.matchVersion,
      cacheKey: output.inputFingerprint,
    });

    return { matchRef: reference };
  },
};
