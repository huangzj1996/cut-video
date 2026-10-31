import type { VideoClip, VideoProject } from '@miaoma/video-project';

/** 视频轨片段按开始时间排序；没有视频轨时为空。前置校验与计划编译器共用。 */
export function sortedVideoClips(project: VideoProject): VideoClip[] {
  const track = project.tracks.find((candidate) => candidate.kind === 'video');

  return track && track.kind === 'video'
    ? track.clips.slice().sort((left, right) => left.startMs - right.startMs)
    : [];
}
