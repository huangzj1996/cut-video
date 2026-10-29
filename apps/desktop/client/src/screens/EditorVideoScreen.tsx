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
import type { VideoProject, WorkflowRunStatus } from '@miaoma/video-project';
import { assetUrl } from '../lib/media';
import { createChatHash } from '../lib/routes';
import { AutosaveController } from './editor-video/autosave';
import {
  canRedoSession,
  canSaveSession,
  canUndoSession,
  createEditorSession,
  editorSessionReducer,
  isEditorReadOnly,
  type EditorSessionState,
} from './editor-video/editor-session';
import { describeReadonlyBanner, describeSaveStatus } from './editor-video/editor-status';
import { EditorEmpty, EditorLoading, EditorUnavailable } from './editor-video/EditorStates';
import {
  loadEditorProject,
  buildEditorProjectView,
  type EditorLoadResult,
} from './editor-video/project-view';
import { parseTimecode } from './editor-video/playback';
import { PreviewStage } from './editor-video/PreviewStage';
import { buildPreviewMediaPlan, trackHasClips } from './editor-video/preview-media';
import type { EditAction } from './editor-video/project-edit';
import { reorderTargetIndex } from './editor-video/reorder-drag';
import { createSelection, selectionReducer } from './editor-video/selection';
import { resolveSubtitleOverlay } from './editor-video/subtitle-overlay';
import {
  buildEditorTimeline,
  collectMissingMedia,
  sliderFromZoom,
  zoomFromSlider,
  type EditorTrackKind,
  type EditorTrackView,
  type TimelineTrackClip,
} from './editor-video/timeline-geometry';
import { clampTime, clientXToTime, formatTime, secondsToPercent } from './editor-video/timeline';
import { useAudioWaveforms } from './editor-video/useAudioWaveforms';
import { usePlaybackClock } from './editor-video/usePlaybackClock';
import {
  sampleMusicWaveform,
  sampleVoiceWaveform,
  waveformBars,
  waveformPath,
  type WaveformBar,
} from './editor-video/waveform';
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

interface TimelineTool {
  /** 尚无对应行为的开关：禁用并提示后续版本提供，避免只切本地状态。 */
  future?: boolean;
  icon: EditorIconName;
  id: 'link' | 'snap' | 'wave';
  label: string;
}

const TIMELINE_TOOLS: readonly TimelineTool[] = [
  { future: true, icon: 'magnet', id: 'snap', label: '吸附' },
  { future: true, icon: 'link', id: 'link', label: '联动' },
  { icon: 'wave', id: 'wave', label: '波形' },
];

type EditableClipKind = 'music' | 'subtitle';
type ClipDragMode = 'move' | 'trim-end' | 'trim-start';

interface ClipDragState {
  clipId: string;
  deltaMs: number;
  kind: EditableClipKind;
  mode: ClipDragMode;
}

interface ClipWaveformState {
  bars: WaveformBar[] | null;
  state: 'failed' | 'loading' | 'ready';
}

/**
 * 时间线上的真实波形：解码成功画峰值柱，静音素材是居中的平线；
 * 读取或解码失败时回退到静态占位，不抛错也不伪造峰值。
 */
function ClipWaveform({ bars, state }: ClipWaveformState) {
  if (state !== 'ready' || !bars) {
    const label = state === 'failed' ? '波形不可用' : '波形加载中';

    return (
      <span aria-label={label} className="ed-wave-placeholder" role="img">
        {label}
      </span>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="ed-wave"
      preserveAspectRatio="none"
      viewBox={`0 0 ${bars.length} 100`}
    >
      <path d={waveformPath(bars)} />
    </svg>
  );
}

type EditorScreenState = EditorLoadResult | { kind: 'loading' };

function isVideoProject(value: unknown): value is VideoProject {
  return typeof value === 'object' && value !== null && 'ai' in value;
}

/**
 * 项目级编辑器入口：每次进入都按 projectId 重新读取最新 `project.json`。
 * 同时读取工作流状态，`running` / `waiting_user` 时编辑器只读。
 * 草稿工程回创作消息页；读取失败或损坏工程停在错误页，可返回工作台。
 */
export function EditorVideoScreen({ projectId }: { projectId: string }) {
  const [state, setState] = useState<EditorScreenState>({ kind: 'loading' });
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowRunStatus | null>(null);

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

    void (async () => {
      const result = await loadEditorProject(reader, projectId);
      let status: WorkflowRunStatus | null = null;
      const workflow = window.miaoma?.workflow;

      if (workflow) {
        try {
          const response = await workflow.getState(projectId);

          if (response.ok) {
            status = response.data?.status ?? null;
          }
        } catch {
          // 工作流状态读取失败时不阻塞编辑器打开，按可编辑处理。
        }
      }

      if (!cancelled) {
        setWorkflowStatus(status);
        setState(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // AI 工作流运行/等待审批的状态可能随时变化，事件里带 status 时同步到编辑器。
  useEffect(() => {
    const workflow = window.miaoma?.workflow;

    if (!workflow) {
      return;
    }

    const unsubscribe = workflow.onEvent((event) => {
      if (event.projectId === projectId && event.status) {
        setWorkflowStatus(event.status);
      }
    });

    return unsubscribe;
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

  return (
    <EditorWorkspace
      key={state.view.projectId}
      project={state.project}
      readonly={isEditorReadOnly(workflowStatus)}
      readonlyMessage={describeReadonlyBanner(workflowStatus)}
    />
  );
}

function EditorWorkspace({
  project,
  readonly,
  readonlyMessage,
}: {
  project: VideoProject;
  readonly: boolean;
  readonlyMessage: string | null;
}) {
  const [session, sessionDispatch] = useReducer(editorSessionReducer, project, (initialProject) =>
    createEditorSession(initialProject, { readonly }),
  );
  const view = useMemo(() => buildEditorProjectView(session.project), [session.project]);
  const timeline = useMemo(() => buildEditorTimeline(session.project), [session.project]);
  const missingMedia = useMemo(() => collectMissingMedia(timeline), [timeline]);
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
  const [zoom, setZoom] = useState(1);
  const [waveformsVisible, setWaveformsVisible] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggingSceneId, setDraggingSceneId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [clipDrag, setClipDrag] = useState<ClipDragState | null>(null);
  const [trimPreview, setTrimPreview] = useState<{ clipId: string; deltaMs: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerTrackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const grabOffsetRef = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const sessionRef = useRef<EditorSessionState>(session);
  const autosaveRef = useRef<AutosaveController | null>(null);
  const editSeqRef = useRef(session.editSeq);
  const suppressClickRef = useRef(false);
  const trimRef = useRef<{
    clipId: string;
    deltaMs: number;
    maxDeltaMs: number;
    minDeltaMs: number;
    pointerId: number;
    startClientX: number;
    widthPx: number;
  } | null>(null);
  const dragRef = useRef<{
    moved: boolean;
    pointerId: number;
    sceneId: string;
    targetIndex: number;
  } | null>(null);
  const clipDragRef = useRef<{
    clipId: string;
    deltaMs: number;
    kind: EditableClipKind;
    mode: ClipDragMode;
    originClientX: number;
    pointerId: number;
  } | null>(null);

  sessionRef.current = session;

  const selectedScene = view.scenes.find((scene) => scene.id === selection.sceneId);
  const selectedName = selectedScene?.title ?? '未选择分镜';
  const selectedRange = selectedScene?.rangeLabel ?? '—';
  const playheadRatio = Math.min(1, Math.max(0, currentTime / spanSeconds));
  const previewPlan = useMemo(
    () => buildPreviewMediaPlan(session.project, currentTime),
    [currentTime, session.project],
  );
  const subtitleOverlay = useMemo(
    () => resolveSubtitleOverlay(session.project, currentTime),
    [currentTime, session.project],
  );
  const hasVoiceTrack = useMemo(() => trackHasClips(session.project, 'voice'), [session.project]);
  const hasMusicTrack = useMemo(() => trackHasClips(session.project, 'music'), [session.project]);
  // 分镜锁定模型下只有分镜末尾的视频片段能改变分镜时长，只有它显示右边缘裁剪手柄。
  const trailingVideoClipIds = useMemo(() => {
    const sceneEnds = new Map<string, number>();
    let cursorMs = 0;

    for (const scene of session.project.scenes
      .slice()
      .sort((left, right) => left.index - right.index)) {
      cursorMs += scene.durationMs;
      sceneEnds.set(scene.id, cursorMs);
    }

    const ids = new Set<string>();
    const videoTrack = session.project.tracks.find((track) => track.kind === 'video');

    for (const clip of videoTrack?.clips ?? []) {
      if (clip.sceneId && sceneEnds.get(clip.sceneId) === clip.endMs) {
        ids.add(clip.id);
      }
    }

    return ids;
  }, [session.project]);
  const audioAssetsById = useMemo(() => {
    const byId = new Map<string, { durationMs: number }>();

    for (const asset of [...session.project.assets.voices, ...session.project.assets.music]) {
      byId.set(asset.id, { durationMs: asset.durationMs });
    }

    return byId;
  }, [session.project]);
  const audioAssetIds = useMemo(() => {
    const ids = new Set<string>();

    for (const track of session.project.tracks) {
      if (track.kind === 'voice' || track.kind === 'music') {
        for (const clip of track.clips) {
          ids.add(clip.assetId);
        }
      }
    }

    return [...ids];
  }, [session.project]);
  const waveforms = useAudioWaveforms(view.projectId, audioAssetIds, waveformsVisible);
  const saveStatusView = describeSaveStatus(session.saveStatus, session.dirty);

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

  // 工作流状态变化时同步只读标记；会话 reducer 负责拒绝只读期间的操作。
  useEffect(() => {
    sessionDispatch({ readonly, type: 'readonly-changed' });
  }, [readonly]);

  // 缩短分镜会让项目总时长变小；播放头不能停在时间线之外。
  useEffect(() => {
    if (currentTime > timeline.durationSeconds) {
      seek(timeline.durationSeconds);
    }
  }, [currentTime, seek, timeline.durationSeconds]);

  /**
   * 保存当前内存文档。`expectedRevision` 使用文档基线修订号：
   * 冲突时进入 conflict 状态并停止自动保存，不覆盖别处的新修订。
   */
  const persistProject = useCallback(async () => {
    const current = sessionRef.current;

    // 只读（工作流运行/等待审批）或冲突状态下不写盘，避免覆盖别处的新修订。
    if (!current.dirty || !canSaveSession(current)) {
      return;
    }

    const writer = window.miaoma?.project;

    if (!writer) {
      throw new Error('IPC_UNAVAILABLE');
    }

    sessionDispatch({ type: 'save-start' });

    const response = await writer.update({
      expectedRevision: current.contentRevision,
      project: current.project,
      projectId: current.project.project.projectId,
    });

    if (response.ok) {
      if (!isVideoProject(response.data)) {
        sessionDispatch({ message: '服务端返回的工程结构无效。', type: 'save-error' });
        throw new Error('PROJECT_INVALID');
      }

      sessionDispatch({ project: response.data, savedSeq: current.editSeq, type: 'save-success' });
      return;
    }

    if (response.error.code === 'PROJECT_STALE_REVISION') {
      sessionDispatch({ type: 'save-conflict' });
      autosaveRef.current?.stop();
      return;
    }

    sessionDispatch({ message: response.error.message, type: 'save-error' });
    throw new Error(response.error.code);
  }, []);

  useEffect(() => {
    const controller = new AutosaveController({ save: persistProject });

    autosaveRef.current = controller;

    return () => {
      controller.stop();
      autosaveRef.current = null;
    };
  }, [persistProject]);

  // 只读期间停掉自动保存；解锁后若仍有未保存的编辑，重新排一次保存。
  const wasReadonlyRef = useRef(readonly);

  useEffect(() => {
    const wasReadonly = wasReadonlyRef.current;
    wasReadonlyRef.current = readonly;

    if (readonly) {
      autosaveRef.current?.stop();
      return;
    }

    if (wasReadonly && sessionRef.current.saveStatus !== 'conflict') {
      autosaveRef.current?.resume();

      if (sessionRef.current.dirty) {
        autosaveRef.current?.noteEdit();
      }
    }
  }, [readonly]);

  // 每次成功编辑（含撤销/重做）后重置 2s 防抖窗口。
  useEffect(() => {
    if (session.editSeq === editSeqRef.current) {
      return;
    }

    editSeqRef.current = session.editSeq;
    autosaveRef.current?.noteEdit();
  }, [session.editSeq]);

  useEffect(() => {
    if (session.lastEditError) {
      notify(session.lastEditError);
    }
  }, [session.lastEditError, notify]);

  useEffect(() => {
    if (session.lastSaveError) {
      notify(`保存失败：${session.lastSaveError}`);
    }
  }, [session.lastSaveError, notify]);

  useEffect(() => {
    if (session.saveStatus === 'conflict') {
      notify('工程已在别处修改，请重新加载后再编辑。');
    }
  }, [session.saveStatus, notify]);

  // 关闭窗口前主进程会请求 flush，保存完成后必须回执，否则最多等 2 秒。
  useEffect(() => {
    const editor = window.miaoma?.editor;

    if (!editor) {
      return;
    }

    const unsubscribe = editor.onFlushRequest(() => {
      void (async () => {
        try {
          await autosaveRef.current?.flush();
        } catch {
          // 保存失败也要放行关闭，避免窗口关不掉。
        }

        try {
          await editor.completeFlush();
        } catch {
          // 主进程可能已经销毁，忽略。
        }
      })();
    });

    return unsubscribe;
  }, []);

  // Ctrl+S 立即保存；Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 撤销重做。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const editingText = Boolean(target?.closest('input, textarea, [contenteditable="true"]'));
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();

        const current = sessionRef.current;

        if (!canSaveSession(current)) {
          notify(
            current.saveStatus === 'conflict'
              ? '保存冲突，请先重新加载工程。'
              : '编辑器只读，暂不能保存。',
          );
          return;
        }

        void autosaveRef.current?.flush();
        return;
      }

      if (editingText) {
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        sessionDispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (key === 'y') {
        event.preventDefault();
        sessionDispatch({ type: 'redo' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const reloadProject = useCallback(async () => {
    const reader = window.miaoma?.project;

    if (!reader) {
      return;
    }

    const response = await reader.get(sessionRef.current.project.project.projectId);

    if (!response.ok || !isVideoProject(response.data)) {
      notify('重新加载失败，请稍后重试。');
      return;
    }

    sessionDispatch({ project: response.data, type: 'reload' });
    autosaveRef.current?.resume();
    notify('已重新加载最新工程。');
  }, [notify]);

  const performEdit = useCallback(
    (action: EditAction) => {
      // 编辑时自动暂停，避免媒体继续播放导致预览与新的时间线错位。
      pause();
      sessionDispatch({ action, type: 'edit' });
    },
    [pause],
  );

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

  const toggleWaveforms = () => {
    const next = !waveformsVisible;

    setWaveformsVisible(next);
    notify(`波形已${next ? '开启' : '关闭'}。`);
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

  const clipStyle = (clip: TimelineTrackClip) => {
    const startPercent = secondsToPercent(clip.startSeconds, spanSeconds);
    const widthPercent = secondsToPercent(clip.endSeconds - clip.startSeconds, spanSeconds);
    const drag = clipDrag?.clipId === clip.id ? clipDrag : null;

    if (!drag || spanSeconds <= 0) {
      return { left: `${startPercent}%`, width: `${widthPercent}%` };
    }

    // 拖动过程中只做视觉预览，松手后才提交一次可撤销的编辑。
    const deltaPercent = (drag.deltaMs / 1_000 / spanSeconds) * 100;

    if (drag.mode === 'move') {
      return {
        left: `${startPercent + deltaPercent}%`,
        width: `${widthPercent}%`,
      };
    }

    if (drag.mode === 'trim-start') {
      return {
        left: `${startPercent + deltaPercent}%`,
        width: `${Math.max(0, widthPercent - deltaPercent)}%`,
      };
    }

    return {
      left: `${startPercent}%`,
      width: `${Math.max(0, widthPercent + deltaPercent)}%`,
    };
  };

  const clipPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // 片段点击只负责选中，不触发轨道空白处的 seek / 拖动播放头。
    event.stopPropagation();
  };

  const handleClipClick = (clip: TimelineTrackClip) => {
    // 拖动结束后浏览器仍会派发 click，这里吞掉一次，避免误选中。
    if (suppressClickRef.current) {
      return;
    }

    selectClip(clip);
  };

  const resetSceneDrag = useCallback(() => {
    dragRef.current = null;
    setDraggingSceneId(null);
    setDropIndex(null);
  }, []);

  const beginSceneDrag = (event: ReactPointerEvent<HTMLElement>, clip: TimelineTrackClip) => {
    // 片段上的指针事件不再冒泡到轨道，否则按下视频块会同时拖动播放头。
    event.stopPropagation();

    if (session.readonly || event.button !== 0 || !clip.sceneId) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const currentIndex = Math.max(
      0,
      view.scenes.findIndex((scene) => scene.id === clip.sceneId),
    );

    dragRef.current = {
      moved: false,
      pointerId: event.pointerId,
      sceneId: clip.sceneId,
      targetIndex: currentIndex,
    };
    setDraggingSceneId(clip.sceneId);
    setDropIndex(currentIndex);
  };

  const moveSceneDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const rect = rulerTrackRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const target = reorderTargetIndex(
      view.scenes,
      drag.sceneId,
      clientXToTime(event.clientX, rect, spanSeconds),
    );

    if (target === null) {
      return;
    }

    drag.moved = true;
    drag.targetIndex = target;
    setDropIndex(target);
  };

  const endSceneDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const { moved, sceneId, targetIndex } = drag;

    resetSceneDrag();

    if (!moved) {
      return;
    }

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const currentIndex = view.scenes.findIndex((scene) => scene.id === sceneId);

    if (currentIndex >= 0 && currentIndex !== targetIndex) {
      performEdit({ sceneId, targetIndex, type: 'reorder-scene' });
    }
  };

  const beginTrimDrag = (event: ReactPointerEvent<HTMLElement>, clip: TimelineTrackClip) => {
    event.stopPropagation();

    if (session.readonly || event.button !== 0) {
      return;
    }

    const rect = rulerTrackRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    event.preventDefault();
    pause();
    event.currentTarget.setPointerCapture(event.pointerId);

    const clipDurationMs = Math.round((clip.endSeconds - clip.startSeconds) * 1_000);

    trimRef.current = {
      clipId: clip.id,
      deltaMs: 0,
      // 缩短至少保留 1ms；延长没有上游时长限制，source 不足由 applyEdit 拒绝。
      maxDeltaMs: 60_000,
      minDeltaMs: -Math.max(1, clipDurationMs - 1),
      pointerId: event.pointerId,
      startClientX: event.clientX,
      widthPx: rect.width,
    };
    setTrimPreview({ clipId: clip.id, deltaMs: 0 });
  };

  const moveTrimDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = trimRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const rawDeltaMs = Math.round(
      ((event.clientX - drag.startClientX) / drag.widthPx) * spanSeconds * 1_000,
    );

    drag.deltaMs = Math.min(drag.maxDeltaMs, Math.max(drag.minDeltaMs, rawDeltaMs));
    setTrimPreview({ clipId: drag.clipId, deltaMs: drag.deltaMs });
  };

  const endTrimDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = trimRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const { clipId, deltaMs } = drag;

    trimRef.current = null;
    setTrimPreview(null);

    if (deltaMs !== 0) {
      performEdit({ clipId, deltaMs, type: 'trim-video' });
    }
  };

  const cancelTrimDrag = () => {
    trimRef.current = null;
    setTrimPreview(null);
  };

  const splitAtPlayhead = () => {
    performEdit({ atMs: Math.round(currentTime * 1_000), type: 'split-video' });
  };

  const resetClipDrag = useCallback(() => {
    clipDragRef.current = null;
    setClipDrag(null);
  }, []);

  /**
   * 字幕/音乐片段的拖动：`move` 整体平移，`trim-start`/`trim-end` 拖左右边缘。
   * 拖动中只更新视觉预览，松手时才提交一次编辑，保证撤销栈里只有一个步骤。
   */
  const beginClipDrag = (
    event: ReactPointerEvent<HTMLElement>,
    clip: TimelineTrackClip,
    mode: ClipDragMode,
  ) => {
    event.stopPropagation();

    if (session.readonly || event.button !== 0 || !event.isPrimary) {
      return;
    }

    if (clip.kind !== 'subtitle' && clip.kind !== 'music') {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    selectClip(clip);
    clipDragRef.current = {
      clipId: clip.id,
      deltaMs: 0,
      kind: clip.kind,
      mode,
      originClientX: event.clientX,
      pointerId: event.pointerId,
    };
    setClipDrag({ clipId: clip.id, deltaMs: 0, kind: clip.kind, mode });
  };

  const moveClipDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = clipDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const rect = rulerTrackRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const deltaMs = Math.round(
      ((event.clientX - drag.originClientX) / rect.width) * spanSeconds * 1_000,
    );

    drag.deltaMs = deltaMs;
    setClipDrag({ clipId: drag.clipId, deltaMs, kind: drag.kind, mode: drag.mode });
  };

  const endClipDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = clipDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    resetClipDrag();

    if (drag.deltaMs === 0) {
      return;
    }

    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    if (drag.mode === 'move') {
      performEdit({
        clipId: drag.clipId,
        deltaMs: drag.deltaMs,
        type: drag.kind === 'music' ? 'move-music-clip' : 'move-subtitle-clip',
      });
      return;
    }

    performEdit({
      clipId: drag.clipId,
      deltaMs: drag.deltaMs,
      edge: drag.mode === 'trim-start' ? 'start' : 'end',
      type: drag.kind === 'music' ? 'trim-music-clip' : 'trim-subtitle-clip',
    });
  };

  /** 按片段当前时间线/source 区间取真实峰值；未加载或失败时交给占位渲染。 */
  const waveformForClip = (clip: TimelineTrackClip): ClipWaveformState => {
    const asset = audioAssetsById.get(clip.assetId);

    if (!asset) {
      return { bars: null, state: 'failed' };
    }

    const peaks = waveforms.get(clip.assetId);

    if (peaks === undefined) {
      return { bars: null, state: 'loading' };
    }

    if (peaks === null) {
      return { bars: null, state: 'failed' };
    }

    const startMs = Math.round(clip.startSeconds * 1_000);
    const endMs = Math.round(clip.endSeconds * 1_000);
    const values =
      clip.kind === 'music'
        ? sampleMusicWaveform(peaks, asset.durationMs, {
            endMs,
            loop: clip.loop ?? false,
            sourceEndMs: clip.sourceEndMs ?? asset.durationMs,
            sourceStartMs: clip.sourceStartMs ?? 0,
            startMs,
          })
        : sampleVoiceWaveform(peaks, asset.durationMs, { endMs, startMs });

    return { bars: waveformBars(values), state: 'ready' };
  };

  const deleteSelectedClip = useCallback(() => {
    const selected = selection.clip;

    if (session.readonly) {
      notify('编辑器只读，无法删除片段。');
      return;
    }

    if (!selected) {
      notify('先在时间线上选中要删除的片段。');
      return;
    }

    if (selected.kind !== 'subtitle' && selected.kind !== 'music') {
      notify('视频和配音跟随分镜，不能单独删除。');
      return;
    }

    performEdit({
      clipId: selected.id,
      type: selected.kind === 'music' ? 'delete-music-clip' : 'delete-subtitle-clip',
    });

    if (selection.sceneId) {
      dispatch({ sceneId: selection.sceneId, type: 'select-scene' });
    }
  }, [notify, performEdit, selection.clip, selection.sceneId, session.readonly]);

  const splitSelectedMusic = useCallback(() => {
    const selected = selection.clip;

    if (session.readonly) {
      notify('编辑器只读，无法分割片段。');
      return;
    }

    if (!selected || selected.kind !== 'music') {
      notify('先在时间线上选中一段音乐，再在播放头处分割。');
      return;
    }

    pause();
    performEdit({
      atMs: Math.round(currentTime * 1_000),
      clipId: selected.id,
      type: 'split-music-clip',
    });
  }, [currentTime, notify, pause, performEdit, selection.clip, session.readonly]);

  const canEditSelectedClip =
    !session.readonly && (selection.clip?.kind === 'subtitle' || selection.clip?.kind === 'music');

  /**
   * Delete / Backspace 的统一路由：字幕、音乐走各自的删除动作；
   * 视频/配音走通用 `delete-clip`（编辑管线会拒绝）；没有选中片段时删除当前分镜。
   */
  const deleteSelection = useCallback(() => {
    const selected = selection.clip;

    if (!selected) {
      if (!selection.sceneId || session.readonly) {
        return;
      }

      performEdit({ sceneId: selection.sceneId, type: 'remove-scene' });
      return;
    }

    if (session.readonly) {
      notify('编辑器只读，无法删除片段。');
      return;
    }

    if (selected.kind === 'subtitle' || selected.kind === 'music') {
      deleteSelectedClip();
      return;
    }

    performEdit({ clipId: selected.id, type: 'delete-clip' });
  }, [
    deleteSelectedClip,
    notify,
    performEdit,
    selection.clip,
    selection.sceneId,
    session.readonly,
  ]);

  // Delete / Backspace 删除选中的片段或分镜；输入框内不拦截。
  useEffect(() => {
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        return;
      }

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener('keydown', handleDeleteKey);

    return () => {
      window.removeEventListener('keydown', handleDeleteKey);
    };
  }, [deleteSelection]);

  const dropIndicatorSeconds =
    dropIndex === null ? null : (view.scenes[dropIndex]?.startSeconds ?? spanSeconds);

  /** 左右裁剪手柄：只读时隐藏；指针事件由片段拖动状态机处理。 */
  const renderTrimHandles = (clip: TimelineTrackClip, label: string) => {
    if (session.readonly) {
      return null;
    }

    return (
      <>
        <span
          aria-hidden="true"
          className="ed-trim-handle ed-trim-start"
          title={`拖动裁剪${label}起点`}
          onPointerCancel={resetClipDrag}
          onPointerDown={(event) => beginClipDrag(event, clip, 'trim-start')}
          onPointerMove={moveClipDrag}
          onPointerUp={endClipDrag}
        />
        <span
          aria-hidden="true"
          className="ed-trim-handle ed-trim-end"
          title={`拖动裁剪${label}终点`}
          onPointerCancel={resetClipDrag}
          onPointerDown={(event) => beginClipDrag(event, clip, 'trim-end')}
          onPointerMove={moveClipDrag}
          onPointerUp={endClipDrag}
        />
      </>
    );
  };

  const renderTrackClip = (track: EditorTrackView, clip: TimelineTrackClip, index: number) => {
    const selected = isClipSelected(clip);
    const activeClass = selected ? ' is-active' : '';
    const shared = {
      'aria-pressed': selected,
      onClick: () => handleClipClick(clip),
      onPointerDown: clipPointerDown,
      style: clipStyle(clip),
      type: 'button' as const,
    };

    if (track.kind === 'video') {
      const tone = videoTone(index);
      const dragging = draggingSceneId !== null && draggingSceneId === clip.sceneId;
      const trimDeltaMs = trimPreview?.clipId === clip.id ? trimPreview.deltaMs : 0;
      const canTrim = !session.readonly && trailingVideoClipIds.has(clip.id);
      const barStyle =
        trimDeltaMs === 0
          ? { ...shared.style, background: tone.background, borderColor: tone.border }
          : {
              ...shared.style,
              background: tone.background,
              borderColor: tone.border,
              width: `${secondsToPercent(
                clip.endSeconds - clip.startSeconds + trimDeltaMs / 1_000,
                spanSeconds,
              )}%`,
            };

      return (
        <button
          key={clip.id}
          {...shared}
          className={`ed-timeline-clip ed-video-bar${activeClass}${dragging ? ' is-dragging' : ''}`}
          style={barStyle}
          title={`${clip.label}${clip.missing ? '（素材缺失）' : ''}`}
          onPointerDown={(event) => beginSceneDrag(event, clip)}
          onPointerMove={moveSceneDrag}
          onPointerUp={endSceneDrag}
          onPointerCancel={resetSceneDrag}
        >
          <span className="ed-bar-accent" style={{ background: tone.accent }} />
          <span className="ed-video-name">{clip.label}</span>
          {clip.missing ? <span className="ed-clip-badge is-missing">缺失</span> : null}
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
          {canTrim ? (
            <span
              aria-hidden="true"
              className="ed-trim-handle"
              title="拖动右边缘缩短或延长分镜"
              onPointerDown={(event) => beginTrimDrag(event, clip)}
              onPointerMove={moveTrimDrag}
              onPointerUp={endTrimDrag}
              onPointerCancel={cancelTrimDrag}
            />
          ) : null}
        </button>
      );
    }

    if (track.kind === 'voice') {
      return (
        <button
          key={clip.id}
          {...shared}
          className={`ed-timeline-clip ed-voice-bar${activeClass}`}
          title={`${clip.label}${clip.missing ? '（素材缺失）' : ''}`}
        >
          <span className="ed-voice-name">{clip.label}</span>
          {clip.badge ? <span className="ed-clip-badge">{clip.badge}</span> : null}
          {clip.missing ? <span className="ed-clip-badge is-missing">缺失</span> : null}
          {waveformsVisible ? <ClipWaveform {...waveformForClip(clip)} /> : null}
        </button>
      );
    }

    if (track.kind === 'subtitle') {
      return (
        <div key={clip.id} className={`ed-clip-slot${activeClass}`} style={clipStyle(clip)}>
          <button
            aria-pressed={selected}
            className={`ed-timeline-clip ed-subtitle-bar${activeClass}`}
            onClick={() => handleClipClick(clip)}
            onPointerCancel={resetClipDrag}
            onPointerDown={(event) => beginClipDrag(event, clip, 'move')}
            onPointerMove={moveClipDrag}
            onPointerUp={endClipDrag}
            title={clip.text ?? clip.label}
            type="button"
          >
            <EditorIcon name="subtitles" size={16} />
            <span className="ed-subtitle-text">{clip.text ?? clip.label}</span>
          </button>
          {renderTrimHandles(clip, '字幕')}
        </div>
      );
    }

    return (
      <div key={clip.id} className={`ed-clip-slot${activeClass}`} style={clipStyle(clip)}>
        <button
          aria-pressed={selected}
          className={`ed-timeline-clip ed-tl-music-bar${activeClass}`}
          onClick={() => handleClipClick(clip)}
          onPointerCancel={resetClipDrag}
          onPointerDown={(event) => beginClipDrag(event, clip, 'move')}
          onPointerMove={moveClipDrag}
          onPointerUp={endClipDrag}
          title={`${clip.label}${clip.missing ? '（素材缺失）' : ''}`}
          type="button"
        >
          <span className="ed-bar-accent" style={{ background: 'var(--ed-blue)' }} />
          <EditorIcon name="music" size={15} />
          <span className="ed-tl-music-name">{clip.label}</span>
          {clip.missing ? <span className="ed-clip-badge is-missing">缺失</span> : null}
          {clip.loop ? <span className="ed-clip-badge">循环</span> : null}
          {clip.artist ? <span className="ed-tl-music-artist">{clip.artist}</span> : null}
          {waveformsVisible ? <ClipWaveform {...waveformForClip(clip)} /> : null}
        </button>
        {renderTrimHandles(clip, '音乐')}
      </div>
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
          title="返回创作页"
          onClick={() => {
            window.location.hash = '#/create';
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
          <div
            className={`ed-save ed-save-${saveStatusView.kind}`}
            role="status"
            aria-live="polite"
            title={session.lastSaveError ?? undefined}
          >
            <span className="ed-save-dot" aria-hidden="true" />
            <span>{saveStatusView.label}</span>
            {session.saveStatus === 'conflict' ? (
              <button className="ed-save-reload" type="button" onClick={() => void reloadProject()}>
                重新加载
              </button>
            ) : null}
          </div>

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

      {session.readonly ? (
        <div className="ed-readonly-banner" role="status">
          <EditorIcon name="lock" size={14} />
          {readonlyMessage ?? 'AI 工作流正在运行或等待审批，编辑器暂时只读。'}
        </div>
      ) : null}

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
            hasMusicTrack={hasMusicTrack}
            hasVoiceTrack={hasVoiceTrack}
            missingMedia={missingMedia}
            muted={muted}
            plan={previewPlan}
            playing={playing}
            projectId={view.projectId}
            stageRef={stageRef}
            subtitle={subtitleOverlay}
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
              <div className="ed-right-date">{view.updatedLabel}</div>

              <div className="ed-right-scroll-wrap">
                <div className="ed-right-scroll" ref={scrollRef}>
                  {selectedScene ? (
                    <>
                      <div className="ed-context">
                        <div className="ed-context-head">
                          <span className="ed-context-title">
                            {selectedScene.rangeLabel} {selectedScene.heading}
                          </span>
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
                            <p className="ed-context-summary">{selectedScene.script}</p>
                            <div className="ed-context-divider" />
                            <div className="ed-context-tags">
                              {selectedScene.tags.map((tag) => (
                                <div key={tag.label} className="ed-tag-row">
                                  <span className="ed-tag ed-tag-label">{tag.label}</span>
                                  <span className="ed-tag ed-tag-value">{tag.value}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : null}
                      </div>

                      {selectedScene.analysis ? (
                        <p className="ed-analysis">{selectedScene.analysis}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="ed-right-empty">左侧选择一个分镜，查看画面上下文。</p>
                  )}
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
                  <span>
                    快捷调整
                    <span className="ed-followup-chip">后续</span>
                  </span>
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
                      disabled
                      placeholder="快捷调整将在 T20 接入"
                      aria-label="快捷调整（后续版本开放）"
                      title="快捷调整将在 T20 接入"
                    />

                    <div className="ed-quick-actions">
                      <span className="ed-quick-chip">
                        <EditorIcon name="link" size={14} />
                        {selectedName}
                        <button
                          className="ed-quick-unlink"
                          type="button"
                          disabled
                          aria-label="解除分镜关联（后续版本开放）"
                          title="解除关联将在后续版本开放"
                        >
                          <EditorIcon name="close" size={12} />
                        </button>
                      </span>
                      <button
                        className="ed-quick-send"
                        type="button"
                        disabled
                        aria-label="发送快捷调整（后续版本开放）"
                        title="快捷调整将在 T20 接入"
                      >
                        <EditorIcon name="send" size={19} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : activeRail === 'voice' ? (
            <VoicePanel />
          ) : activeRail === 'subtitle' ? (
            <SubtitlePanel />
          ) : (
            <MusicPanel />
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
                disabled={!canUndoSession(session)}
                onClick={() => sessionDispatch({ type: 'undo' })}
              >
                <EditorIcon name="undo" size={16} />
              </button>
              <button
                className="ed-icon-button"
                type="button"
                aria-label="重做"
                disabled={!canRedoSession(session)}
                onClick={() => sessionDispatch({ type: 'redo' })}
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
              title="在播放头处分割视频片段"
              disabled={session.readonly}
              onClick={splitAtPlayhead}
            >
              <EditorIcon name="split" size={15} />
            </button>

            <button
              className="ed-icon-button"
              type="button"
              aria-label="在播放头处分割音乐"
              title="在播放头处分割选中的音乐片段"
              disabled={session.readonly}
              onClick={splitSelectedMusic}
            >
              <EditorIcon name="split" size={15} />
            </button>

            <button
              className="ed-icon-button"
              type="button"
              aria-label="删除选中的字幕或音乐片段"
              title="删除选中的字幕或音乐片段（Delete）"
              disabled={!canEditSelectedClip}
              onClick={deleteSelectedClip}
            >
              <EditorIcon name="trash" size={15} />
            </button>

            {TIMELINE_TOOLS.map((tool) =>
              tool.future ? (
                <button
                  key={tool.id}
                  className="ed-icon-button"
                  type="button"
                  aria-label={tool.label}
                  title={`${tool.label}将在后续版本提供`}
                  disabled
                >
                  <EditorIcon name={tool.icon} size={15} />
                </button>
              ) : (
                <button
                  key={tool.id}
                  className={`ed-icon-button${waveformsVisible ? ' is-active' : ''}`}
                  type="button"
                  aria-label={tool.label}
                  aria-pressed={waveformsVisible}
                  title="显示或隐藏真实波形"
                  onClick={toggleWaveforms}
                >
                  <EditorIcon name={tool.icon} size={15} />
                </button>
              ),
            )}

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
              title="新增轨道将在后续版本提供"
              disabled
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

            {dropIndicatorSeconds !== null ? (
              <div aria-hidden="true" className="ed-drop-layer">
                <div
                  className="ed-drop-indicator"
                  style={{ left: `${secondsToPercent(dropIndicatorSeconds, spanSeconds)}%` }}
                />
              </div>
            ) : null}
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
