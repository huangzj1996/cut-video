import { existsSync } from 'node:fs';
import {
  ValidationReportSchema,
  VideoProjectSchema,
  type SubtitleClip,
  type ValidationIssue,
  type ValidationReport,
  type VideoClip,
  type VideoProject,
  type VoiceClip,
} from '@miaoma/video-project';
import { WorkflowError } from '../errors';
import { computeFingerprint } from '../fingerprint';
import type { WorkflowNodeSpec } from '../types';

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  extra: Partial<
    Pick<ValidationIssue, 'sceneId' | 'clipId' | 'assetId' | 'fieldPath' | 'fixHint'>
  > = {},
): ValidationIssue {
  return {
    code,
    severity,
    message,
    ...extra,
  };
}

function sortedClips<T extends { startMs: number; endMs: number }>(clips: T[]): T[] {
  return clips.slice().sort((left, right) => left.startMs - right.startMs);
}

function validateClipRanges(
  clips: readonly (VideoClip | VoiceClip | SubtitleClip)[],
  kind: string,
  totalDurationMs: number,
  errors: ValidationIssue[],
): void {
  const seen = new Set<string>();

  for (const clip of clips) {
    if (seen.has(clip.id)) {
      errors.push(
        issue('error', 'DUPLICATE_CLIP_ID', `${kind} 轨道存在重复片段 ID。`, {
          clipId: clip.id,
        }),
      );
    }
    seen.add(clip.id);

    if (clip.endMs > totalDurationMs) {
      errors.push(
        issue('error', 'CLIP_EXCEEDS_TIMELINE', `${kind} 轨道片段超出项目总时长。`, {
          clipId: clip.id,
        }),
      );
    }
  }
}

function checkVideoCoverage(
  clips: readonly VideoClip[],
  totalDurationMs: number,
  errors: ValidationIssue[],
): void {
  if (clips.length === 0) {
    errors.push(
      issue('error', 'NO_VIDEO_CLIPS', '视频轨没有片段；至少需要 1 个画面素材。', {
        fieldPath: 'tracks.video.clips',
        fixHint: '导入包含可用画面的素材后重新生成。',
      }),
    );
    return;
  }

  const ordered = sortedClips([...clips]);
  let cursor = 0;

  for (const clip of ordered) {
    if (clip.startMs > cursor) {
      errors.push(
        issue(
          'error',
          'VIDEO_TRACK_GAP',
          `视频轨在 ${cursor}ms 到 ${clip.startMs}ms 之间有空隙。`,
          {
            clipId: clip.id,
            sceneId: clip.sceneId,
            fieldPath: 'tracks.video.clips',
          },
        ),
      );
    } else if (clip.startMs < cursor) {
      errors.push(
        issue('error', 'VIDEO_TRACK_OVERLAP', '视频轨片段发生重叠。', {
          clipId: clip.id,
          sceneId: clip.sceneId,
          fieldPath: 'tracks.video.clips',
        }),
      );
    }

    cursor = Math.max(cursor, clip.endMs);
  }

  if (cursor < totalDurationMs) {
    errors.push(
      issue('error', 'VIDEO_TRACK_END_MISMATCH', '视频轨未覆盖到项目结束。', {
        fieldPath: 'tracks.video.clips',
      }),
    );
  }
}

function checkVoiceCoverage(
  clips: readonly VoiceClip[],
  totalDurationMs: number,
  errors: ValidationIssue[],
): void {
  if (clips.length === 0) {
    errors.push(
      issue('error', 'NO_VOICE_CLIPS', '配音轨没有片段。', {
        fieldPath: 'tracks.voice.clips',
      }),
    );
    return;
  }

  const ordered = sortedClips([...clips]);
  let cursor = 0;

  for (const clip of ordered) {
    if (clip.startMs > cursor) {
      errors.push(
        issue('error', 'VOICE_TRACK_GAP', '配音轨片段之间有空隙。', {
          clipId: clip.id,
          sceneId: clip.sceneId,
          fieldPath: 'tracks.voice.clips',
        }),
      );
    } else if (clip.startMs < cursor) {
      errors.push(
        issue('error', 'VOICE_TRACK_OVERLAP', '配音轨片段发生重叠。', {
          clipId: clip.id,
          sceneId: clip.sceneId,
          fieldPath: 'tracks.voice.clips',
        }),
      );
    }

    cursor = Math.max(cursor, clip.endMs);
  }

  if (cursor !== totalDurationMs) {
    errors.push(
      issue('error', 'VOICE_TRACK_END_MISMATCH', '配音轨结束时间与项目总时长不一致。', {
        fieldPath: 'tracks.voice.clips',
      }),
    );
  }
}

function checkSubtitleOverlap(clips: readonly SubtitleClip[], errors: ValidationIssue[]): void {
  const ordered = sortedClips([...clips]);
  let previousEnd = 0;

  for (const clip of ordered) {
    if (clip.startMs < previousEnd) {
      errors.push(
        issue('error', 'SUBTITLE_TRACK_OVERLAP', '字幕轨片段发生重叠。', {
          clipId: clip.id,
          sceneId: clip.sceneId,
          fieldPath: 'tracks.subtitle.clips',
        }),
      );
    }
    previousEnd = Math.max(previousEnd, clip.endMs);
  }
}

export function validateProject(project: VideoProject, now: string): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const parsed = VideoProjectSchema.safeParse(project);

  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      errors.push(
        issue('error', 'PROJECT_SCHEMA_INVALID', zodIssue.message, {
          fieldPath: zodIssue.path.map(String).join('.'),
        }),
      );
    }

    return ValidationReportSchema.parse({
      schemaVersion: '1.0.0',
      reportVersion: Math.max(1, project.project.contentRevision),
      projectId: project.project.projectId,
      validatedRevision: project.project.contentRevision,
      passed: false,
      errors,
      warnings,
      validatedAt: now,
    });
  }

  const videoTrack = project.tracks.find((track) => track.kind === 'video');
  const voiceTrack = project.tracks.find((track) => track.kind === 'voice');
  const subtitleTrack = project.tracks.find((track) => track.kind === 'subtitle');
  const videosById = new Map(project.assets.videos.map((asset) => [asset.id, asset]));
  const voicesById = new Map(project.assets.voices.map((asset) => [asset.id, asset]));
  const subtitlesById = new Map(project.assets.subtitles.map((asset) => [asset.id, asset]));
  const thumbnailsById = new Set(project.assets.thumbnails.map((asset) => asset.id));
  const totalDurationMs = project.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const videoClips: VideoClip[] = videoTrack && videoTrack.kind === 'video' ? videoTrack.clips : [];
  const voiceClips: VoiceClip[] = voiceTrack && voiceTrack.kind === 'voice' ? voiceTrack.clips : [];
  const subtitleClips: SubtitleClip[] =
    subtitleTrack && subtitleTrack.kind === 'subtitle' ? subtitleTrack.clips : [];

  checkVideoCoverage(videoClips, totalDurationMs, errors);
  checkVoiceCoverage(voiceClips, totalDurationMs, errors);
  checkSubtitleOverlap(subtitleClips, errors);
  validateClipRanges(videoClips, '视频', totalDurationMs, errors);
  validateClipRanges(voiceClips, '配音', totalDurationMs, errors);
  validateClipRanges(subtitleClips, '字幕', totalDurationMs, errors);

  for (const clip of videoClips) {
    const asset = videosById.get(clip.assetId);

    if (!asset) {
      errors.push(
        issue('error', 'ASSET_ID_MISSING', '视频片段引用了不存在的素材。', {
          clipId: clip.id,
          assetId: clip.assetId,
        }),
      );
      continue;
    }

    if (clip.sourceEndMs > asset.durationMs) {
      errors.push(
        issue('error', 'SOURCE_RANGE_INVALID', '视频片段入出点超出素材时长。', {
          clipId: clip.id,
          assetId: clip.assetId,
          fixHint: '重新匹配素材或缩短该分镜。',
        }),
      );
    }

    if (!existsSync(asset.path)) {
      errors.push(
        issue('error', 'ASSET_FILE_MISSING', '视频素材文件不存在或已被移动。', {
          assetId: clip.assetId,
          fixHint: '重新导入素材或恢复原文件位置。',
        }),
      );
    }
  }

  for (const clip of voiceClips) {
    const asset = voicesById.get(clip.assetId);

    if (!asset) {
      errors.push(
        issue('error', 'VOICE_ASSET_MISSING', '配音片段引用了不存在的音频。', {
          clipId: clip.id,
          assetId: clip.assetId,
        }),
      );
      continue;
    }

    if (clip.endMs - clip.startMs > asset.durationMs + 100) {
      errors.push(
        issue('error', 'VOICE_CLIP_TOO_LONG', '配音片段长于音频时长。', {
          clipId: clip.id,
          assetId: clip.assetId,
        }),
      );
    }

    if (!existsSync(asset.path)) {
      errors.push(
        issue('error', 'VOICE_FILE_MISSING', '配音文件不存在。', {
          assetId: clip.assetId,
          fixHint: '重新生成配音。',
        }),
      );
    }
  }

  for (const clip of subtitleClips) {
    if (!subtitlesById.has(clip.assetId)) {
      errors.push(
        issue('error', 'SUBTITLE_ASSET_MISSING', '字幕片段引用了不存在的字幕资产。', {
          clipId: clip.id,
          assetId: clip.assetId,
        }),
      );
    }
  }

  for (const scene of project.scenes) {
    if (!voicesById.has(scene.voiceAssetId)) {
      errors.push(
        issue('error', 'SCENE_VOICE_MISSING', '分镜引用了不存在的配音资产。', {
          sceneId: scene.id,
        }),
      );
    }

    for (const subtitleId of scene.subtitleIds) {
      if (!subtitlesById.has(subtitleId)) {
        errors.push(
          issue('error', 'SCENE_SUBTITLE_MISSING', '分镜引用了不存在的字幕资产。', {
            sceneId: scene.id,
            assetId: subtitleId,
          }),
        );
      }
    }

    for (const assetId of scene.matchedVideoAssetIds) {
      if (!videosById.has(assetId)) {
        errors.push(
          issue('error', 'SCENE_VIDEO_MISSING', '分镜引用了不存在的视频素材。', {
            sceneId: scene.id,
            assetId,
          }),
        );
      }
    }
  }

  for (const video of project.assets.videos) {
    for (const thumbnailId of video.thumbnailIds) {
      if (!thumbnailsById.has(thumbnailId)) {
        warnings.push(
          issue('warning', 'THUMBNAIL_MISSING', `视频素材引用了不存在的缩略图 ${thumbnailId}。`, {
            assetId: video.id,
          }),
        );
      }
    }
  }

  if (errors.length === 0 && videoClips.length > 0) {
    const videoEnd = Math.max(...videoClips.map((clip) => clip.endMs));

    if (videoEnd !== totalDurationMs) {
      errors.push(
        issue('error', 'TOTAL_DURATION_MISMATCH', '视频轨结束时间与分镜总时长不一致。', {
          fieldPath: 'tracks.video.clips',
        }),
      );
    }
  }

  return ValidationReportSchema.parse({
    schemaVersion: '1.0.0',
    reportVersion: Math.max(1, project.project.contentRevision),
    projectId: project.project.projectId,
    validatedRevision: project.project.contentRevision,
    passed: errors.length === 0,
    errors,
    warnings,
    validatedAt: now,
  });
}

export const validateProjectNode: WorkflowNodeSpec<VideoProject, ValidationReport> = {
  id: 'validate_project',
  phase: 'video',
  inputSchema: VideoProjectSchema,
  outputSchema: ValidationReportSchema,
  async loadInput(state, ctx): Promise<VideoProject> {
    if (!state.projectRef) {
      throw new WorkflowError('WORKFLOW_INPUT_MISSING', '缺少待校验工程。');
    }

    return ctx.readArtifact(state.projectRef, VideoProjectSchema);
  },
  async execute(input, ctx): Promise<ValidationReport> {
    return validateProject(input, ctx.now().toISOString());
  },
  async persist(output, ctx) {
    const reference = await ctx.writeArtifact({
      kind: 'validation_report',
      data: output,
      schema: ValidationReportSchema,
      fileName: `analysis/validation/validation-report.v${output.reportVersion}.json`,
      version: output.reportVersion,
      cacheKey: computeFingerprint({
        projectId: output.projectId,
        validatedRevision: output.validatedRevision,
        passed: output.passed,
        errors: output.errors,
      }),
    });

    return {
      validationRef: reference,
      validationPassed: output.passed,
    };
  },
};
