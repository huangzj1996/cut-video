import path from 'node:path';
import type {
  MusicClip,
  MusicTrack,
  VideoAsset,
  VideoClip,
  VideoProject,
  VoiceClip,
  VoiceTrack,
} from '@miaoma/video-project';
import { EXPORT_OUTPUT_SPEC, type ExportErrorCode } from '../../shared/ipc-contract';
import type { ExportFonts } from './fonts';
import { buildSubtitleDocument, subtitleArtifactFileNames } from './subtitles';
import { partialPathFor, premixPartialPathFor } from './target';

export const OUTPUT_WIDTH = EXPORT_OUTPUT_SPEC.width;
export const OUTPUT_HEIGHT = EXPORT_OUTPUT_SPEC.height;
export const OUTPUT_FPS = EXPORT_OUTPUT_SPEC.fps;
export const OUTPUT_SAMPLE_RATE = 48_000;
export const OUTPUT_CHANNELS = 2;

const OUTPUT_CRF = 20;
const OUTPUT_PRESET = 'medium';
const VIDEO_CODEC = 'libx264';
const PIXEL_FORMAT = 'yuv420p';
const AUDIO_CODEC: 'aac' = EXPORT_OUTPUT_SPEC.audioCodec;
const AUDIO_BITRATE_KBPS = EXPORT_OUTPUT_SPEC.audioBitrateKbps;
const AUDIO_CHANNEL_LAYOUT = 'stereo';
const SAMPLES_PER_MS = OUTPUT_SAMPLE_RATE / 1000;
/**
 * 本构建的 amix 恒做归一化（把结果除以输入数），且无法关闭；
 * 所以每次混音都按输入数把增益补回来，成片音量才与预览一致。
 * 固定两路（配音轨 + 音乐轨）混音，输入数为 2。
 */
const MIX_INPUT_COUNT = 2;
/**
 * 两路声音相加可能超过满幅；预览在浏览器里会硬削波，导出用限幅器兜底以满足“无削波”。
 * attack 取最小值（0.1ms），把 lookahead 引入的延迟压到约 0.1ms，远小于一个输出帧。
 */
const AUDIO_LIMITER = 'alimiter=limit=0.98:level=false:attack=0.1';
const SILENT_AUDIO_SOURCE = `anullsrc=r=${OUTPUT_SAMPLE_RATE}:cl=${AUDIO_CHANNEL_LAYOUT}`;
const AUDIO_INPUT_FILTERS = [
  `aresample=${OUTPUT_SAMPLE_RATE}`,
  `aformat=sample_rates=${OUTPUT_SAMPLE_RATE}:channel_layouts=${AUDIO_CHANNEL_LAYOUT}`,
];

export interface ExportExpectedOutput {
  audioBitrateKbps: number;
  audioCodec: 'aac';
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
  /** 第一段：把配音与音乐混成一条与时间线等长的预混音轨。 */
  premix: ExportFfmpegCommand;
  /** 预混音轨的临时文件；成功、失败、取消都必须由任务清理。 */
  premixTemporaryPath: string;
  /** 第二段：单遍视频编码并从预混音轨封装 AAC。 */
  render: ExportFfmpegCommand;
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

interface PremixGraphPlan {
  graph: string;
  inputs: string[];
}

interface AudioChainInput<T> {
  clip: T;
  index: number;
  label: string;
  totalSamples: number;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function frameAt(ms: number): number {
  return Math.round((ms * OUTPUT_FPS) / 1000);
}

function samplesAt(ms: number): number {
  return Math.round(ms * SAMPLES_PER_MS);
}

function sortedByStart<T extends { startMs: number }>(clips: readonly T[]): T[] {
  return clips.slice().sort((left, right) => left.startMs - right.startMs);
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
 * 所有音频片段共用的收尾：按片段音量取增益、延迟到片段起点、补齐到时间线末尾。
 * 片段音频短于片段时长时由 apad 补静音，与预览里“播完即停”一致。
 */
function finishAudioChain(input: {
  filters: string[];
  startMs: number;
  totalSamples: number;
  volume: number;
}): string {
  const { filters, startMs, totalSamples, volume } = input;

  filters.push('volume=' + String(volume));

  if (startMs > 0) {
    filters.push('adelay=' + startMs + '|' + startMs);
  }

  filters.push(
    'apad=whole_len=' + totalSamples,
    'atrim=end_sample=' + totalSamples,
    'asetpts=PTS-STARTPTS',
  );

  return filters.join(',');
}

/**
 * 把一条配音片段叠到时间线上：源音频从 0 开始，按语速伸缩，按片段时长截断。
 */
function buildVoiceChain(input: AudioChainInput<VoiceClip>): string {
  const { clip, index, label, totalSamples } = input;
  const spanSamples = Math.max(1, samplesAt(clip.endMs - clip.startMs));
  const speed = clip.speed ?? 1;
  const filters = [...AUDIO_INPUT_FILTERS];

  if (speed !== 1) {
    filters.push('atempo=' + String(speed));
  }

  filters.push('atrim=end_sample=' + spanSamples, 'asetpts=PTS-STARTPTS');

  const chain = finishAudioChain({
    filters,
    startMs: clip.startMs,
    totalSamples,
    volume: clip.volume ?? 1,
  });

  return `[${index}:a]${chain}${label}`;
}

/**
 * 把一条音乐片段叠到时间线上：先裁出 [sourceStart, sourceEnd] 的源窗口；
 * loop 时用 aloop 在窗口内循环（循环次数按片段跨度算，留一轮余量），
 * 不 loop 时播放到窗口末尾即停、后面补静音，与预览一致。
 */
function buildMusicChain(input: AudioChainInput<MusicClip>): string {
  const { clip, index, label, totalSamples } = input;
  const spanSamples = Math.max(1, samplesAt(clip.endMs - clip.startMs));
  const sourceStartSample = samplesAt(clip.sourceStartMs);
  const sourceEndSample = Math.max(sourceStartSample + 1, samplesAt(clip.sourceEndMs));
  const windowSamples = sourceEndSample - sourceStartSample;
  const filters = [
    ...AUDIO_INPUT_FILTERS,
    `atrim=start_sample=${sourceStartSample}:end_sample=${sourceEndSample}`,
    'asetpts=PTS-STARTPTS',
  ];

  if (clip.loop) {
    filters.push(
      'aloop=loop=' + (Math.ceil(spanSamples / windowSamples) + 1) + ':size=' + windowSamples,
    );
  }

  filters.push('atrim=end_sample=' + spanSamples, 'asetpts=PTS-STARTPTS');

  const chain = finishAudioChain({
    filters,
    startMs: clip.startMs,
    totalSamples,
    volume: clip.volume ?? 1,
  });

  return `[${index}:a]${chain}${label}`;
}

/**
 * 把一轨的所有片段拼成一条与时间线等长的流。
 * 每个片段流在混音前都已补齐到等长，因此 amix 不会触发“输入提前结束”的
 * dropout 重归一化；amix 的固定归一化再按输入数补回。
 */
function buildBus(input: {
  graphs: string[];
  label: string;
  labels: string[];
  totalSamples: number;
}): string | null {
  const { graphs, label, labels, totalSamples } = input;

  if (labels.length === 0) {
    return null;
  }

  if (labels.length === 1) {
    graphs.push(`${labels[0]}volume=1[${label}]`);
    return label;
  }

  graphs.push(
    `${labels.join('')}amix=inputs=${labels.length}:duration=longest,volume=${labels.length},` +
      `atrim=end_sample=${totalSamples},asetpts=PTS-STARTPTS[${label}]`,
  );

  return label;
}

function buildPremixGraph(input: {
  project: VideoProject;
  totalDurationMs: number;
  totalSamples: number;
}): PremixGraphPlan {
  const { project, totalDurationMs, totalSamples } = input;
  const graphs: string[] = [];
  const inputs: string[] = [];
  const voicesById = new Map(project.assets.voices.map((asset) => [asset.id, asset]));
  const musicById = new Map(project.assets.music.map((asset) => [asset.id, asset]));
  const voiceTrack = project.tracks.find((track): track is VoiceTrack => track.kind === 'voice');
  const musicTrack = project.tracks.find((track): track is MusicTrack => track.kind === 'music');
  const voiceClips = sortedByStart(voiceTrack?.clips ?? []);
  // 音乐轨关闭是可听性关闭：片段与波形保留，混音里不出现。
  const musicClips = (musicTrack?.visible ?? true) ? sortedByStart(musicTrack?.clips ?? []) : [];
  let inputCount = 0;

  const addInput = (filePath: string): number => {
    const index = inputCount;
    inputs.push('-i', filePath);
    inputCount += 1;
    return index;
  };

  const assertInTimeline = (endMs: number): void => {
    if (endMs > totalDurationMs) {
      throw new ExportPlanError('音频片段超出时间线，无法导出。');
    }
  };

  const voiceLabels = voiceClips.map((clip, order) => {
    const asset = voicesById.get(clip.assetId);

    if (!asset) {
      throw new ExportPlanError('配音片段引用了不存在的音频素材。');
    }

    assertInTimeline(clip.endMs);
    const label = `[voice${order}]`;
    graphs.push(buildVoiceChain({ clip, index: addInput(asset.path), label, totalSamples }));
    return label;
  });

  const musicLabels = musicClips.map((clip, order) => {
    const asset = musicById.get(clip.assetId);

    if (!asset) {
      throw new ExportPlanError('音乐片段引用了不存在的音频素材。');
    }

    assertInTimeline(clip.endMs);
    const label = `[music${order}]`;
    graphs.push(buildMusicChain({ clip, index: addInput(asset.path), label, totalSamples }));
    return label;
  });

  const voiceBus = buildBus({ graphs, label: 'voicebus', labels: voiceLabels, totalSamples });
  const musicBus = buildBus({ graphs, label: 'musicbus', labels: musicLabels, totalSamples });
  const onlyBus = voiceBus ?? musicBus;

  if (voiceBus && musicBus) {
    graphs.push(
      `[${voiceBus}][${musicBus}]amix=inputs=${MIX_INPUT_COUNT}:duration=longest,` +
        `volume=${MIX_INPUT_COUNT},${AUDIO_LIMITER},` +
        `atrim=end_sample=${totalSamples},asetpts=PTS-STARTPTS[aout]`,
    );
  } else if (onlyBus) {
    // 只有一轨有声音时不做二路混音，也不加倍增益，避免单轨被放大到削波。
    graphs.push(`[${onlyBus}]volume=1[aout]`);
  } else {
    graphs.push(
      `${SILENT_AUDIO_SOURCE},atrim=end_sample=${totalSamples},asetpts=PTS-STARTPTS[aout]`,
    );
  }

  return { graph: graphs.join(';'), inputs };
}

function buildVideoCommand(input: {
  durationSeconds: string;
  ffmpegPath: string;
  premixTemporaryPath: string;
  project: VideoProject;
  subtitleFilter: string | null;
  temporaryPath: string;
  totalDurationMs: number;
}): ExportFfmpegCommand {
  const {
    durationSeconds,
    ffmpegPath,
    premixTemporaryPath,
    project,
    subtitleFilter,
    temporaryPath,
    totalDurationMs,
  } = input;
  const videoTrack = project.tracks.find((track) => track.kind === 'video');

  if (!videoTrack || videoTrack.kind !== 'video' || videoTrack.clips.length === 0) {
    throw new ExportPlanError('视频轨没有可导出的片段。');
  }

  const clips = videoTrack.clips.slice().sort((left, right) => left.startMs - right.startMs);
  const inputs: string[] = [];
  const filterChains: string[] = [];
  const concatLabels: string[] = [];
  let cursorMs = 0;
  let cursorFrame = 0;
  let inputCount = 0;

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

    inputCount += 1;
    filterChains.push(buildClipFilter({ asset, clip, frameCount, index }));
    concatLabels.push('[v' + index + ']');
    cursorMs = clip.endMs;
    cursorFrame = endFrame;
  }

  if (cursorMs !== totalDurationMs) {
    throw new ExportPlanError('视频轨未覆盖完整时间线，无法导出。');
  }

  const postFilters = ['concat=n=' + clips.length + ':v=1:a=0'];

  if (subtitleFilter) {
    postFilters.push(subtitleFilter);
  }

  postFilters.push('format=' + PIXEL_FORMAT);

  const graph =
    filterChains.join(';') + ';' + concatLabels.join('') + postFilters.join(',') + '[vout]';
  // 源视频原声不映射：视频输入只取 :v，音频只来自预混音轨。
  const args = [
    '-y',
    '-hide_banner',
    ...inputs,
    '-i',
    premixTemporaryPath,
    '-filter_complex',
    graph,
    '-map',
    '[vout]',
    '-map',
    inputCount + ':a',
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
    '-c:a',
    AUDIO_CODEC,
    '-b:a',
    AUDIO_BITRATE_KBPS + 'k',
    '-ar',
    String(OUTPUT_SAMPLE_RATE),
    '-ac',
    String(OUTPUT_CHANNELS),
    '-t',
    durationSeconds,
    '-f',
    EXPORT_OUTPUT_SPEC.container,
    '-movflags',
    '+faststart',
    temporaryPath,
  ];

  return { args, command: ffmpegPath };
}

/**
 * 导出计划编译器：把时间线换成两段可执行的 ffmpeg 参数与期望输出规格。
 *
 * 第一段把配音与音乐按片段音量/语速/循环混成一条与时间线等长的预混音轨，
 * 第二段单遍视频编码并从预混音轨封装 AAC 192kbps，字幕轨可见时在拼接后用
 * ass 滤镜烧录（ASS/fontsdir 用相对 ASCII 文件名 + 进程 cwd，中文绝对路径实测失败）。
 * 源视频原声不参与映射；时间统一用整数毫秒，音频按 48kHz 样本数对齐，
 * 输出时长与片段边界按 30fps 量化。纯函数：不读磁盘、不启动进程。
 */
export function compileExportPlan(input: CompileExportPlanInput): ExportPlan {
  const { project, targetPath, ffmpegPath } = input;
  const totalDurationMs = project.scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const totalFrameCount = Math.max(1, frameAt(totalDurationMs));
  const durationMs = Math.round((totalFrameCount / OUTPUT_FPS) * 1000);
  const durationSeconds = (durationMs / 1000).toFixed(3);
  const totalSamples = samplesAt(durationMs);
  const temporaryPath = partialPathFor(targetPath);
  const premixTemporaryPath = premixPartialPathFor(targetPath);
  const premix = buildPremixGraph({ project, totalDurationMs, totalSamples });
  // 预混音轨写成无损 PCM 临时文件，最终封装时才编码 AAC，避免中间再压一次。
  const premixArgs = [
    '-y',
    '-hide_banner',
    ...premix.inputs,
    '-filter_complex',
    premix.graph,
    '-map',
    '[aout]',
    '-ar',
    String(OUTPUT_SAMPLE_RATE),
    '-ac',
    String(OUTPUT_CHANNELS),
    '-c:a',
    'pcm_s16le',
    '-t',
    durationSeconds,
    '-f',
    'wav',
    premixTemporaryPath,
  ];
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
  const subtitleFilter =
    artifactNames && subtitles
      ? 'ass=filename=' + artifactNames.assFileName + ':fontsdir=' + artifactNames.fontsDirName
      : null;

  return {
    cwd,
    expected: {
      audioBitrateKbps: AUDIO_BITRATE_KBPS,
      audioCodec: AUDIO_CODEC,
      container: EXPORT_OUTPUT_SPEC.container,
      durationMs,
      frameCount: totalFrameCount,
      fps: OUTPUT_FPS,
      height: OUTPUT_HEIGHT,
      videoCodec: EXPORT_OUTPUT_SPEC.videoCodec,
      width: OUTPUT_WIDTH,
    },
    premix: { args: premixArgs, command: ffmpegPath },
    premixTemporaryPath,
    render: buildVideoCommand({
      durationSeconds,
      ffmpegPath,
      premixTemporaryPath,
      project,
      subtitleFilter,
      temporaryPath,
      totalDurationMs,
    }),
    subtitles,
    targetPath,
    temporaryPath,
  };
}
