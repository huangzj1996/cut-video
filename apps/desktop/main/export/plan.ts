import path from 'node:path';
import type { VideoAsset, VideoClip, VideoProject } from '@miaoma/video-project';
import { EXPORT_OUTPUT_SPEC, type ExportErrorCode } from '../../shared/ipc-contract';
import type { ExportFonts } from './fonts';
import { buildSubtitleDocument, subtitleArtifactFileNames } from './subtitles';
import { partialPathFor } from './target';

export const OUTPUT_WIDTH = EXPORT_OUTPUT_SPEC.width;
export const OUTPUT_HEIGHT = EXPORT_OUTPUT_SPEC.height;
export const OUTPUT_FPS = EXPORT_OUTPUT_SPEC.fps;

const OUTPUT_CRF = 20;
const OUTPUT_PRESET = 'medium';
const VIDEO_CODEC = 'libx264';
const PIXEL_FORMAT = 'yuv420p';

export interface ExportExpectedOutput {
  container: 'mp4';
  durationMs: number;
  frameCount: number;
  fps: number;
  height: number;
  videoCodec: 'h264';
  width: number;
}

export interface ExportFfmpegCommand {
  args: string[];
  command: string;
}

/** 字幕烧录需要写进目标目录的临时产物；滤镜参数只引用其中的相对 ASCII 文件名。 */
export interface ExportSubtitleArtifacts {
  /** ASS 文件绝对路径。 */
  assPath: string;
  /** ASS 文档全文（UTF-8、不带 BOM）。 */
  assText: string;
  /** 临时字体目录绝对路径。 */
  fontsDirPath: string;
  /** 需要复制进临时字体目录的随包字体文件。 */
  fontFiles: string[];
}

export interface ExportPlan {
  /** 渲染进程工作目录：目标目录，让 ASS/fontsdir 以相对路径解析。 */
  cwd: string;
  expected: ExportExpectedOutput;
  ffmpeg: ExportFfmpegCommand;
  /** null 表示这次导出不烧录字幕。 */
  subtitles: ExportSubtitleArtifacts | null;
  targetPath: string;
  temporaryPath: string;
}

export interface CompileExportPlanInput {
  /** 每次导出的唯一标识，用于给临时 ASS/字体目录命名（只允许 ASCII）。 */
  artifactToken: string;
  ffmpegPath: string;
  /** 随包字体；缺失时传 null，由前置校验先报 EXPORT_FONT_MISSING。 */
  fonts: ExportFonts | null;
  project: VideoProject;
  targetPath: string;
}

export class ExportPlanError extends Error {
  readonly code: Extract<ExportErrorCode, 'EXPORT_VALIDATION_FAILED'> = 'EXPORT_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ExportPlanError';
  }
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function frameAt(ms: number): number {
  return Math.round((ms * OUTPUT_FPS) / 1000);
}

function videoAssetById(project: VideoProject, assetId: string): VideoAsset {
  const asset = project.assets.videos.find((candidate) => candidate.id === assetId);

  if (!asset) {
    throw new ExportPlanError('视频片段引用了不存在的素材。');
  }

  return asset;
}

function buildClipFilter(input: {
  asset: VideoAsset;
  clip: VideoClip;
  frameCount: number;
  index: number;
}): string {
  const { asset, clip, frameCount, index } = input;
  const isImage = asset.mediaType === 'image';
  const trim = isImage
    ? 'trim=end=' + seconds(clip.endMs - clip.startMs)
    : 'trim=start=' + seconds(clip.sourceStartMs) + ':end=' + seconds(clip.sourceEndMs);
  const speed = isImage ? 1 : (clip.speed ?? 1);
  const setPts = speed === 1 ? 'PTS-STARTPTS' : '(PTS-STARTPTS)/' + speed;

  return (
    '[' +
    index +
    ':v]' +
    trim +
    ',setpts=' +
    setPts +
    ',fps=' +
    OUTPUT_FPS +
    ',scale=' +
    OUTPUT_WIDTH +
    ':' +
    OUTPUT_HEIGHT +
    ':force_original_aspect_ratio=decrease' +
    ',pad=' +
    OUTPUT_WIDTH +
    ':' +
    OUTPUT_HEIGHT +
    ':(ow-iw)/2:(oh-ih)/2:color=black' +
    ',setsar=1,format=' +
    PIXEL_FORMAT +
    ',trim=end_frame=' +
    frameCount +
    '[v' +
    index +
    ']'
  );
}

/**
 * 导出计划编译器：把时间线换成可执行的 ffmpeg 参数与期望输出规格。
 *
 * 视频轨裁剪、按 30fps 量化后拼接、缩放到 1920×1080；字幕轨可见时在拼接后
 * 用 ass 滤镜烧录。ASS 与 fontsdir 一律使用相对 ASCII 文件名，进程 cwd 指向
 * 目标目录（实测中文绝对路径会让滤镜初始化失败）。
 * 时间统一用整数毫秒；每个片段按输出帧边界量化，拼接后总帧数精确可控。
 * 纯函数：不读磁盘、不启动进程。
 */
export function compileExportPlan(input: CompileExportPlanInput): ExportPlan {
  const { project, targetPath, ffmpegPath } = input;
  const videoTrack = project.tracks.find((track) => track.kind === 'video');

  if (!videoTrack || videoTrack.kind !== 'video' || videoTrack.clips.length === 0) {
    throw new ExportPlanError('视频轨没有可导出的片段。');
  }

  const totalDurationMs = project.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const totalFrameCount = Math.max(1, frameAt(totalDurationMs));
  const clips = videoTrack.clips.slice().sort((left, right) => left.startMs - right.startMs);
  const inputs: string[] = [];
  const filterChains: string[] = [];
  const concatLabels: string[] = [];
  let cursorMs = 0;
  let cursorFrame = 0;

  for (const [index, clip] of clips.entries()) {
    if (clip.startMs !== cursorMs) {
      throw new ExportPlanError('视频轨片段之间存在空隙或重叠，无法导出。');
    }

    const startFrame = frameAt(clip.startMs);
    const endFrame = frameAt(clip.endMs);
    const frameCount = endFrame - startFrame;

    if (startFrame !== cursorFrame || frameCount <= 0) {
      throw new ExportPlanError('视频片段短于一个输出帧或与时间线不对齐，无法导出。');
    }

    const asset = videoAssetById(project, clip.assetId);

    if (asset.mediaType === 'image') {
      // 图片输入循环成有限时长的流，再按时间线帧数裁剪。
      inputs.push('-loop', '1', '-i', asset.path);
    } else {
      inputs.push('-i', asset.path);
    }

    filterChains.push(buildClipFilter({ asset, clip, frameCount, index }));
    concatLabels.push('[v' + index + ']');
    cursorMs = clip.endMs;
    cursorFrame = endFrame;
  }

  if (cursorMs !== totalDurationMs) {
    throw new ExportPlanError('视频轨未覆盖完整时间线，无法导出。');
  }

  const cwd = path.dirname(targetPath);
  const subtitleDocument = buildSubtitleDocument(project);
  const artifactNames = subtitleDocument ? subtitleArtifactFileNames(input.artifactToken) : null;

  if (subtitleDocument && !input.fonts) {
    throw new ExportPlanError('缺少随包中文字体，无法烧录字幕。');
  }

  const subtitles: ExportSubtitleArtifacts | null =
    subtitleDocument && artifactNames
      ? {
          assPath: path.join(cwd, artifactNames.assFileName),
          assText: subtitleDocument,
          fontsDirPath: path.join(cwd, artifactNames.fontsDirName),
          fontFiles: input.fonts?.files.slice() ?? [],
        }
      : null;
  const postFilters = ['concat=n=' + clips.length + ':v=1:a=0'];

  if (subtitles && artifactNames) {
    postFilters.push(
      'ass=filename=' + artifactNames.assFileName + ':fontsdir=' + artifactNames.fontsDirName,
    );
  }

  postFilters.push('format=' + PIXEL_FORMAT);

  const graph =
    filterChains.join(';') + ';' + concatLabels.join('') + postFilters.join(',') + '[vout]';
  const temporaryPath = partialPathFor(targetPath);
  const durationSeconds = (totalFrameCount / OUTPUT_FPS).toFixed(3);
  const args = [
    '-y',
    '-hide_banner',
    ...inputs,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    '-an',
    '-c:v',
    VIDEO_CODEC,
    '-preset',
    OUTPUT_PRESET,
    '-crf',
    String(OUTPUT_CRF),
    '-pix_fmt',
    PIXEL_FORMAT,
    '-r',
    String(OUTPUT_FPS),
    '-t',
    durationSeconds,
    '-f',
    EXPORT_OUTPUT_SPEC.container,
    '-movflags',
    '+faststart',
    temporaryPath,
  ];

  return {
    cwd,
    expected: {
      container: EXPORT_OUTPUT_SPEC.container,
      durationMs: Math.round((totalFrameCount / OUTPUT_FPS) * 1000),
      frameCount: totalFrameCount,
      fps: OUTPUT_FPS,
      height: OUTPUT_HEIGHT,
      videoCodec: EXPORT_OUTPUT_SPEC.videoCodec,
      width: OUTPUT_WIDTH,
    },
    ffmpeg: { args, command: ffmpegPath },
    subtitles,
    targetPath,
    temporaryPath,
  };
}
