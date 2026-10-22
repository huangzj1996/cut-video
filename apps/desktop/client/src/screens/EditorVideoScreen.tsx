/**
 * 「妙剪智能视频编辑器-画面」frame 的静态 UI 实现。
 * 设计依据：docs/design/miaoma-magicut.pen。
 * 当前使用 mock 数据，不含真实预览、时间线编辑、工作流与导出。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import { EditorIcon, type EditorIconName } from './editor-icons';
import { MusicPanel } from './panels/MusicPanel';
import { SubtitlePanel } from './panels/SubtitlePanel';
import { VoicePanel } from './panels/VoicePanel';
import './editor-video.css';

const TOTAL_SECONDS = 87;
const TIMELINE_SPAN_SECONDS = 114.8;
const TICK_STEP_PERCENT = 8.716;

interface StoryboardClip {
  id: string;
  name: string;
  range: string;
  text: string;
}

const STORYBOARDS: readonly StoryboardClip[] = [
  {
    id: 'scene-01',
    name: '分镜 01',
    range: '00:00-00:04',
    text: '开场把原始素材拖入时间线，\n系统开始识别画面节奏。',
  },
  {
    id: 'scene-02',
    name: '分镜 02',
    range: '00:04-00:08',
    text: 'AI 自动挑选高光片段，\n同步生成第一版字幕。',
  },
  {
    id: 'scene-03',
    name: '分镜 03',
    range: '00:00-00:04',
    text: '是的发送到asdfasdfasdf\n阿斯顿发送到发的阿',
  },
  {
    id: 'scene-04',
    name: '分镜 04',
    range: '00:00-00:04',
    text: '是的发送到\n官方去潍坊过去问\n是的发送到发的岗位工区',
  },
  {
    id: 'scene-05',
    name: '分镜 05',
    range: '00:00-00:04',
    text: '阿斯顿发的\n刚刚我去二\n撒旦法水电费赶过去',
  },
  {
    id: 'scene-06',
    name: '分镜 06',
    range: '00:00-00:04',
    text: '谁的法谁的规',
  },
  {
    id: 'scene-07',
    name: '分镜 07',
    range: '00:00-00:04',
    text: '确认分镜顺序与字幕断句，\n逐段校对配音节奏。',
  },
  {
    id: 'scene-08',
    name: '分镜 08',
    range: '00:00-00:04',
    text: '检查画面与配音是否对齐，\n准备渲染导出成片。',
  },
];

interface VideoBar {
  id: string;
  label: string;
  left: string;
  width: string;
  background: string;
  border: string;
  accent: string;
}

const VIDEO_BARS: readonly VideoBar[] = [
  {
    id: 'video-01',
    label: '分镜01',
    left: '0.7%',
    width: '12.47%',
    background: '#1f6158',
    border: '#25d0b1',
    accent: '#25d0b1',
  },
  {
    id: 'video-02',
    label: '分镜02',
    left: '14.07%',
    width: '11.4%',
    background: '#294673',
    border: 'rgba(255,255,255,0.125)',
    accent: '#5b8cff',
  },
  {
    id: 'video-03',
    label: '分镜03',
    left: '26.28%',
    width: '11.28%',
    background: '#503984',
    border: 'rgba(255,255,255,0.125)',
    accent: '#8b6af7',
  },
  {
    id: 'video-04',
    label: '分镜04',
    left: '38.37%',
    width: '11.92%',
    background: '#74313e',
    border: 'rgba(255,255,255,0.125)',
    accent: '#f05f73',
  },
  {
    id: 'video-05',
    label: '分镜05',
    left: '51.16%',
    width: '12.21%',
    background: '#3d3f45',
    border: 'rgba(255,255,255,0.125)',
    accent: '#7e848e',
  },
];

interface VoiceBar {
  id: string;
  label: string;
  left: string;
  width: string;
  waveBars: number;
  pause?: boolean;
}

const VOICE_BARS: readonly VoiceBar[] = [
  { id: 'voice-01', label: 'IndexTTS2 口播', left: '0.7%', width: '24.42%', waveBars: 16 },
  { id: 'voice-02', label: '停顿', left: '25.81%', width: '3.84%', waveBars: 2, pause: true },
  { id: 'voice-03', label: '旁白 02', left: '30.23%', width: '19.19%', waveBars: 13 },
];

const WAVE_HEIGHTS = [8, 12, 16, 20, 24, 8, 12, 16, 20, 24, 8, 12, 16, 20, 24, 8];

const TICKS = ['00:00', '00:10', '00:20', '00:30', '00:40', '00:50', '01:00', '01:10', '01:20'];

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

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function Waveform({ count }: { count: number }) {
  return (
    <span className="ed-waveform" aria-hidden="true">
      {WAVE_HEIGHTS.slice(0, count).map((height, index) => (
        <span key={index} style={{ height }} />
      ))}
    </span>
  );
}

export function EditorVideoScreen() {
  const [selectedClipId, setSelectedClipId] = useState('scene-02');
  const [activeRail, setActiveRail] = useState<EditorRailId>('video');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [quickOpen, setQuickOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [zoom, setZoom] = useState(58);
  const [tools, setTools] = useState<Record<TimelineToolId, boolean>>({
    snap: true,
    link: false,
    wave: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<number | null>(null);

  const selectedClip = STORYBOARDS.find((clip) => clip.id === selectedClipId);
  const selectedName = selectedClip?.name ?? '分镜 01';
  const selectedRange = selectedClip?.range ?? '00:04-00:08';
  const playheadRatio = Math.min(1, Math.max(0, currentTime / TIMELINE_SPAN_SECONDS));
  const zoomScale = zoom <= 58 ? 0.75 + (zoom / 58) * 0.25 : 1 + ((zoom - 58) / 42) * 0.8;

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

  const handleSeek = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));

    setCurrentTime(Math.min(TOTAL_SECONDS, fraction * TIMELINE_SPAN_SECONDS));
  };

  const handleSeekKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;

    setCurrentTime((time) => Math.min(TOTAL_SECONDS, Math.max(0, time + step)));
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
          <div className="ed-project-title">口播短片自动剪辑工程</div>
          <div className="ed-project-meta">2 分钟前更新 · 已自动保存</div>
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
            <p>8 段分镜 · 00:30 · 当前 {selectedRange}</p>
          </div>

          <div className="ed-clip-list">
            {STORYBOARDS.map((clip) => {
              const active = clip.id === selectedClipId;

              return (
                <button
                  key={clip.id}
                  className={`ed-clip${active ? ' is-active' : ''}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedClipId(clip.id)}
                >
                  <span className="ed-clip-top">
                    <span className="ed-clip-name">
                      {clip.name}
                      {active ? <span className="ed-clip-current">当前</span> : null}
                    </span>
                    <span className="ed-clip-range">{clip.range}</span>
                  </span>
                  <span className="ed-clip-text">{clip.text}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="ed-center" aria-label="视频预览">
          <div className="ed-preview" role="img" aria-label="视频预览区域（透明棋盘）" />
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
          <div className="ed-timeline-canvas" style={{ width: `${zoomScale * 100}%` }}>
            <div className="ed-ruler">
              <div className="ed-ruler-label" />
              <div
                className="ed-ruler-track"
                role="slider"
                tabIndex={0}
                aria-label="播放头位置"
                aria-valuemin={0}
                aria-valuemax={TOTAL_SECONDS}
                aria-valuenow={Math.round(currentTime)}
                aria-valuetext={formatTime(currentTime)}
                onClick={handleSeek}
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
                      left: bar.left,
                      width: bar.width,
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
                    style={{ left: bar.left, width: bar.width }}
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
                <div className="ed-subtitle-bar" style={{ left: '0.7%', width: '44.19%' }}>
                  <EditorIcon name="subtitles" size={16} />
                  <span>Whisper 字幕 · 自动断句 · 可逐字微调</span>
                </div>
              </div>
            </div>

            <div className="ed-playhead-layer">
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
