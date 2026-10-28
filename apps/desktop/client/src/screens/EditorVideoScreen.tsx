/**
 * 项目级编辑器。左侧分镜、工程名、四轨时间线都来自最新 `project.json`；
 * 媒体通过受限 `asset://` 协议加载，预览由主时钟同步播放视频、配音和音乐。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type { VideoProject } from '@miaoma/video-project';
import { assetUrl } from '../lib/media';
import { createChatHash } from '../lib/routes';
import { EditorEmpty, EditorLoading, EditorUnavailable } from './editor-video/EditorStates';
import {
  loadEditorProject,
  type EditorLoadResult,
  type EditorProjectView,
} from './editor-video/project-view';
import { parseTimecode } from './editor-video/playback';
import { PreviewStage } from './editor-video/PreviewStage';
import { buildPreviewMediaPlan } from './editor-video/preview-media';
import { createSelection, selectionReducer } from './editor-video/selection';
import {
  buildEditorTimeline,
  sliderFromZoom,
  zoomFromSlider,
  type EditorTrackKind,
  type EditorTrackView,
  type TimelineTrackClip,
} from './editor-video/timeline-geometry';
import { clampTime, clientXToTime, formatTime, secondsToPercent } from './editor-video/timeline';
import { usePlaybackClock } from './editor-video/usePlaybackClock';
import { EditorIcon, type EditorIconName } from './editor-icons';
import { MusicPanel } from './panels/MusicPanel';
import { SubtitlePanel } from './panels/SubtitlePanel';
import { VoicePanel } from './panels/VoicePanel';
import './editor-video.css';

interface VideoTone {
  accent: string;
  background: string;
  border: string;
}

const VIDEO_TONES: readonly VideoTone[] = [
  { accent: '#25d0b1', background: '#1f6158', border: '#25d0b1' },
  { accent: '#5b8cff', background: '#294673', border: 'rgba(255,255,255,0.125)' },
  { accent: '#8b6af7', background: '#503984', border: 'rgba(255,255,255,0.125)' },
  { accent: '#f05f73', background: '#74313e', border: 'rgba(255,255,255,0.125)' },
  { accent: '#7e848e', background: '#3d3f45', border: 'rgba(255,255,255,0.125)' },
];

function videoTone(index: number): VideoTone {
  return VIDEO_TONES[index % VIDEO_TONES.length]!;
}

const TRACK_ICONS: Record<EditorTrackKind, EditorIconName> = {
  music: 'music',
  subtitle: 'subtitle-track',
  video: 'video-track',
  voice: 'mic-track',
};

const ANALYSIS_TEXT = `我来分析你的文稿，这是一份关于“前端AI进阶学习路线”的教学内容，时间线清晰、结构完整。让我先加载制片技能来完成方案设计。

我已经加载了制片技能。现在分析你的文稿：

这是一份完整的技术教学口播稿，主题聚焦“前端AI进阶学习路线”，包含4个时间段的内容：

•  开场问题引入（0:00-0:25）
•  为什么不能直接学AI（0:25-0:55）
•  三个月学习路线详解（0:55-2:45）
•  收尾总结（2:45-3:05）`;

type EditorRailId = 'video' | 'voice' | 'subtitle' | 'music';

type RailItem = {
  id: EditorRailId;
  label: string;
  icon: EditorIconName;
};

const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'video', label: '画面', icon: 'image' },
  { id: 'voice', label: '口播', icon: 'mic' },
  { id: 'subtitle', label: '字幕', icon: 'subtitles' },
  { id: 'music', label: '音乐', icon: 'music' },
];

type TimelineToolId = 'snap' | 'link' | 'wave';

const TIMELINE_TOOLS: readonly { id: TimelineToolId; label: string; icon: EditorIconName }[] = [
  { id: 'snap', label: '吸附', icon: 'magnet' },
  { id: 'link', label: '联动', icon: 'link' },
  { id: 'wave', label: '波形', icon: 'wave' },
];

/**
 * 波形区域先占位，不伪造峰值；真实峰值在后续切片接入。
 */
function WaveformPlaceholder() {
  return (
    <span aria-label="波形待接入" className="ed-wave-placeholder" role="img">
      波形待接入
    </span>
  );
}

type EditorScreenState = EditorLoadResult | { kind: 'loading' };

/**
 * 项目级编辑器入口：每次进入都按 projectId 重新读取最新 `project.json`。
 * 草稿工程回创作消息页；读取失败或损坏工程停在错误页，可返回工作台。
 */
export function EditorVideoScreen({ projectId }: { projectId: string }) {
  const [state, setState] = useState<EditorScreenState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    const reader = window.miaoma?.project;

    if (!reader) {
      setState({
        code: 'IPC_UNAVAILABLE',
        kind: 'error',
        message: 'Preload 桥接未加载，无法打开工程。',
      });
      return;
    }

    void loadEditorProject(reader, projectId).then((result) => {
      if (!cancelled) {
        setState(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (state.kind === 'draft') {
      window.location.hash = createChatHash(state.projectId);
    }
  }, [state]);

  if (state.kind === 'loading') {
    return <EditorLoading />;
  }

  if (state.kind === 'draft') {
    return <EditorLoading message="草稿工程会被送回创作消息页。" title="正在返回创作消息页" />;
  }

  if (state.kind === 'error') {
    return <EditorUnavailable message={state.message} />;
  }

  if (state.view.sceneCount === 0) {
    return <EditorEmpty message="这个工程还没有分镜，请回到创作消息页生成内容。" />;
  }

  return <EditorWorkspace key={state.view.projectId} project={state.project} view={state.view} />;
}

function EditorWorkspace({ project, view }: { project: VideoProject; view: EditorProjectView }) {
  const timeline = useMemo(() => buildEditorTimeline(project), [project]);
  const spanSeconds = timeline.durationSeconds > 0 ? timeline.durationSeconds : 1;
  const { currentTime, pause, playing, seek, toggle } = usePlaybackClock(timeline.durationSeconds);
  const [selection, dispatch] = useReducer(
    selectionReducer,
    view.scenes[0]?.id ?? null,
    (sceneId) => createSelection(sceneId),
  );
  const [activeRail, setActiveRail] = useState<EditorRailId>('video');
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [timecodeEditing, setTimecodeEditing] = useState(false);
  const [timecodeDraft, setTimecodeDraft] = useState('');
  const [contextOpen, setContextOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [zoom, setZoom] = useState(1);
  const [tools, setTools] = useState<Record<TimelineToolId, boolean>>({
    snap: true,
    link: false,
    wave: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerTrackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const selectedScene = view.scenes.find((scene) => scene.id === selection.sceneId);
  const selectedName = selectedScene?.title ?? '未选择分镜';
  const selectedRange = selectedScene?.rangeLabel ?? '—';
  const playheadRatio = Math.min(1, Math.max(0, currentTime / spanSeconds));
  const previewPlan = useMemo(
    () => buildPreviewMediaPlan(project, currentTime),
    [currentTime, project],
  );
  const voiceTrackActive = useMemo(
    () => project.tracks.some((track) => track.kind === 'voice' && track.clips.length > 0),
    [project],
  );
  const musicTrackActive = useMemo(
    () => project.tracks.some((track) => track.kind === 'music' && track.clips.length > 0),
    [project],
  );

  const notify = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number, offsetSeconds: number) => {
      const rect = rulerTrackRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const time = clientXToTime(clientX, rect, spanSeconds) + offsetSeconds;

      seek(clampTime(time, spanSeconds));
    },
    [seek, spanSeconds],
  );

  const endScrub = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && activePointerIdRef.current !== event.pointerId) {
      return;
    }

    activePointerIdRef.current = null;
    grabOffsetRef.current = 0;
    setIsScrubbing(false);
  }, []);

  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    const target = event.target as Element;

    if (target.closest('.ed-ruler-label, .ed-track-label')) {
      return;
    }

    event.preventDefault();
    pause();
    rulerTrackRef.current?.focus({ preventScroll: true });

    if (activePointerIdRef.current !== null) {
      endScrub();
    }

    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsScrubbing(true);

    if (target.closest('.ed-playhead')) {
      const rect = rulerTrackRef.current?.getBoundingClientRect();
      const pointerTime = rect ? clientXToTime(event.clientX, rect, spanSeconds) : 0;

      grabOffsetRef.current = currentTime - pointerTime;
      return;
    }

    grabOffsetRef.current = 0;
    seekFromClientX(event.clientX, 0);
  };

  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    if ((event.buttons & 1) === 0) {
      endScrub(event);
      return;
    }

    seekFromClientX(event.clientX, grabOffsetRef.current);
  };

  const handleSeekKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextTime: number;

    switch (event.key) {
      case 'ArrowLeft':
        nextTime = currentTime - 1;
        break;
      case 'ArrowRight':
        nextTime = currentTime + 1;
        break;
      case 'PageDown':
        nextTime = currentTime - 10;
        break;
      case 'PageUp':
        nextTime = currentTime + 10;
        break;
      case 'Home':
        nextTime = 0;
        break;
      case 'End':
        nextTime = spanSeconds;
        break;
      default:
        return;
    }

    event.preventDefault();
    pause();
    seek(clampTime(nextTime, spanSeconds));
  };

  const scrollToBottom = () => {
    const node = scrollRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  };

  const sendDraft = () => {
    const text = draft.trim();

    if (!text) {
      notify('请输入你的想法。');
      return;
    }

    setDraft('');
    notify(`已记录「${text}」；模型执行将在 T20 接入。`);
  };

  const toggleTimelineTool = (id: TimelineToolId, label: string) => {
    const next = !tools[id];

    setTools((previous) => ({ ...previous, [id]: next }));
    notify(`${label}已${next ? '开启' : '关闭'}；时间线交互将在 T17 接入。`);
  };

  const selectClip = (clip: TimelineTrackClip) => {
    dispatch({
      clipId: clip.id,
      kind: clip.kind,
      ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
      type: 'select-clip',
    });
  };

  const isClipSelected = (clip: TimelineTrackClip) =>
    selection.clip?.id === clip.id && selection.clip.kind === clip.kind;

  const selectScene = (sceneId: string, startSeconds: number) => {
    pause();
    seek(clampTime(startSeconds, spanSeconds));
    dispatch({ sceneId, type: 'select-scene' });
  };

  const beginTimecodeEdit = () => {
    setTimecodeDraft(formatTime(currentTime));
    setTimecodeEditing(true);
  };

  const commitTimecode = () => {
    const seconds = parseTimecode(timecodeDraft);

    if (seconds === null) {
      notify('时间码格式无效，请使用 HH:MM:SS。');
    } else {
      pause();
      seek(clampTime(seconds, spanSeconds));
    }

    setTimecodeEditing(false);
  };

  const toggleFullscreen = () => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    if (document.fullscreenElement === stage) {
      void document.exitFullscreen();
      return;
    }

    void stage.requestFullscreen().catch(() => {
      notify('当前环境不支持全屏预览。');
    });
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const clipStyle = (clip: TimelineTrackClip) => ({
    left: `${secondsToPercent(clip.startSeconds, spanSeconds)}%`,
    width: `${secondsToPercent(clip.endSeconds - clip.startSeconds, spanSeconds)}%`,
  });

  const clipPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // 片段点击只负责选中，不触发轨道空白处的 seek / 拖动播放头。
    event.stopPropagation();
  };

  const renderTrackClip = (track: EditorTrackView, clip: TimelineTrackClip, index: number) => {
    const selected = isClipSelected(clip);
    const activeClass = selected ? ' is-active' : '';
    const shared = {
      'aria-pressed': selected,
      onClick: () => selectClip(clip),
      onPointerDown: clipPointerDown,
      style: clipStyle(clip),
      type: 'button' as const,
    };

    if (track.kind === 'video') {
      const tone = videoTone(index);

      return (
        <button
          key={clip.id}
          {...shared}
          className={`ed-timeline-clip ed-video-bar${activeClass}`}
          style={{ ...shared.style, background: tone.background, borderColor: tone.border }}
          title={clip.label}
        >
          <span className="ed-bar-accent" style={{ background: tone.accent }} />
          <span className="ed-video-name">{clip.label}</span>
          {clip.thumbnailIds?.length ? (
            <span className="ed-thumbs" aria-hidden="true">
              {clip.thumbnailIds.slice(0, 4).map((thumbnailId) => (
                <img
                  key={thumbnailId}
                  alt=""
                  className="ed-thumb"
                  loading="lazy"
                  src={assetUrl(view.projectId, thumbnailId)}
                />
              ))}
            </span>
          ) : (
            <span className="ed-thumb-fallback" aria-hidden="true" />
          )}
        </button>
      );
    }

    if (track.kind === 'voice') {
      return (
        <button
          key={clip.id}
          {...shared}
          className={`ed-timeline-clip ed-voice-bar${activeClass}`}
          title={clip.label}
        >
          <span className="ed-voice-name">{clip.label}</span>
          {clip.badge ? <span className="ed-clip-badge">{clip.badge}</span> : null}
          <WaveformPlaceholder />
        </button>
      );
    }

    if (track.kind === 'subtitle') {
      return (
        <button
          key={clip.id}
          {...shared}
          className={`ed-timeline-clip ed-subtitle-bar${activeClass}`}
          title={clip.text ?? clip.label}
        >
          <EditorIcon name="subtitles" size={16} />
          <span className="ed-subtitle-text">{clip.text ?? clip.label}</span>
        </button>
      );
    }

    return (
      <button
        key={clip.id}
        {...shared}
        className={`ed-timeline-clip ed-tl-music-bar${activeClass}`}
        title={clip.label}
      >
        <span className="ed-bar-accent" style={{ background: 'var(--ed-blue)' }} />
        <EditorIcon name="music" size={15} />
        <span className="ed-tl-music-name">{clip.label}</span>
        {clip.artist ? <span className="ed-tl-music-artist">{clip.artist}</span> : null}
        <WaveformPlaceholder />
      </button>
    );
  };

  const renderTrackClips = (track: EditorTrackView) => {
    if (track.clips.length === 0) {
      return track.kind === 'music' ? (
        <div className="ed-track-empty">{track.countLabel}</div>
      ) : null;
    }

    return track.clips.map((clip, index) => renderTrackClip(track, clip, index));
  };

  return (
    <div className="editor-screen">
      <header className="ed-topbar">
        <button
          className="ed-brand"
          type="button"
          title="返回工程状态"
          onClick={() => {
            window.location.hash = '#/status';
          }}
        >
          <span className="ed-brand-mark" aria-hidden="true">
            剪
          </span>
          <span className="ed-brand-copy">
            <strong>妙剪 Magicut</strong>
            <small>智能视频剪辑工具</small>
          </span>
        </button>

        <div className="ed-project">
          <div className="ed-project-title" title={view.name}>
            {view.name}
          </div>
          <div className="ed-project-meta">{view.updatedLabel}</div>
        </div>

        <div className="ed-topbar-actions">
          <button
            className="ed-export"
            type="button"
            onClick={() => notify('渲染导出将在 T19 实现。')}
          >
            <EditorIcon name="export" size={15} />
            渲染导出
          </button>
        </div>
      </header>

      <div className="ed-main">
        <aside className="ed-left" aria-label="文稿字幕">
          <div className="ed-left-head">
            <h1>文稿字幕</h1>
            <p>
              {view.sceneCount} 段分镜 · {view.totalDurationLabel} · 当前 {selectedRange}
            </p>
          </div>

          <div className="ed-clip-list">
            {view.scenes.map((scene) => {
              const active = scene.id === selection.sceneId;

              return (
                <button
                  key={scene.id}
                  className={`ed-clip${active ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectScene(scene.id, scene.startSeconds)}
                >
                  <span className="ed-clip-top">
                    <span className="ed-clip-name">
                      {scene.title}
                      {active ? <span className="ed-clip-current">当前</span> : null}
                    </span>
                    <span className="ed-clip-range">{scene.rangeLabel}</span>
                  </span>
                  <span className="ed-clip-text">{scene.text}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="ed-center" aria-label="视频预览">
          <PreviewStage
            currentTime={currentTime}
            musicTrackActive={musicTrackActive}
            muted={muted}
            plan={previewPlan}
            playing={playing}
            projectId={view.projectId}
            stageRef={stageRef}
            voiceTrackActive={voiceTrackActive}
          />
          <div className="ed-preview-bar">
            {timecodeEditing ? (
              <input
                autoFocus
                aria-label="跳转时间码"
                className="ed-preview-time-input"
                onBlur={commitTimecode}
                onChange={(event) => setTimecodeDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitTimecode();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setTimecodeEditing(false);
                  }
                }}
                value={timecodeDraft}
              />
            ) : (
              <button
                aria-label={`当前时间 ${formatTime(currentTime)}，点击输入时间码`}
                className="ed-preview-time"
                onClick={beginTimecodeEdit}
                type="button"
              >
                {formatTime(currentTime)} <span>/ {formatTime(spanSeconds)}</span>
              </button>
            )}

            <button
              className="ed-play"
              type="button"
              aria-label={playing ? '暂停' : '播放'}
              aria-pressed={playing}
              onClick={toggle}
            >
              <EditorIcon name={playing ? 'pause' : 'play'} size={24} />
            </button>

            <div className="ed-preview-tools">
              <button
                className={`ed-preview-tool${muted ? ' is-active' : ''}`}
                type="button"
                aria-label={muted ? '取消静音' : '静音'}
                aria-pressed={muted}
                onClick={() => setMuted((value) => !value)}
              >
                <EditorIcon name={muted ? 'volume-off' : 'volume'} size={18} />
              </button>
              <button
                className={`ed-preview-tool${fullscreen ? ' is-active' : ''}`}
                type="button"
                aria-label={fullscreen ? '退出全屏' : '全屏预览'}
                aria-pressed={fullscreen}
                onClick={toggleFullscreen}
              >
                <EditorIcon name="expand" size={18} />
              </button>
            </div>
          </div>
        </section>

        <aside
          className="ed-right"
          aria-label={
            activeRail === 'video'
              ? '画面调整'
              : activeRail === 'voice'
                ? '口播设置'
                : activeRail === 'subtitle'
                  ? '字幕设置'
                  : '音乐设置'
          }
        >
          {activeRail === 'video' ? (
            <>
              <div className="ed-right-date">6月10日 17:42</div>

              <div className="ed-right-scroll-wrap">
                <div className="ed-right-scroll" ref={scrollRef}>
                  <div className="ed-context">
                    <div className="ed-context-head">
                      <span className="ed-context-title">0:00-0:25 开场问题</span>
                      <button
                        className="ed-context-toggle"
                        type="button"
                        aria-expanded={contextOpen}
                        aria-label={contextOpen ? '收起上下文' : '展开上下文'}
                        onClick={() => setContextOpen((value) => !value)}
                      >
                        <EditorIcon name="chevron-down" size={17} />
                      </button>
                    </div>

                    {contextOpen ? (
                      <>
                        <p className="ed-context-summary">
                          {
                            '大家好，很多前端同学现在都在焦虑一件事：\nAI到底应该怎么学。我先问一下大家，如果...'
                          }
                        </p>
                        <div className="ed-context-divider" />
                        <div className="ed-context-tags">
                          <div className="ed-tag-row">
                            <span className="ed-tag ed-tag-label">视频画面</span>
                            <span className="ed-tag ed-tag-value">智能匹配素材</span>
                          </div>
                          <div className="ed-tag-row">
                            <span className="ed-tag ed-tag-label">旁白配音</span>
                            <span className="ed-tag ed-tag-value">温婉学姐</span>
                          </div>
                          <div className="ed-tag-row">
                            <span className="ed-tag ed-tag-label">创作倾向</span>
                            <span className="ed-tag ed-tag-value">AI智能创作（默认）</span>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  <p className="ed-analysis">{ANALYSIS_TEXT}</p>
                </div>

                <div className="ed-scroll-bottom-bar">
                  <button className="ed-scroll-bottom" type="button" onClick={scrollToBottom}>
                    <EditorIcon name="arrow-down" size={15} />
                    回到底部
                  </button>
                </div>
              </div>

              <div className={`ed-quick${quickOpen ? '' : ' is-collapsed'}`}>
                <div className="ed-quick-head">
                  <span>快捷调整</span>
                  <button
                    className="ed-quick-toggle"
                    type="button"
                    aria-expanded={quickOpen}
                    aria-label={quickOpen ? '收起快捷调整' : '展开快捷调整'}
                    onClick={() => setQuickOpen((value) => !value)}
                  >
                    <EditorIcon name="chevron-down" size={18} />
                  </button>
                </div>

                {quickOpen ? (
                  <div className="ed-quick-box">
                    <input
                      className="ed-quick-input"
                      value={draft}
                      placeholder="输入你的任何想法"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          sendDraft();
                        }
                      }}
                    />

                    <div className="ed-quick-actions">
                      <span className="ed-quick-chip">
                        <EditorIcon name="link" size={14} />
                        {selectedName}
                        <button
                          className="ed-quick-unlink"
                          type="button"
                          aria-label="解除分镜关联"
                          onClick={() => notify('解除关联将在 T20 实现。')}
                        >
                          <EditorIcon name="close" size={12} />
                        </button>
                      </span>
                      <button
                        className="ed-quick-send"
                        type="button"
                        aria-label="发送快捷调整"
                        onClick={sendDraft}
                      >
                        <EditorIcon name="send" size={19} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : activeRail === 'voice' ? (
            <VoicePanel onNotify={notify} />
          ) : activeRail === 'subtitle' ? (
            <SubtitlePanel onNotify={notify} />
          ) : (
            <MusicPanel onNotify={notify} />
          )}
        </aside>

        <nav className="ed-rail" aria-label="编辑器面板">
          {RAIL_ITEMS.map((item) => {
            const active = item.id === activeRail;

            return (
              <button
                key={item.id}
                className={`ed-rail-item${active ? ' is-active' : ''}`}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveRail(item.id)}
              >
                <EditorIcon name={item.icon} size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <section className="ed-timeline" aria-label="时间线">
        <div className="ed-timeline-head">
          <div className="ed-timeline-left">
            <span className="ed-timeline-title">时间线</span>
            <span className="ed-timecode">
              {formatTime(currentTime)} / {formatTime(spanSeconds)}
            </span>
            <div className="ed-history">
              <button
                className="ed-icon-button"
                type="button"
                aria-label="撤销"
                onClick={() => notify('撤销将在 T17 实现。')}
              >
                <EditorIcon name="undo" size={16} />
              </button>
              <button
                className="ed-icon-button"
                type="button"
                aria-label="重做"
                onClick={() => notify('重做将在 T17 实现。')}
              >
                <EditorIcon name="redo" size={16} />
              </button>
            </div>
          </div>

          <div className="ed-timeline-tools">
            <button
              className="ed-icon-button"
              type="button"
              aria-label="分割"
              onClick={() => notify('分割工具将在 T17 实现。')}
            >
              <EditorIcon name="split" size={15} />
            </button>

            {TIMELINE_TOOLS.map((tool) => (
              <button
                key={tool.id}
                className={`ed-icon-button${tools[tool.id] ? ' is-active' : ''}`}
                type="button"
                aria-label={tool.label}
                aria-pressed={tools[tool.id]}
                onClick={() => toggleTimelineTool(tool.id, tool.label)}
              >
                <EditorIcon name={tool.icon} size={15} />
              </button>
            ))}

            <div className="ed-zoom">
              <EditorIcon name="minus" size={14} />
              <input
                className="ed-zoom-input"
                type="range"
                min={0}
                max={100}
                value={sliderFromZoom(zoom)}
                aria-label="时间线缩放"
                style={{ '--zoom-progress': `${sliderFromZoom(zoom)}%` } as CSSProperties}
                onChange={(event) => setZoom(zoomFromSlider(Number(event.target.value)))}
              />
              <EditorIcon name="plus" size={14} />
              <span className="ed-zoom-value">{zoom.toFixed(1)}x</span>
            </div>

            <button
              className="ed-icon-button"
              type="button"
              aria-label="新增轨道"
              onClick={() => notify('新增轨道将在 T17 实现。')}
            >
              <EditorIcon name="plus" size={15} />
            </button>
          </div>
        </div>

        <div className="ed-timeline-body">
          <div
            className={`ed-timeline-canvas${isScrubbing ? ' is-scrubbing' : ''}`}
            style={{ width: `${zoom * 100}%` }}
            onLostPointerCapture={endScrub}
            onPointerCancel={endScrub}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={endScrub}
          >
            <div className="ed-ruler">
              <div className="ed-ruler-label" />
              <div
                className="ed-ruler-track"
                ref={rulerTrackRef}
                role="slider"
                tabIndex={0}
                aria-label="播放头位置"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={spanSeconds}
                aria-valuenow={Math.min(spanSeconds, Math.round(currentTime * 10) / 10)}
                aria-valuetext={formatTime(currentTime)}
                onKeyDown={handleSeekKey}
              >
                {timeline.ticks.map((tick) => (
                  <span
                    key={tick.seconds}
                    className="ed-tick"
                    style={{ left: `${secondsToPercent(tick.seconds, spanSeconds)}%` }}
                  >
                    <span className="ed-tick-label">{tick.label}</span>
                  </span>
                ))}
              </div>
            </div>

            {timeline.tracks.map((track) => (
              <div key={track.kind} className={`ed-track-row ed-track-${track.kind}`}>
                <div className="ed-track-label">
                  <EditorIcon name={TRACK_ICONS[track.kind]} size={18} />
                  <span className="ed-track-meta">
                    <span className="ed-track-name">{track.title}</span>
                    <span className="ed-track-sub">{track.countLabel}</span>
                  </span>
                </div>
                <div className="ed-track-content">{renderTrackClips(track)}</div>
              </div>
            ))}

            <div aria-hidden="true" className="ed-playhead-layer">
              <div className="ed-playhead" style={{ left: `${playheadRatio * 100}%` }}>
                <span className="ed-playhead-handle" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="ed-toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
