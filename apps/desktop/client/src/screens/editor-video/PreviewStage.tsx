/**
 * 真实预览舞台：双 `<video>` 交换 + 配音/音乐 `<audio>`。
 *
 * 播放位置由父层的 rAF 主时钟提供；这里只负责把三类媒体对齐到同一时间点，
 * 并在漂移超过 50ms 时校正。下一片段提前预加载到另一个 video 槽位，
 * 因此正常切镜时不需要等待加载，也不会出现长时间黑屏。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { assetUrl } from '../../lib/media';
import {
  alignMediaElement,
  applySlotSource,
  handleMusicEnded,
  pauseMediaElement,
  seekMediaElement,
  syncAudioElement,
  syncAudioMetadata,
} from './media-sync';
import { needsDriftCorrection } from './playback';
import {
  describeMediaElementError,
  type PreviewMediaPlan,
  type PreviewVideoPlan,
} from './preview-media';
import type { SubtitleOverlay } from './subtitle-overlay';
import { formatTime } from './timeline';
import {
  createVideoSlots,
  markSlotFailed,
  markSlotReady,
  syncVideoSlots,
  VIDEO_SLOT_KEYS,
  visibleSlot,
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
  subtitle: SubtitleOverlay | null;
}

function videoPlanOf(plan: PreviewVideoPlan | null): PreviewVideoPlan | null {
  return plan?.mediaType === 'video' ? plan : null;
}

function demandOf(plan: PreviewVideoPlan | null): VideoSlotDemand | null {
  return plan ? { assetId: plan.assetId, clipId: plan.clipId } : null;
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
  subtitle,
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
    applySlotSource(videoARef.current, slots.slots.a.assetId, projectId);
    applySlotSource(videoBRef.current, slots.slots.b.assetId, projectId);
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

      {subtitle ? (
        <div className="ed-preview-subtitles">
          <p
            className="ed-preview-subtitle"
            data-preset={subtitle.presetId}
            style={
              {
                '--ed-subtitle-color': subtitle.color,
                '--ed-subtitle-font-size': subtitle.fontSizeCss,
                '--ed-subtitle-outline': subtitle.outline,
              } as CSSProperties
            }
          >
            {subtitle.text}
          </p>
        </div>
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
          onLoadedMetadata={() =>
            syncAudioMetadata(voiceRef.current, planRef.current.voice, playingRef.current)
          }
        />
      ) : null}

      {hasMusicTrack ? (
        <audio
          ref={musicRef}
          className="ed-preview-audio"
          preload="auto"
          onEnded={() =>
            handleMusicEnded(musicRef.current, planRef.current.music, playingRef.current)
          }
          onError={() => setAudioError(describeMediaElementError(musicRef.current?.error))}
          onLoadedMetadata={() =>
            syncAudioMetadata(musicRef.current, planRef.current.music, playingRef.current)
          }
        />
      ) : null}
    </div>
  );
}
