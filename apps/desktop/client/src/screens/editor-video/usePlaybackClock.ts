import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  advancePosition,
  createAnchor,
  createPlaybackState,
  playbackReducer,
  resolvePlayStart,
  type PlaybackStatus,
} from './playback';

/** 画面状态按约 30fps 刷新即可；媒体同步依赖锚点，不受刷新率影响。 */
const RENDER_INTERVAL_MS = 33;

export interface PlaybackClock {
  currentTime: number;
  pause: () => void;
  play: () => void;
  playing: boolean;
  seek: (seconds: number) => void;
  status: PlaybackStatus;
  toggle: () => void;
}

/**
 * rAF 主时钟：以播放/暂停/seek 时刻为锚点推进位置，
 * 而不是累加每次 rAF 的 delta，因此完整播放不会累计漂移。
 */
export function usePlaybackClock(durationSeconds: number): PlaybackClock {
  const [state, dispatch] = useReducer(playbackReducer, undefined, createPlaybackState);
  const stateRef = useRef(state);
  const durationRef = useRef(durationSeconds);
  const anchorRef = useRef(createAnchor(0, 0));

  stateRef.current = state;
  durationRef.current = durationSeconds;

  const seek = useCallback((seconds: number) => {
    const duration = durationRef.current;
    const position = Math.min(Math.max(0, seconds), duration);

    anchorRef.current = createAnchor(position, performance.now());
    dispatch({ durationSeconds: duration, positionSeconds: position, type: 'seek' });
  }, []);

  const play = useCallback(() => {
    const duration = durationRef.current;
    const start = resolvePlayStart(stateRef.current.positionSeconds, duration);

    if (start === null) {
      return;
    }

    anchorRef.current = createAnchor(start, performance.now());
    dispatch({ durationSeconds: duration, positionSeconds: start, type: 'play' });
  }, []);

  const pause = useCallback(() => {
    const now = performance.now();
    const current = stateRef.current;
    const position =
      current.status === 'playing'
        ? Math.min(durationRef.current, advancePosition(anchorRef.current, now))
        : current.positionSeconds;

    anchorRef.current = createAnchor(position, now);
    dispatch({ positionSeconds: position, type: 'pause' });
  }, []);

  const toggle = useCallback(() => {
    if (stateRef.current.status === 'playing') {
      pause();
    } else {
      play();
    }
  }, [pause, play]);

  useEffect(() => {
    if (state.status !== 'playing') {
      return;
    }

    let frame = 0;
    let lastDispatch = performance.now();

    const step = (now: number) => {
      const duration = durationRef.current;
      const position = Math.min(duration, advancePosition(anchorRef.current, now));

      if (now - lastDispatch >= RENDER_INTERVAL_MS || position >= duration) {
        lastDispatch = now;
        dispatch({ durationSeconds: duration, positionSeconds: position, type: 'progress' });
      }

      if (position < duration) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [state.status]);

  return {
    currentTime: state.positionSeconds,
    pause,
    play,
    playing: state.status === 'playing',
    seek,
    status: state.status,
    toggle,
  };
}
