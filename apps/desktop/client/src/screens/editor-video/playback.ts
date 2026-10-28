/**
 * 预览播放的纯状态与时钟计算。
 *
 * 主时钟不读取任何媒体元素的 currentTime：位置由锚点 + 单调时钟推进，
 * 媒体元素只在漂移超过 50ms 时被动校正，因此不存在多处时钟互相追赶。
 */

export const DRIFT_THRESHOLD_SECONDS = 0.05;

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

function clampPosition(seconds: number, durationSeconds: number): number {
  const upper = Math.max(0, durationSeconds);

  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.min(Math.max(0, seconds), upper);
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

export function needsDriftCorrection(
  masterSeconds: number,
  mediaSeconds: number,
  thresholdSeconds = DRIFT_THRESHOLD_SECONDS,
): boolean {
  // 消除二进制浮点在“恰好 50ms”边界上的误差。
  return Math.abs(masterSeconds - mediaSeconds) > thresholdSeconds + 1e-9;
}

function play(
  state: PlaybackState,
  durationSeconds: number,
  positionSeconds: number,
): PlaybackState {
  if (durationSeconds <= 0) {
    return { positionSeconds: 0, status: 'paused' };
  }

  const from = clampPosition(positionSeconds, durationSeconds);
  const start = from >= durationSeconds ? 0 : from;

  return { positionSeconds: start, status: 'playing' };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'play':
      return play(state, action.durationSeconds, action.positionSeconds ?? state.positionSeconds);

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
 * 分和秒必须小于 60；非法输入返回 null，调用方保持原播放头。
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

  const values = parts.map((part) => Number(part));

  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }

  if (parts.length === 1) {
    return values[0]!;
  }

  const seconds = values[values.length - 1]!;

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
