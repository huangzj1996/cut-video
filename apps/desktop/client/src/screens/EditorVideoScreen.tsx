/**
 * 项目级编辑器。左侧分镜、工程名与时长来自最新 `project.json`；
 * 预览和四轨时间线仍是静态占位，由后续切片接入真实媒体与编辑。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { createChatHash } from '../lib/routes';
import { EditorEmpty, EditorLoading, EditorUnavailable } from './editor-video/EditorStates';
import {
  loadEditorProject,
  type EditorLoadResult,
  type EditorProjectView,
} from './editor-video/project-view';
import { PreviewStage } from './editor-video/PreviewStage';
import {
  clampTime,
  clientXToTime,
  formatTime,
  secondsToPercent,
  type TimelineClip,
} from './editor-video/timeline';
import { EditorIcon, type EditorIconName } from './editor-icons';
import { MusicPanel } from './panels/MusicPanel';
import { SubtitlePanel } from './panels/SubtitlePanel';
import { VoicePanel } from './panels/VoicePanel';
import './editor-video.css';

const TOTAL_SECONDS = 87;
const TIMELINE_SPAN_SECONDS = 114.8;
const TICK_STEP_PERCENT = 8.716;

interface VideoBar extends TimelineClip {
  border: string;
}

const VIDEO_BAR_STYLES = [
  {
    id: 'video-01',
    label: '分镜01',
    background: '#1f6158',
    border: '#25d0b1',
    accent: '#25d0b1',
  },
  {
    id: 'video-02',
    label: '分镜02',
    background: '#294673',
    border: 'rgba(255,255,255,0.125)',
    accent: '#5b8cff',
  },
  {
    id: 'video-03',
    label: '分镜03',
    background: '#503984',
    border: 'rgba(255,255,255,0.125)',
    accent: '#8b6af7',
  },
  {
    id: 'video-04',
    label: '分镜04',
    background: '#74313e',
    border: 'rgba(255,255,255,0.125)',
    accent: '#f05f73',
  },
  {
    id: 'video-05',
    label: '分镜05',
    background: '#3d3f45',
    border: 'rgba(255,255,255,0.125)',
    accent: '#7e848e',
  },
] as const;

// 片段只铺满工程时长 00:00-01:27；之后到标尺末端是空白死区。
const VIDEO_BARS: readonly VideoBar[] = VIDEO_BAR_STYLES.map((bar, index, all) => ({
  ...bar,
  startSeconds: (index * TOTAL_SECONDS) / all.length,
  endSeconds: ((index + 1) * TOTAL_SECONDS) / all.length,
}));

interface VoiceBar {
  id: string;
  label: string;
  startSeconds: number;
  endSeconds: number;
  waveBars: number;
  pause?: boolean;
}

const VOICE_BARS: readonly VoiceBar[] = [
  {
    id: 'voice-01',
    label: 'IndexTTS2 口播',
    startSeconds: 0,
    endSeconds: TOTAL_SECONDS * 0.52,
    waveBars: 16,
  },
  {
    id: 'voice-02',
    label: '停顿',
    startSeconds: TOTAL_SECONDS * 0.52,
    endSeconds: TOTAL_SECONDS * 0.6,
    waveBars: 2,
    pause: true,
  },
  {
    id: 'voice-03',
    label: '旁白 02',
    startSeconds: TOTAL_SECONDS * 0.6,
    endSeconds: TOTAL_SECONDS,
    waveBars: 13,
  },
];

const WAVE_HEIGHTS = [8, 12, 16, 20, 24, 8, 12, 16, 20, 24, 8, 12, 16, 20, 24, 8];

const TICKS = [
  '00:00',
  '00:10',
  '00:20',
  '00:30',
  '00:40',
  '00:50',
  '01:00',
  '01:10',
  '01:20',
  '01:30',
  '01:40',
  '01:50',
];

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

const CONTENT_END_PERCENT = secondsToPercent(TOTAL_SECONDS, TIMELINE_SPAN_SECONDS);

function Waveform({ count }: { count: number }) {
  return (
    <span className="ed-waveform" aria-hidden="true">
      {WAVE_HEIGHTS.slice(0, count).map((height, index) => (
        <span key={index} style={{ height }} />
      ))}
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

  return <EditorWorkspace key={state.view.projectId} view={state.view} />;
}

function EditorWorkspace({ view }: { view: EditorProjectView }) {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(view.scenes[0]?.id ?? null);
  const [activeRail, setActiveRail] = useState<EditorRailId>('video');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [zoom, setZoom] = useState(0);
  const [tools, setTools] = useState<Record<TimelineToolId, boolean>>({
    snap: true,
    link: false,
    wave: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerTrackRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const selectedScene = view.scenes.find((scene) => scene.id === selectedSceneId);
  const selectedName = selectedScene?.title ?? '未选择分镜';
  const selectedRange = selectedScene?.rangeLabel ?? '—';
  const playheadRatio = Math.min(1, Math.max(0, currentTime / TIMELINE_SPAN_SECONDS));
  const zoomScale = 1 + (zoom / 100) * 0.8;

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

  useEffect(() => {
    if (!playing) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentTime((time) => Math.min(TOTAL_SECONDS, time + 0.1));
    }, 100);

    return () => {
      window.clearInterval(timer);
    };
  }, [playing]);

  useEffect(() => {
    if (playing && currentTime >= TOTAL_SECONDS) {
      setPlaying(false);
    }
  }, [currentTime, playing]);

  const seekFromClientX = useCallback((clientX: number, offsetSeconds: number) => {
    const rect = rulerTrackRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const time = clientXToTime(clientX, rect, TIMELINE_SPAN_SECONDS) + offsetSeconds;

    setCurrentTime(clampTime(time, TIMELINE_SPAN_SECONDS));
  }, []);

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
    setPlaying(false);
    rulerTrackRef.current?.focus({ preventScroll: true });

    if (activePointerIdRef.current !== null) {
      endScrub();
    }

    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsScrubbing(true);

    if (target.closest('.ed-playhead')) {
      const rect = rulerTrackRef.current?.getBoundingClientRect();
      const pointerTime = rect ? clientXToTime(event.clientX, rect, TIMELINE_SPAN_SECONDS) : 0;

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
        nextTime = TIMELINE_SPAN_SECONDS;
        break;
      default:
        return;
    }

    event.preventDefault();
    setPlaying(false);
    setCurrentTime(clampTime(nextTime, TIMELINE_SPAN_SECONDS));
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
              const active = scene.id === selectedSceneId;

              return (
                <button
                  key={scene.id}
                  className={`ed-clip${active ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedSceneId(scene.id)}
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
            clips={VIDEO_BARS}
            currentTime={currentTime}
            projectSeconds={TOTAL_SECONDS}
          />
          <div className="ed-preview-bar">
            <span className="ed-preview-time">
              {formatTime(currentTime)} <span>/ {formatTime(TOTAL_SECONDS)}</span>
            </span>

            <button
              className="ed-play"
              type="button"
              aria-label={playing ? '暂停' : '播放'}
              aria-pressed={playing}
              onClick={() => {
                if (currentTime >= TOTAL_SECONDS) {
                  setCurrentTime(0);
                }

                setPlaying((value) => !value);
              }}
            >
              <EditorIcon name={playing ? 'pause' : 'play'} size={24} />
            </button>

            <div className="ed-preview-tools">
              <button
                className="ed-preview-tool"
                type="button"
                aria-label="音量"
                onClick={() => notify('音量控制将在 T18 接入。')}
              >
                <EditorIcon name="volume" size={18} />
              </button>
              <button
                className="ed-preview-tool"
                type="button"
                aria-label="全屏预览"
                onClick={() => notify('全屏预览将在 T18 接入。')}
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
              {formatTime(currentTime)} / {formatTime(TOTAL_SECONDS)}
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
                value={zoom}
                aria-label="时间线缩放"
                style={{ '--zoom-progress': `${zoom}%` } as CSSProperties}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <EditorIcon name="plus" size={14} />
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
            style={{ width: `${zoomScale * 100}%` }}
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
                aria-valuemax={TIMELINE_SPAN_SECONDS}
                aria-valuenow={Math.min(TIMELINE_SPAN_SECONDS, Math.round(currentTime * 10) / 10)}
                aria-valuetext={formatTime(currentTime)}
                onKeyDown={handleSeekKey}
              >
                {TICKS.map((tick, index) => (
                  <span
                    key={tick}
                    className="ed-tick"
                    style={{ left: `${index * TICK_STEP_PERCENT}%` }}
                  >
                    <span className="ed-tick-label">{tick}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="ed-track-row ed-track-video">
              <div className="ed-track-label">
                <EditorIcon name="video-track" size={18} />
                <span className="ed-track-meta">
                  <span className="ed-track-name">视频 1</span>
                  <span className="ed-track-sub">5 个分镜</span>
                </span>
              </div>
              <div className="ed-track-content">
                {VIDEO_BARS.map((bar) => (
                  <div
                    key={bar.id}
                    className="ed-video-bar"
                    style={{
                      left: `${secondsToPercent(bar.startSeconds, TIMELINE_SPAN_SECONDS)}%`,
                      width: `${secondsToPercent(bar.endSeconds - bar.startSeconds, TIMELINE_SPAN_SECONDS)}%`,
                      background: bar.background,
                      borderColor: bar.border,
                    }}
                  >
                    <span className="ed-bar-accent" style={{ background: bar.accent }} />
                    <span className="ed-video-name">{bar.label}</span>
                    <span className="ed-thumbs" aria-hidden="true">
                      <span className="ed-thumb is-light" />
                      <span className="ed-thumb" />
                      <span className="ed-thumb is-light" />
                      <span className="ed-thumb" />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ed-track-row ed-track-voice">
              <div className="ed-track-label">
                <EditorIcon name="mic-track" size={18} />
                <span className="ed-track-meta">
                  <span className="ed-track-name">配音</span>
                  <span className="ed-track-sub">IndexTTS2 + 旁白</span>
                </span>
              </div>
              <div className="ed-track-content">
                {VOICE_BARS.map((bar) => (
                  <div
                    key={bar.id}
                    className={`ed-voice-bar${bar.pause ? ' is-pause' : ''}`}
                    style={{
                      left: `${secondsToPercent(bar.startSeconds, TIMELINE_SPAN_SECONDS)}%`,
                      width: `${secondsToPercent(bar.endSeconds - bar.startSeconds, TIMELINE_SPAN_SECONDS)}%`,
                    }}
                  >
                    <span className="ed-voice-name">{bar.label}</span>
                    <Waveform count={bar.waveBars} />
                  </div>
                ))}
              </div>
            </div>

            <div className="ed-track-row ed-track-subtitle">
              <div className="ed-track-label">
                <EditorIcon name="subtitle-track" size={18} />
                <span className="ed-track-meta">
                  <span className="ed-track-name">字幕</span>
                  <span className="ed-track-sub">Whisper 已对齐</span>
                </span>
              </div>
              <div className="ed-track-content">
                <div
                  className="ed-subtitle-bar"
                  style={{ left: '0%', width: `${CONTENT_END_PERCENT}%` }}
                >
                  <EditorIcon name="subtitles" size={16} />
                  <span>Whisper 字幕 · 自动断句 · 可逐字微调</span>
                </div>
              </div>
            </div>

            <div className="ed-track-row ed-track-music">
              <div className="ed-track-label">
                <EditorIcon name="music" size={18} />
                <span className="ed-track-meta">
                  <span className="ed-track-name">音乐</span>
                  <span className="ed-track-sub">Eutopia · 02:01</span>
                </span>
              </div>
              <div className="ed-track-content">
                <div
                  className="ed-tl-music-bar"
                  style={{ left: '0%', width: `${CONTENT_END_PERCENT}%` }}
                >
                  <span className="ed-bar-accent" style={{ background: 'var(--ed-blue)' }} />
                  <EditorIcon name="music" size={15} />
                  <span className="ed-tl-music-name">Eutopia</span>
                  <span className="ed-tl-music-artist">Mika Chen</span>
                  <Waveform count={12} />
                  <span className="ed-tl-music-duration">02:01</span>
                </div>
              </div>
            </div>

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
