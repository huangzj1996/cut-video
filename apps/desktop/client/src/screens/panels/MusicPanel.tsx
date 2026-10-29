import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MusicAsset, VideoProject } from '@miaoma/video-project';
import type { MusicLibraryResult, MusicLibraryTrack } from '../../../../shared/ipc-contract';
import { EditorIcon } from '../editor-icons';
import { DEFAULT_MUSIC_VOLUME, type EditAction } from '../editor-video/project-edit';
import './music-panel.css';

/**
 * 音乐面板：内置本地音乐库 + 当前音乐 + 音量 + 开关。
 *
 * 数据源是主进程读取的内置音乐库；点选曲目会变成一次可撤销的编辑动作，
 * 走编辑器的自动保存与只读拦截。面板本身不直接改工程文档。
 */

interface MusicPanelProps {
  onEdit: (action: EditAction) => void;
  onNotice: (message: string) => void;
  onVolumeCommit: (volume: number) => void;
  onVolumePreview: (volume: number | null) => void;
  project: VideoProject;
  readonly: boolean;
}

type LibraryState =
  | { status: 'error'; message: string }
  | { status: 'loading' }
  | { result: MusicLibraryResult; status: 'ready' };

const COVER_GRADIENTS = [
  'linear-gradient(135deg, #f05f73 0%, #f6b84b 48%, #8b6af7 100%)',
  'linear-gradient(135deg, #d9a36f 0%, #7a5cf2 100%)',
  'linear-gradient(135deg, #25d0b1 0%, #5b8cff 100%)',
  'linear-gradient(135deg, #5b8cff 0%, #8b6af7 100%)',
  'linear-gradient(135deg, #f6b84b 0%, #e43d30 100%)',
  'linear-gradient(135deg, #e43d30 0%, #111214 100%)',
] as const;

function gradientFor(index: number): string {
  return COVER_GRADIENTS[index % COVER_GRADIENTS.length]!;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function fileNameOf(filePath: string): string {
  const match = /[^/\\]+$/.exec(filePath);

  return match ? match[0] : filePath;
}

function trackMetaLine(item: MusicLibraryTrack): string {
  if (!item.available) {
    return item.unavailableReason ?? '不可用';
  }

  return [item.mood, item.tempo].filter((part): part is string => Boolean(part)).join(' · ');
}

/** 面板加载内置音乐库；库不可用时只影响列表与开关提示，不影响工程编辑。 */
function useMusicLibrary(): LibraryState {
  const [state, setState] = useState<LibraryState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const api = window.miaoma?.music;

    if (!api) {
      setState({ message: '音乐库不可用：缺少桌面桥接。', status: 'error' });
      return;
    }

    void api
      .listLibrary()
      .then((response) => {
        if (!active) {
          return;
        }

        setState(
          response.ok
            ? { result: response.data, status: 'ready' }
            : { message: response.error.message, status: 'error' },
        );
      })
      .catch(() => {
        if (active) {
          setState({ message: '读取本地音乐库失败。', status: 'error' });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}

export function MusicPanel({
  onEdit,
  onNotice,
  onVolumeCommit,
  onVolumePreview,
  project,
  readonly,
}: MusicPanelProps) {
  const library = useMusicLibrary();
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const volumeDraftRef = useRef<number | null>(null);

  const musicTrack = project.tracks.find((track) => track.kind === 'music');
  const musicClips = musicTrack?.clips ?? [];
  const hasMusic = musicClips.length > 0;
  const visible = musicTrack?.visible ?? true;
  const currentAssetId = musicClips[0]?.assetId;
  const currentAsset = project.assets.music.find((asset) => asset.id === currentAssetId);
  const currentVolume = musicClips[0]?.volume ?? 1;
  const items = library.status === 'ready' ? library.result.items : [];
  const currentLibraryTrack = currentAsset
    ? items.find((item) => item.path === currentAsset.path)
    : undefined;
  const currentMissing = currentLibraryTrack ? !currentLibraryTrack.available : false;
  const canWrite = !readonly;
  const shownVolumePercent = volumeDraft ?? Math.round(currentVolume * 100);
  const availableCount = items.filter((item) => item.available).length;

  // 面板卸载（切到别的 rail）时清掉拖动中的试听音量覆盖。
  useEffect(() => {
    return () => {
      onVolumePreview(null);
    };
  }, [onVolumePreview]);

  const addTrack = async (item: MusicLibraryTrack) => {
    if (!canWrite) {
      onNotice('编辑器只读，暂不能修改音乐。');
      return;
    }

    if (!item.available || item.durationMs === null) {
      return;
    }

    if (currentAsset?.path === item.path) {
      onNotice('这首音乐已经在时间线上了。');
      return;
    }

    const assetId = `music-${crypto.randomUUID()}`;
    const asset: MusicAsset = {
      durationMs: item.durationMs,
      id: assetId,
      path: item.path,
      title: item.title,
    };
    const musicApi = window.miaoma?.music;

    // 新素材还没随工程保存：先让主进程知道 assetId → 路径，预览才能立即加载。
    if (musicApi) {
      try {
        const response = await musicApi.registerAsset({
          assetId,
          path: item.path,
          projectId: project.project.projectId,
        });

        if (!response.ok) {
          onNotice('无法准备音乐预览，请稍后重试。');
          return;
        }
      } catch {
        onNotice('无法准备音乐预览，请稍后重试。');
        return;
      }
    }

    onEdit({
      asset,
      type: 'add-music',
      volume: hasMusic ? currentVolume : DEFAULT_MUSIC_VOLUME,
    });
  };

  const toggleVisible = () => {
    if (!canWrite || !hasMusic) {
      return;
    }

    onEdit({ type: 'set-music-visible', visible: !visible });
  };

  const removeMusic = () => {
    if (!canWrite || !hasMusic) {
      return;
    }

    onVolumePreview(null);
    setVolumeDraft(null);
    volumeDraftRef.current = null;
    onEdit({ type: 'remove-music' });
  };

  const previewVolume = (percent: number) => {
    if (!canWrite || !hasMusic) {
      return;
    }

    volumeDraftRef.current = percent;
    setVolumeDraft(percent);
    onVolumePreview(percent / 100);
  };

  const commitVolume = () => {
    const percent = volumeDraftRef.current;

    if (percent === null) {
      return;
    }

    volumeDraftRef.current = null;
    setVolumeDraft(null);
    onVolumePreview(null);

    if (!canWrite || !hasMusic) {
      return;
    }

    const next = percent / 100;

    if (Math.abs(next - currentVolume) > 0.0001) {
      onVolumeCommit(next);
    }
  };

  const currentTitle =
    currentAsset?.title ??
    currentLibraryTrack?.title ??
    (currentAsset ? fileNameOf(currentAsset.path) : '');
  const currentMeta = currentLibraryTrack
    ? [currentLibraryTrack.mood, currentLibraryTrack.tempo]
        .filter((part): part is string => Boolean(part))
        .join(' · ')
    : '';
  const currentCoverIndex = Math.max(
    0,
    items.findIndex((item) => item.path === currentAsset?.path),
  );

  return (
    <div className={`ed-panel ed-music-panel${hasMusic && !visible ? ' is-off' : ''}`}>
      <div className="ed-music-scroll">
        <header className="ed-music-head">
          <div className="ed-music-title-group">
            <h2 className="ed-music-title">音乐设置</h2>
            <p className="ed-music-subtitle">从本地音乐库挑选背景音乐</p>
            {readonly ? (
              <p className="ed-music-hint" role="note">
                编辑器只读，音乐设置暂不可修改。
              </p>
            ) : null}
          </div>

          <div className="ed-music-switch-group">
            <span className="ed-music-switch-label">开启</span>
            <button
              aria-checked={hasMusic && visible}
              aria-label={hasMusic && visible ? '关闭背景音乐' : '开启背景音乐'}
              className={`ed-music-switch${hasMusic && visible ? ' is-on' : ''}`}
              disabled={!hasMusic || !canWrite}
              onClick={toggleVisible}
              role="switch"
              title={
                !hasMusic
                  ? '先从本地音乐库添加一首音乐'
                  : !canWrite
                    ? '编辑器只读，暂不能修改音乐'
                    : hasMusic && visible
                      ? '关闭背景音乐（保留片段与音量）'
                      : '开启背景音乐'
              }
              type="button"
            >
              <span className="ed-music-switch-knob" />
            </button>
          </div>
        </header>

        <section
          aria-labelledby="ed-music-current-title"
          className="ed-music-card ed-music-current"
        >
          <div className="ed-music-card-head">
            <h3 className="ed-music-card-title" id="ed-music-current-title">
              当前音乐
            </h3>
            {hasMusic ? (
              <button
                className="ed-music-action"
                disabled={!canWrite}
                onClick={removeMusic}
                title={canWrite ? '移除当前音乐' : '编辑器只读，暂不能修改音乐'}
                type="button"
              >
                移除
              </button>
            ) : null}
          </div>

          {currentAsset ? (
            <div className="ed-music-current-body">
              <span
                className="ed-music-current-cover"
                style={{ backgroundImage: gradientFor(currentCoverIndex) }}
              >
                <EditorIcon name="music" size={22} />
              </span>
              <span className="ed-music-current-info">
                <span className="ed-music-current-name">{currentTitle}</span>
                <span className="ed-music-current-artist">
                  {currentMeta || (currentMissing ? '音乐库中已找不到该文件' : '本地音乐库')}
                </span>
                <span className="ed-music-current-meta">
                  {formatClock(currentAsset.durationMs)}
                  {hasMusic && !visible ? ' · 已关闭' : ' · 使用中'}
                  {currentMissing ? ' · 文件缺失' : ''}
                </span>
              </span>
            </div>
          ) : hasMusic ? (
            <div className="ed-music-current-body">
              <span className="ed-music-current-cover is-empty">
                <EditorIcon name="music" size={22} />
              </span>
              <span className="ed-music-current-info">
                <span className="ed-music-current-name">当前音乐素材缺失</span>
                <span className="ed-music-current-artist">可以移除后重新从本地音乐库选择</span>
              </span>
            </div>
          ) : (
            <div className="ed-music-current-body">
              <span className="ed-music-current-cover is-empty">
                <EditorIcon name="music" size={22} />
              </span>
              <span className="ed-music-current-info">
                <span className="ed-music-current-name">尚未选择背景音乐</span>
                <span className="ed-music-current-artist">从下方本地音乐库选择曲目并应用</span>
              </span>
            </div>
          )}
        </section>

        <section aria-labelledby="ed-music-volume-title" className="ed-music-card ed-music-volume">
          <div className="ed-music-card-head">
            <h3 className="ed-music-volume-title" id="ed-music-volume-title">
              <EditorIcon name="volume" size={16} />
              <span>音乐音量</span>
            </h3>
            <span className="ed-music-volume-value">{shownVolumePercent}%</span>
          </div>

          <input
            aria-label="音乐音量"
            className="ed-music-range"
            disabled={!hasMusic || !canWrite}
            max={100}
            min={0}
            onBlur={commitVolume}
            onChange={(event) => previewVolume(Number(event.target.value))}
            onKeyUp={commitVolume}
            onPointerUp={commitVolume}
            step={1}
            style={{ '--music-progress': `${shownVolumePercent}%` } as CSSProperties}
            title={
              !hasMusic
                ? '先添加背景音乐'
                : !canWrite
                  ? '编辑器只读，暂不能调整音乐'
                  : '拖动调整背景音乐音量'
            }
            type="range"
            value={shownVolumePercent}
          />
        </section>

        <section
          aria-labelledby="ed-music-library-title"
          className="ed-music-card ed-music-recommend"
        >
          <div className="ed-music-card-head">
            <h3 className="ed-music-card-title" id="ed-music-library-title">
              本地音乐
            </h3>
            {library.status === 'ready' ? (
              <span className="ed-music-count">{availableCount} 首可用</span>
            ) : null}
          </div>

          <div className="ed-music-list">
            {library.status === 'loading' ? (
              <p className="ed-music-empty">正在读取本地音乐库…</p>
            ) : library.status === 'error' ? (
              <p className="ed-music-empty">{library.message}</p>
            ) : items.length === 0 ? (
              <p className="ed-music-empty">
                本地音乐库为空，请把音频文件放入应用资源目录的 song 文件夹。
              </p>
            ) : (
              items.map((item, index) => {
                const using = item.path === currentAsset?.path;
                const disabled = !canWrite || !item.available;

                return (
                  <button
                    aria-pressed={using}
                    className={`ed-music-item${using ? ' is-selected' : ''}`}
                    disabled={disabled}
                    key={item.path}
                    onClick={() => {
                      void addTrack(item);
                    }}
                    title={
                      !item.available
                        ? (item.unavailableReason ?? '该曲目不可用')
                        : !canWrite
                          ? '编辑器只读，暂不能修改音乐'
                          : using
                            ? '这首音乐已经在时间线上了'
                            : '点击应用这首背景音乐'
                    }
                    type="button"
                  >
                    <span
                      className="ed-music-item-cover"
                      style={{ backgroundImage: gradientFor(index) }}
                    >
                      <EditorIcon name="music" size={15} />
                    </span>
                    <span className="ed-music-item-info">
                      <span className="ed-music-item-title-row">
                        <span className="ed-music-item-title">{item.title}</span>
                        {using ? <span className="ed-music-item-using">使用中</span> : null}
                        <span className="ed-music-item-duration">
                          {item.durationMs === null ? '—' : formatClock(item.durationMs)}
                        </span>
                      </span>
                      <span className="ed-music-item-meta-row">
                        <span className="ed-music-item-artist">{trackMetaLine(item)}</span>
                        {item.scenes[0] ? (
                          <span className="ed-music-item-style">{item.scenes[0]}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
