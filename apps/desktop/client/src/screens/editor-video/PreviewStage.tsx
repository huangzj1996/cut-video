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
import { needsDriftCorrection } from './playback';
import {
  audioReachedSourceEnd,
  describeMediaElementError,
  type PreviewAudioPlan,
  type PreviewMediaPlan,
  type PreviewVideoPlan,
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
  hasMusicTrack: boolean;
  hasVoiceTrack: boolean;
  muted: boolean;
  plan: PreviewMediaPlan;
  playing: boolean;
  projectId: string;
  stageRef: RefObject<HTMLDivElement | null>;
}

function videoPlanOf(plan: PreviewVideoPlan | null): PreviewVideoPlan | null {
  return plan?.mediaType === 'video' ? plan : null;
}

function demandOf(plan: PreviewVideoPlan | null): VideoSlotDemand | null {
  return plan ? { assetId: plan.assetId, clipId: plan.clipId } : null;
}

/** 元数据尚未就绪时设置 currentTime 会被忽略，返回 false 让调用方等待 loadedmetadata。 */
function seekMediaElement(element: HTMLMediaElement, seconds: number): boolean {
  try {
    element.currentTime = seconds;
    return true;
  } catch {
    return false;
  }
}

function pauseMediaElement(element: HTMLMediaElement): void {
  if (!element.paused) {
    element.pause();
  }
}

function syncMediaPlayState(element: HTMLMediaElement, playing: boolean): void {
  if (!playing) {
    pauseMediaElement(element);
    return;
  }

  if (element.paused) {
    void element.play().catch(() => {
      // 自动播放/解码失败由 onError 呈现为占位说明。
    });
  }
}

/** 暂停或偏差超过阈值时对齐到主时钟，然后同步播放状态。 */
function alignMediaElement(
  element: HTMLMediaElement,
  sourceSeconds: number,
  playing: boolean,
): void {
  if (!playing || needsDriftCorrection(sourceSeconds, element.currentTime)) {
    seekMediaElement(element, sourceSeconds);
  }

  syncMediaPlayState(element, playing);
}

function loadMediaSource(element: HTMLMediaElement, assetId: string, projectId: string): void {
  element.dataset.assetId = assetId;
  element.src = assetUrl(projectId, assetId);
  element.load();
}

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

  if (element.dataset.assetId !== slot.assetId) {
    loadMediaSource(element, slot.assetId, projectId);
  }
}

/** 对齐并播放音频元素；返回值表示 source 是否刚被重新加载（用于清掉旧错误）。 */
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
    pauseMediaElement(element);
    return false;
  }

  const sourceChanged = element.dataset.assetId !== plan.assetId;

  if (sourceChanged) {
    loadMediaSource(element, plan.assetId, projectId);
  }

  element.muted = muted;
  element.volume = plan.volume;
  element.playbackRate = plan.playbackRate;

  if (audioReachedSourceEnd(plan)) {
    pauseMediaElement(element);
    return false;
  }

  if (sourceChanged) {
    syncMediaPlayState(element, playing);
  } else {
    alignMediaElement(element, plan.sourceSeconds, playing);
  }

  return sourceChanged;
}

export function PreviewStage({
  currentTime,
  hasMusicTrack,
  hasVoiceTrack,
  muted,
  plan,
  playing,
  projectId,
  stageRef,
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

  const videoPlan = videoPlanOf(plan.video);
  const nextVideoPlan = videoPlanOf(plan.nextVideo);
  const activeDemand = demandOf(videoPlan);
  const nextDemand = demandOf(nextVideoPlan);
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
    for (const key of VIDEO_SLOT_KEYS) {
      const element = videoRefs[key].current;

      if (!element) {
        continue;
      }

      const slot = slots.slots[key];
      const isActive =
        slots.active === key && videoPlan !== null && slot.assetId === videoPlan.assetId;

      if (isActive && slot.ready) {
        element.playbackRate = videoPlan.playbackRate;
        alignMediaElement(element, videoPlan.sourceSeconds, playing);
        continue;
      }

      // 预加载槽位先停在下一片段的 source 起点，切镜时无需再 seek。
      if (slot.ready && nextVideoPlan && slot.assetId === nextVideoPlan.assetId) {
        element.playbackRate = nextVideoPlan.playbackRate;

        if (needsDriftCorrection(nextVideoPlan.sourceSeconds, element.currentTime)) {
          seekMediaElement(element, nextVideoPlan.sourceSeconds);
        }
      }

      pauseMediaElement(element);
    }
  }, [plan, playing, slots]);

  useEffect(() => {
    const voiceReloaded = syncAudioElement(voiceRef.current, plan.voice, projectId, muted, playing);
    const musicReloaded = syncAudioElement(musicRef.current, plan.music, projectId, muted, playing);

    if (voiceReloaded || musicReloaded) {
      setAudioError(null);
    }
  }, [muted, plan, playing, projectId]);

  const updateSlots = (update: (previous: VideoSlotsState) => VideoSlotsState) => {
    setSlots((previous) =>
      syncVideoSlots(update(previous), demandRef.current.active, demandRef.current.next),
    );
  };

  const handleVideoReady = (key: VideoSlotKey) => {
    updateSlots((previous) => markSlotReady(previous, key));
  };

  const handleVideoError = (key: VideoSlotKey) => {
    const message = describeMediaElementError(videoRefs[key].current?.error);

    updateSlots((previous) => markSlotFailed(previous, key, message));
  };

  const syncAudioMetadata = (
    element: HTMLAudioElement | null,
    audioPlan: PreviewAudioPlan | null,
  ) => {
    if (!element || !audioPlan || !seekMediaElement(element, audioPlan.sourceSeconds)) {
      return;
    }

    element.playbackRate = audioPlan.playbackRate;

    if (playingRef.current && !audioReachedSourceEnd(audioPlan)) {
      void element.play().catch(() => {
        // 解码失败由 onError 呈现。
      });
    }
  };

  const handleMusicEnded = (element: HTMLAudioElement | null) => {
    if (!element) {
      return;
    }

    const musicPlan = planRef.current.music;

    if (!musicPlan || !musicPlan.loop || element.dataset.assetId !== musicPlan.assetId) {
      pauseMediaElement(element);
      return;
    }

    if (!seekMediaElement(element, musicPlan.sourceSeconds)) {
      return;
    }

    if (playingRef.current) {
      void element.play().catch(() => {
        // 循环失败时保持暂停，状态仍由主时钟控制。
      });
    }
  };

  const visibleKey = visibleSlot(slots);
  const activeSlot = slots.active ? slots.slots[slots.active] : null;
  const activeError = activeSlot?.error ?? null;
  const imagePlan = plan.video?.mediaType === 'image' ? plan.video : null;
  const loading = !plan.videoIssue && !activeError && videoPlan !== null && visibleKey === null;
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
      {VIDEO_SLOT_KEYS.map((key) => (
        <video
          key={key}
          ref={videoRefs[key]}
          aria-hidden="true"
          className={`ed-preview-video${visibleKey === key ? ' is-visible' : ''}`}
          muted
          playsInline
          preload="auto"
          tabIndex={-1}
          onError={() => handleVideoError(key)}
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

      {hasVoiceTrack ? (
        <audio
          ref={voiceRef}
          className="ed-preview-audio"
          preload="auto"
          onError={() => setAudioError(describeMediaElementError(voiceRef.current?.error))}
          onLoadedMetadata={() => syncAudioMetadata(voiceRef.current, planRef.current.voice)}
        />
      ) : null}

      {hasMusicTrack ? (
        <audio
          ref={musicRef}
          className="ed-preview-audio"
          preload="auto"
          onEnded={() => handleMusicEnded(musicRef.current)}
          onError={() => setAudioError(describeMediaElementError(musicRef.current?.error))}
          onLoadedMetadata={() => syncAudioMetadata(musicRef.current, planRef.current.music)}
        />
      ) : null}
    </div>
  );
}
