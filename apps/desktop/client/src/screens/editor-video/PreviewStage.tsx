/**
 * 真实预览舞台：双 `<video>` 交换 + 配音/音乐 `<audio>`。
 *
 * 播放位置由父层的 rAF 主时钟提供；这里只负责把三类媒体对齐到同一时间点，
 * 并在漂移超过 50ms 时校正。下一片段提前预加载到另一个 video 槽位，
 * 因此正常切镜时不需要等待加载，也不会出现长时间黑屏。
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { assetUrl } from '../../lib/media';
import { DRIFT_THRESHOLD_SECONDS } from './playback';
import {
  audioReachedSourceEnd,
  describeMediaElementError,
  type PreviewAudioPlan,
  type PreviewMediaPlan,
} from './preview-media';
import { formatTime } from './timeline';
import {
  createVideoSlots,
  markSlotFailed,
  markSlotReady,
  syncVideoSlots,
  VIDEO_SLOT_KEYS,
  visibleSlot,
  type VideoSlot,
  type VideoSlotDemand,
  type VideoSlotKey,
  type VideoSlotsState,
} from './video-slots';

interface PreviewStageProps {
  currentTime: number;
  musicTrackActive: boolean;
  muted: boolean;
  plan: PreviewMediaPlan;
  playing: boolean;
  projectId: string;
  stageRef: RefObject<HTMLDivElement | null>;
  voiceTrackActive: boolean;
}

const VIDEO_SLOT_REFS: readonly VideoSlotKey[] = VIDEO_SLOT_KEYS;

function applySlotSource(
  element: HTMLVideoElement | null,
  slot: VideoSlot,
  projectId: string,
): void {
  if (!element) {
    return;
  }

  if (!slot.assetId) {
    if (element.dataset.assetId) {
      delete element.dataset.assetId;
      element.removeAttribute('src');
      element.load();
    }

    return;
  }

  if (element.dataset.assetId === slot.assetId) {
    return;
  }

  element.dataset.assetId = slot.assetId;
  element.src = assetUrl(projectId, slot.assetId);
  element.load();
}

function syncAudioElement(
  element: HTMLAudioElement | null,
  plan: PreviewAudioPlan | null,
  projectId: string,
  muted: boolean,
  playing: boolean,
): boolean {
  if (!element) {
    return false;
  }

  if (!plan) {
    if (!element.paused) {
      element.pause();
    }

    return false;
  }

  const sourceChanged = element.dataset.assetId !== plan.assetId;

  if (sourceChanged) {
    element.dataset.assetId = plan.assetId;
    element.src = assetUrl(projectId, plan.assetId);
    element.load();
  }

  element.muted = muted;
  element.volume = plan.volume;
  element.playbackRate = plan.playbackRate;

  if (audioReachedSourceEnd(plan)) {
    if (!element.paused) {
      element.pause();
    }

    return false;
  }

  if (!sourceChanged) {
    const drift = Math.abs(element.currentTime - plan.sourceSeconds);

    if (!playing || drift > DRIFT_THRESHOLD_SECONDS) {
      try {
        element.currentTime = plan.sourceSeconds;
      } catch {
        // 元数据尚未就绪时设置 currentTime 会被忽略，onLoadedMetadata 会再次对齐。
      }
    }
  }

  if (playing) {
    if (element.paused) {
      void element.play().catch(() => {
        // 自动播放/解码失败由 onError 呈现为占位说明。
      });
    }
  } else if (!element.paused) {
    element.pause();
  }

  return sourceChanged;
}

export function PreviewStage({
  currentTime,
  musicTrackActive,
  muted,
  plan,
  playing,
  projectId,
  stageRef,
  voiceTrackActive,
}: PreviewStageProps) {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [slots, setSlots] = useState<VideoSlotsState>(createVideoSlots);
  const [audioError, setAudioError] = useState<string | null>(null);
  const videoRefs: Record<VideoSlotKey, RefObject<HTMLVideoElement | null>> = {
    a: videoARef,
    b: videoBRef,
  };

  const activeDemand: VideoSlotDemand | null =
    plan.video?.mediaType === 'video'
      ? { assetId: plan.video.assetId, clipId: plan.video.clipId }
      : null;
  const nextDemand: VideoSlotDemand | null =
    plan.nextVideo?.mediaType === 'video'
      ? { assetId: plan.nextVideo.assetId, clipId: plan.nextVideo.clipId }
      : null;
  const demandRef = useRef({ active: activeDemand, next: nextDemand });
  const planRef = useRef(plan);
  const playingRef = useRef(playing);

  demandRef.current = { active: activeDemand, next: nextDemand };
  planRef.current = plan;
  playingRef.current = playing;

  const activeClipId = activeDemand?.clipId ?? null;
  const activeAssetId = activeDemand?.assetId ?? null;
  const nextClipId = nextDemand?.clipId ?? null;
  const nextAssetId = nextDemand?.assetId ?? null;

  useEffect(() => {
    setSlots((previous) =>
      syncVideoSlots(previous, demandRef.current.active, demandRef.current.next),
    );
  }, [activeAssetId, activeClipId, nextAssetId, nextClipId]);

  useEffect(() => {
    applySlotSource(videoARef.current, slots.slots.a, projectId);
    applySlotSource(videoBRef.current, slots.slots.b, projectId);
  }, [projectId, slots]);

  useEffect(() => {
    const videoPlan = plan.video?.mediaType === 'video' ? plan.video : null;
    const nextPlan = plan.nextVideo?.mediaType === 'video' ? plan.nextVideo : null;

    for (const key of VIDEO_SLOT_REFS) {
      const element = videoRefs[key].current;

      if (!element) {
        continue;
      }

      const slot = slots.slots[key];
      const isActive =
        slots.active === key && videoPlan !== null && slot.assetId === videoPlan.assetId;

      if (!isActive || !slot.ready) {
        // 预加载槽位先停在下一片段的 source 起点，切镜时无需再 seek。
        if (!isActive && slot.ready && nextPlan && slot.assetId === nextPlan.assetId) {
          element.playbackRate = nextPlan.playbackRate;

          if (Math.abs(element.currentTime - nextPlan.sourceSeconds) > DRIFT_THRESHOLD_SECONDS) {
            try {
              element.currentTime = nextPlan.sourceSeconds;
            } catch {
              // 元数据未就绪时忽略，loadeddata 后还会再次校正。
            }
          }
        }

        if (!element.paused) {
          element.pause();
        }

        continue;
      }

      element.playbackRate = videoPlan.playbackRate;
      const drift = Math.abs(element.currentTime - videoPlan.sourceSeconds);

      if (!playing || drift > DRIFT_THRESHOLD_SECONDS) {
        try {
          element.currentTime = videoPlan.sourceSeconds;
        } catch {
          // 与音频相同：等 loadeddata 后再由播放循环校正。
        }
      }

      if (playing) {
        if (element.paused) {
          void element.play().catch(() => {
            // 解码失败由 onError 呈现。
          });
        }
      } else if (!element.paused) {
        element.pause();
      }
    }
  }, [plan, playing, slots]);

  useEffect(() => {
    const voiceChanged = syncAudioElement(voiceRef.current, plan.voice, projectId, muted, playing);
    const musicChanged = syncAudioElement(musicRef.current, plan.music, projectId, muted, playing);

    if (voiceChanged || musicChanged) {
      setAudioError(null);
    }
  }, [muted, plan, playing, projectId]);

  const handleVideoReady = (key: VideoSlotKey) => {
    setSlots((previous) =>
      syncVideoSlots(
        markSlotReady(previous, key),
        demandRef.current.active,
        demandRef.current.next,
      ),
    );
  };

  const handleVideoError = (key: VideoSlotKey, element: HTMLVideoElement | null) => {
    const message = describeMediaElementError(element?.error);

    setSlots((previous) =>
      syncVideoSlots(
        markSlotFailed(previous, key, message),
        demandRef.current.active,
        demandRef.current.next,
      ),
    );
  };

  const syncAudioMetadata = (element: HTMLAudioElement, audioPlan: PreviewAudioPlan | null) => {
    if (!audioPlan) {
      return;
    }

    try {
      element.currentTime = audioPlan.sourceSeconds;
    } catch {
      return;
    }

    element.playbackRate = audioPlan.playbackRate;

    if (playingRef.current && !audioReachedSourceEnd(audioPlan)) {
      void element.play().catch(() => {
        // 解码失败由 onError 呈现。
      });
    }
  };

  const handleMusicEnded = (element: HTMLAudioElement) => {
    const musicPlan = planRef.current.music;

    if (!musicPlan || !musicPlan.loop || element.dataset.assetId !== musicPlan.assetId) {
      element.pause();
      return;
    }

    try {
      element.currentTime = musicPlan.sourceSeconds;
    } catch {
      return;
    }

    if (playingRef.current) {
      void element.play().catch(() => {
        // 循环失败时保持暂停，状态仍由主时钟控制。
      });
    }
  };

  const visible = visibleSlot(slots);
  const activeSlot = slots.active ? slots.slots[slots.active] : null;
  const activeError = activeSlot?.error ?? null;
  const videoPlan = plan.video?.mediaType === 'video' ? plan.video : null;
  const imagePlan = plan.video?.mediaType === 'image' ? plan.video : null;
  const loading = !plan.videoIssue && !activeError && videoPlan !== null && visible === null;
  const empty = plan.video === null && plan.videoIssue === null;

  return (
    <div
      aria-label={
        plan.videoIssue?.message ??
        (plan.video ? `视频预览：${formatTime(currentTime)}` : '视频预览：空白区域')
      }
      className={`ed-preview${empty ? ' ed-preview--empty' : ''}`}
      ref={stageRef}
      role="img"
    >
      {VIDEO_SLOT_REFS.map((key) => (
        <video
          key={key}
          ref={videoRefs[key]}
          aria-hidden="true"
          className={`ed-preview-video${visible === key ? ' is-visible' : ''}`}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          onError={() => handleVideoError(key, videoRefs[key].current)}
          onLoadedData={() => handleVideoReady(key)}
        />
      ))}

      {imagePlan ? (
        <img alt="" className="ed-preview-image" src={assetUrl(projectId, imagePlan.assetId)} />
      ) : null}

      {plan.videoIssue ? (
        <div className="ed-preview-placeholder" role="img" aria-label={plan.videoIssue.message}>
          <span className="ed-preview-placeholder-title">画面无法预览</span>
          <p className="ed-preview-placeholder-text">{plan.videoIssue.message}</p>
        </div>
      ) : null}

      {activeError ? (
        <div className="ed-preview-placeholder" role="img" aria-label={activeError}>
          <span className="ed-preview-placeholder-title">播放失败</span>
          <p className="ed-preview-placeholder-text">{activeError}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="ed-preview-loading" role="status">
          正在加载画面…
        </div>
      ) : null}

      {plan.voice?.isMock ? <span className="ed-preview-mock">模拟配音</span> : null}

      {plan.audioIssues.length > 0 || audioError ? (
        <div className="ed-preview-media-issues">
          {plan.audioIssues.map((issue) => (
            <span key={`${issue.kind}-${issue.assetId}`} className="ed-preview-issue">
              {issue.message}
            </span>
          ))}
          {audioError ? <span className="ed-preview-issue">{audioError}</span> : null}
        </div>
      ) : null}

      {voiceTrackActive ? (
        <audio
          ref={voiceRef}
          className="ed-preview-audio"
          preload="auto"
          onError={() => setAudioError(describeMediaElementError(voiceRef.current?.error))}
          onLoadedMetadata={() => {
            if (voiceRef.current) {
              syncAudioMetadata(voiceRef.current, planRef.current.voice);
            }
          }}
        />
      ) : null}

      {musicTrackActive ? (
        <audio
          ref={musicRef}
          className="ed-preview-audio"
          preload="auto"
          onEnded={() => {
            if (musicRef.current) {
              handleMusicEnded(musicRef.current);
            }
          }}
          onError={() => setAudioError(describeMediaElementError(musicRef.current?.error))}
          onLoadedMetadata={() => {
            if (musicRef.current) {
              syncAudioMetadata(musicRef.current, planRef.current.music);
            }
          }}
        />
      ) : null}
    </div>
  );
}
