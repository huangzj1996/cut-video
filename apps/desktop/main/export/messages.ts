import { EXPORT_CANCELLED_NOTICE } from '../../shared/export-copy';
import type { VideoCapabilityProblem } from '../../shared/video-capabilities';
import type { ExportSyncIssueCode, ExportSyncReport } from './sync-check';

/**
 * 导出链路上所有面向用户的中文文案集中在这里。
 *
 * 错误码在 `shared/ipc-contract` 声明，文案在主进程的抛出点引用本模块，
 * 避免同一类问题在服务、任务与弹窗里各写一份而逐渐漂移；
 * 预览与导出共用的能力事实在 `shared/video-capabilities`，导出文案仍归本模块。
 */
export const EXPORT_MESSAGES = {
  alreadyRunning: '已有导出任务正在进行中。',
  cancelled: EXPORT_CANCELLED_NOTICE,
  unexpectedFailure: '导出过程异常中止，未提交成品。',

  draftProject: '草稿工程不能导出。',
  workflowReadonly: 'AI 工作流正在运行或等待审批，暂不能导出。',
  staleRevision: '工程内容已更新，请重新打开导出。',

  ffmpegMissing: '未找到 FFmpeg，无法导出。',
  fontMissing: '缺少随包中文字体，无法烧录字幕，请重新安装完整版本。',
  targetUnwritable: '导出位置不可写，请选择其他文件夹。',
  targetIsDirectory: '导出位置是文件夹，请选择一个 .mp4 文件路径。',
  targetInaccessible: '无法访问导出位置，请选择其他文件夹。',
  targetTooManyDuplicates: '导出位置已有过多同名文件，请更换保存位置。',
  validationFailed: '导出前校验未通过，请先修复以下问题。',

  unsupportedMedia: '存在当前版本不支持的视频素材，请先替换后再导出。',
  unsupportedMediaOrTransform: '存在当前版本不支持的视频素材或画面裁剪/变换，请先修复后再导出。',
  unsupportedTransform: '存在当前版本不支持的画面裁剪或变换，请恢复默认后再导出。',
  unsupportedCrop: '当前版本只支持默认裁剪，请恢复默认裁剪后再导出。',
  unsupportedTransformClip: '当前版本只支持默认画面变换，请恢复默认变换后再导出。',

  subtitleWriteFailed: '无法写入字幕临时产物，导出未开始。',
  subtitleFontPrepareFailed: '无法准备随包字幕字体，导出未开始。',
  premixFailed: '预混音轨失败，导出未完成。',
  premixEmpty: '预混音轨没有产出有效音轨，导出未完成。',
  renderFailed: '渲染进程失败，导出未完成。',
  renderEmpty: '渲染没有产出有效文件，导出未完成。',
  commitFailed: '无法提交导出成品，请检查保存位置。',

  /** 同步自检（结构性）的中文文案；客观数字由 exportSyncFailureMessage 拼进主句。 */
  syncCheck: {
    unreadable: '无法读取成片媒体信息，同步自检未通过，未提交成品。',
    probeFailed: '读取成片媒体信息失败，同步自检未通过，未提交成品。',
    durationUnreadable: '成片时长读不到',
    frameRateUnreadable: '成片帧率读不到',
    missingStreams: '成片缺少视频流或音轨',
    outputMismatch: '输出参数与渲染配置不一致',
    startUnreadable: '成片起点读不到',
    resolutionUnreadable: '成片分辨率读不到',
  },

  /** 导出计划编译器拒绝导出时使用的原因。 */
  plan: {
    audioOutOfTimeline: '音频片段超出时间线，无法导出。',
    clipTooShort: '视频片段短于一个输出帧或与时间线不对齐，无法导出。',
    fontMissingForSubtitles: '缺少随包中文字体，无法烧录字幕。',
    musicAssetMissing: '音乐片段引用了不存在的音频素材。',
    noVideoClips: '视频轨没有可导出的片段。',
    videoAssetMissing: '视频片段引用了不存在的素材。',
    videoGapOrOverlap: '视频轨片段之间存在空隙或重叠，无法导出。',
    videoNotCoveringTimeline: '视频轨未覆盖完整时间线，无法导出。',
    voiceAssetMissing: '配音片段引用了不存在的音频素材。',
  },
} as const;

function formatDeltaMs(value: number): string {
  // 客观数字保留一位小数：既能看出 0.033s 级别的偏差，也不至于噪声化。
  return `${(Math.round(value * 10) / 10).toFixed(1)}ms`;
}

/** 按 code 把自检问题归到一句中文短句上；新增 code 时这里补一行即可。 */
function syncIssueText(code: ExportSyncIssueCode): string | null {
  switch (code) {
    case 'MISSING_VIDEO_STREAM':
    case 'MISSING_AUDIO_STREAM':
      return EXPORT_MESSAGES.syncCheck.missingStreams;
    case 'VIDEO_CODEC_MISMATCH':
    case 'AUDIO_CODEC_MISMATCH':
    case 'RESOLUTION_MISMATCH':
    case 'FRAME_RATE_MISMATCH':
      return EXPORT_MESSAGES.syncCheck.outputMismatch;
    case 'MISSING_DURATION':
      return EXPORT_MESSAGES.syncCheck.durationUnreadable;
    case 'MISSING_START_TIME':
      return EXPORT_MESSAGES.syncCheck.startUnreadable;
    case 'MISSING_RESOLUTION':
      return EXPORT_MESSAGES.syncCheck.resolutionUnreadable;
    case 'MISSING_FRAME_RATE':
      return EXPORT_MESSAGES.syncCheck.frameRateUnreadable;
    default:
      return null;
  }
}

/**
 * 同步自检失败的主句：先给客观数字（起点差、时长差），再说差异类别。
 * 失败细节（issue 的技术描述）另走 exportSyncIssueDetail，与 stderr 一样只放在“查看失败详情”里。
 */
export function exportSyncFailureMessage(report: ExportSyncReport): string {
  const codes = report.issues.map((issue) => issue.code);

  if (codes.includes('METADATA_UNPARSABLE')) {
    return EXPORT_MESSAGES.syncCheck.unreadable;
  }

  const { durationDeltaMs, startDeltaMs } = report.measurements;
  const parts: string[] = [];

  if (startDeltaMs !== null && durationDeltaMs !== null) {
    parts.push(
      `音视频起点差 ${formatDeltaMs(startDeltaMs)}、时长差 ${formatDeltaMs(durationDeltaMs)}（容差一个输出帧，${formatDeltaMs(report.toleranceMs)}）`,
    );
  }

  // 同一类问题只出现一次，避免“缺流”这类结论在句子里重复。
  const summaries = new Set<string>();

  for (const code of codes) {
    const text = syncIssueText(code);

    if (text !== null) {
      summaries.add(text);
    }
  }

  parts.push(...summaries);

  return `同步自检未通过（${parts.join('；')}），未提交成品。`;
}

/** 同步自检失败的技术细节；与 ffmpeg 的 stderr 尾部一样只进可展开详情。 */
export function exportSyncIssueDetail(report: ExportSyncReport): string | undefined {
  const lines = report.issues.map((issue) => issue.code + ': ' + issue.detail);

  return lines.length > 0 ? lines.join('\n') : undefined;
}

/** 能力边界文案里统一引用的格式提示。 */
export const EXPORT_FORMAT_HINT = '目前仅支持 H.264/AAC 的 MP4/MOV。';

/** 把共享的能力边界事实翻译成导出场景的中文文案。 */
export function exportCapabilityMessage(problem: VideoCapabilityProblem): string {
  switch (problem.kind) {
    case 'unsupported-codec':
      return `不支持的视频编码：${problem.codec}。${EXPORT_FORMAT_HINT}`;
    case 'unsupported-hdr':
      return 'HDR 视频暂不支持导出，请使用 SDR 素材。';
    case 'unsupported-vfr':
      return 'VFR（可变帧率）视频暂不支持导出，请使用恒定帧率素材。';
  }
}
