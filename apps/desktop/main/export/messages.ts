import { EXPORT_CANCELLED_NOTICE } from '../../shared/export-copy';
import type { VideoCapabilityProblem } from '../../shared/video-capabilities';

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
