import type { SubtitleClip, SubtitleTrack, VideoProject } from '@miaoma/video-project';

/**
 * 字幕烧录判定：工程开关 + 字幕轨可见 + 至少一条可渲染的字幕片段。
 *
 * 主进程用它决定是否生成 ASS 文档，导出弹窗用它展示参数区的“字幕”状态——
 * 两处必须是同一条规则，否则弹窗会说“烧录”而成片里没有字幕。
 * v1 的 RenderConfig 把 `burnSubtitles` 固定为 true；这里仍显式读它，
 * 让规则与“导出参数来自 RenderConfig”的约定保持一致。
 */
export function shouldBurnSubtitles(project: Pick<VideoProject, 'render' | 'tracks'>): boolean {
  if (!project.render.burnSubtitles) {
    return false;
  }

  const track = project.tracks.find(
    (candidate): candidate is SubtitleTrack => candidate.kind === 'subtitle',
  );

  return track !== undefined && track.visible && track.clips.some(isRenderableSubtitleClip);
}

/** 空白文本与零/负时长片段不会进入 ASS，等于“没有可烧录的字幕”。 */
export function isRenderableSubtitleClip(clip: SubtitleClip): boolean {
  return clip.text.trim().length > 0 && clip.endMs > clip.startMs;
}
