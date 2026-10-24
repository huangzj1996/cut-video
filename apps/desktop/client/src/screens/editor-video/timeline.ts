export interface TimelineClip {
  accent: string;
  background: string;
  endSeconds: number;
  id: string;
  label: string;
  startSeconds: number;
}

export interface RectLike {
  left: number;
  width: number;
}

export type PreviewFrame =
  | {
      clip: TimelineClip;
      frameIndex: number;
      kind: 'clip';
      localSeconds: number;
    }
  | { kind: 'empty' };

export function clampTime(time: number, maxSeconds: number): number {
  const upper = Math.max(0, maxSeconds);

  return Math.min(Math.max(0, time), upper);
}

export function clientXToTime(clientX: number, rect: RectLike, maxSeconds: number): number {
  if (rect.width <= 0 || maxSeconds <= 0) {
    return 0;
  }

  const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

  return fraction * maxSeconds;
}

export function secondsToPercent(seconds: number, spanSeconds: number): number {
  if (spanSeconds <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (seconds / spanSeconds) * 100));
}

export function findActiveClip<T extends Pick<TimelineClip, 'endSeconds' | 'startSeconds'>>(
  clips: readonly T[],
  timeSeconds: number,
): T | undefined {
  for (const clip of clips) {
    if (timeSeconds >= clip.startSeconds && timeSeconds < clip.endSeconds) {
      return clip;
    }
  }

  // 时间恰好停在工程末尾时，仍显示最后一帧；再往后就是空白死区。
  const last = clips[clips.length - 1];

  if (last && timeSeconds === last.endSeconds && timeSeconds >= last.startSeconds) {
    return last;
  }

  return undefined;
}

export function resolvePreviewFrame(
  timeSeconds: number,
  clips: readonly TimelineClip[],
  projectSeconds: number,
  fps = 30,
): PreviewFrame {
  if (timeSeconds > projectSeconds) {
    return { kind: 'empty' };
  }

  const clip = findActiveClip(clips, timeSeconds);

  if (!clip) {
    return { kind: 'empty' };
  }

  const localSeconds = Math.max(0, timeSeconds - clip.startSeconds);

  return {
    clip,
    frameIndex: Math.floor(localSeconds * fps),
    kind: 'clip',
    localSeconds,
  };
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
