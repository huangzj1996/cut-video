/**
 * 预览播放的纯状态与时钟计算。
 *
 * 主时钟不读取任何媒体元素的 currentTime：位置由锚点 + 单调时钟推进，
 * 媒体元素只在漂移超过 50ms 时被动校正，因此不存在多处时钟互相追赶。
 */

export const DRIFT_THRESHOLD_SECONDS = 0.05;

/** 时间码分段：纯十进制，可选小数；小时/分钟段不允许小数。 */
const DECIMAL_PART = /^\d+(?:\.\d+)?$/;
const INTEGER_PART = /^\d+$/;

export type PlaybackStatus = 'ended' | 'paused' | 'playing';

export interface PlaybackState {
  positionSeconds: number;
  status: PlaybackStatus;
}

export type PlaybackAction =
  | { durationSeconds: number; positionSeconds?: number; type: 'play' }
  | { positionSeconds?: number; type: 'pause' }
  | { durationSeconds: number; type: 'toggle' }
  | { durationSeconds: number; positionSeconds: number; type: 'seek' }
  | { durationSeconds: number; positionSeconds: number; type: 'progress' }
  | { durationSeconds: number; type: 'ended' };

export interface PlaybackAnchor {
  atMs: number;
  positionSeconds: number;
}

export function clampPosition(seconds: number, durationSeconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.min(Math.max(0, seconds), Math.max(0, durationSeconds));
}

export function createPlaybackState(): PlaybackState {
  return { positionSeconds: 0, status: 'paused' };
}

export function createAnchor(positionSeconds: number, nowMs: number): PlaybackAnchor {
  return { atMs: nowMs, positionSeconds };
}

export function advancePosition(anchor: PlaybackAnchor, nowMs: number): number {
  return anchor.positionSeconds + Math.max(0, nowMs - anchor.atMs) / 1_000;
}

/**
 * 播放起点：播放头已在末尾时从 0 重播；时长为 0 的项目无法播放，返回 null。
 */
export function resolvePlayStart(positionSeconds: number, durationSeconds: number): number | null {
  if (durationSeconds <= 0) {
    return null;
  }

  const from = clampPosition(positionSeconds, durationSeconds);

  return from >= durationSeconds ? 0 : from;
}

export function needsDriftCorrection(
  masterSeconds: number,
  mediaSeconds: number,
  thresholdSeconds = DRIFT_THRESHOLD_SECONDS,
): boolean {
  // 消除二进制浮点在“恰好 50ms”边界上的误差。
  return Math.abs(masterSeconds - mediaSeconds) > thresholdSeconds + 1e-9;
}

function play(durationSeconds: number, positionSeconds: number): PlaybackState {
  const start = resolvePlayStart(positionSeconds, durationSeconds);

  if (start === null) {
    return { positionSeconds: 0, status: 'paused' };
  }

  return { positionSeconds: start, status: 'playing' };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'play':
      return play(action.durationSeconds, action.positionSeconds ?? state.positionSeconds);

    case 'pause':
      return {
        positionSeconds:
          action.positionSeconds === undefined
            ? state.positionSeconds
            : Math.max(0, action.positionSeconds),
        status: 'paused',
      };

    case 'toggle':
      return state.status === 'playing'
        ? playbackReducer(state, { type: 'pause' })
        : playbackReducer(state, {
            durationSeconds: action.durationSeconds,
            type: 'play',
          });

    case 'seek': {
      const positionSeconds = clampPosition(action.positionSeconds, action.durationSeconds);

      if (positionSeconds >= action.durationSeconds) {
        return { positionSeconds, status: 'ended' };
      }

      return {
        positionSeconds,
        status: state.status === 'playing' ? 'playing' : 'paused',
      };
    }

    case 'progress':
      if (state.status !== 'playing') {
        return state;
      }

      return {
        positionSeconds: clampPosition(action.positionSeconds, action.durationSeconds),
        status: action.positionSeconds >= action.durationSeconds ? 'ended' : state.status,
      };

    case 'ended':
      return { positionSeconds: Math.max(0, action.durationSeconds), status: 'ended' };
  }
}

/**
 * 解析用户输入的时间码：`12`、`12.5`、`MM:SS`、`HH:MM:SS`。
 * 每段必须是十进制数（小数只允许出现在秒），分和秒必须小于 60；
 * 非法输入返回 null，调用方保持原播放头。
 */
export function parseTimecode(input: string): number | null {
  const text = input.trim();

  if (text.length === 0) {
    return null;
  }

  const parts = text.split(':');

  if (parts.length > 3) {
    return null;
  }

  if (parts.some((part) => !DECIMAL_PART.test(part))) {
    return null;
  }

  if (parts.slice(0, -1).some((part) => !INTEGER_PART.test(part))) {
    return null;
  }

  const values = parts.map(Number);
  const seconds = values[values.length - 1]!;

  if (parts.length === 1) {
    return seconds;
  }

  if (seconds >= 60) {
    return null;
  }

  if (parts.length === 2) {
    return values[0]! * 60 + seconds;
  }

  const minutes = values[1]!;

  if (minutes >= 60) {
    return null;
  }

  return values[0]! * 3_600 + minutes * 60 + seconds;
}
