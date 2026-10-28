import type { CSSProperties } from 'react';
import { EditorIcon } from '../editor-icons';
import './music-panel.css';

/**
 * 音乐面板首版保持 mock：推荐曲库与音量只展示，写操作全部禁用并标注"后续"，
 * 不上传、不应用、不写工程。
 */

type MusicCategory = '平静' | '欢快' | '励志';
type MusicFilter = '全部' | MusicCategory;

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  artistLine: string;
  metaLine: string;
  category: MusicCategory;
  mood: string;
  duration: string;
  gradient: string;
  listGradient?: string;
}

const TRACKS: readonly MusicTrack[] = [
  {
    id: 'eutopia',
    title: 'Eutopia',
    artist: 'Mika Chen',
    artistLine: 'Mika Chen · 平静 / 社会题材',
    metaLine: '偏慢 · 02:01 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 偏慢',
    duration: '02:01',
    gradient: 'linear-gradient(135deg, #f05f73 0%, #f6b84b 48%, #8b6af7 100%)',
    listGradient: 'linear-gradient(135deg, #f05f73 0%, #8b6af7 100%)',
  },
  {
    id: 'canon',
    title: '卡农（经典钢琴版）',
    artist: 'Aiden Lin',
    artistLine: 'Aiden Lin · 平静 / 通用题材',
    metaLine: '偏快 · 01:43 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 偏快',
    duration: '01:43',
    gradient: 'linear-gradient(135deg, #d9a36f 0%, #7a5cf2 100%)',
  },
  {
    id: 'daily',
    title: '通用 日常 平和',
    artist: 'Nova Lab',
    artistLine: 'Nova Lab · 平静 / 通用题材',
    metaLine: '适中 · 00:20 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 适中',
    duration: '00:20',
    gradient: 'linear-gradient(135deg, #e43d30 0%, #111214 100%)',
  },
  {
    id: 'ylang',
    title: 'Ylang Ylang',
    artist: 'Mika Chen',
    artistLine: 'Mika Chen · 平静 / 财经题材',
    metaLine: '偏慢 · 03:33 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 偏慢',
    duration: '03:33',
    gradient: 'linear-gradient(135deg, #5b8cff 0%, #8b6af7 100%)',
  },
  {
    id: 'healing',
    title: '温馨治愈音乐之一',
    artist: 'Mika Chen',
    artistLine: 'Mika Chen · 平静 / 社会题材',
    metaLine: '偏快 · 00:57 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 偏快',
    duration: '00:57',
    gradient: 'linear-gradient(135deg, #f6b84b 0%, #f05f73 100%)',
  },
  {
    id: 'treasure',
    title: 'My Treasure',
    artist: 'Nova Lab',
    artistLine: 'Nova Lab · 平静 / 通用题材',
    metaLine: '偏快 · 01:25 · 已对齐时间线',
    category: '平静',
    mood: '平静 · 偏快',
    duration: '01:25',
    gradient: 'linear-gradient(135deg, #25d0b1 0%, #5b8cff 100%)',
  },
  {
    id: 'bright-day',
    title: '活力日常',
    artist: 'Nova Lab',
    artistLine: 'Nova Lab · 欢快 / 日常题材',
    metaLine: '明快 · 01:12 · 已对齐时间线',
    category: '欢快',
    mood: '欢快 · 明快',
    duration: '01:12',
    gradient: 'linear-gradient(135deg, #f6b84b 0%, #e43d30 100%)',
  },
  {
    id: 'grow-up',
    title: '向上生长',
    artist: 'Aiden Lin',
    artistLine: 'Aiden Lin · 励志 / 成长题材',
    metaLine: '坚定 · 02:10 · 已对齐时间线',
    category: '励志',
    mood: '励志 · 坚定',
    duration: '02:10',
    gradient: 'linear-gradient(135deg, #5b8cff 0%, #25d0b1 100%)',
  },
];

const FILTERS: readonly MusicFilter[] = ['全部', '平静', '欢快', '励志'];

const CURRENT_FILTER: MusicFilter = '平静';
const CURRENT_TRACK_ID = 'eutopia';
const CURRENT_VOLUME = 60;

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={12}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.5}
      viewBox="0 0 12 12"
      width={12}
    >
      <path d="M1.5 3h9" />
      <path d="M3.5 6h5" />
      <path d="M5.5 9h1" />
    </svg>
  );
}

export function MusicPanel() {
  const selectedTrack = TRACKS.find((track) => track.id === CURRENT_TRACK_ID) ?? null;
  const visibleTracks =
    CURRENT_FILTER === '全部'
      ? TRACKS
      : TRACKS.filter((track) => track.category === CURRENT_FILTER);

  return (
    <div className="ed-panel ed-music-panel">
      <div className="ed-music-scroll">
        <header className="ed-music-head">
          <div className="ed-music-title-group">
            <h2 className="ed-music-title">音乐设置</h2>
            <p className="ed-music-subtitle">控制背景音乐与推荐曲库</p>
            <p className="ed-panel-followup" role="note">
              <span className="ed-followup-chip">后续</span>
              本轮只读：导入、应用与音量调整将在后续版本开放。
            </p>
          </div>

          <div className="ed-music-switch-group">
            <span className="ed-music-switch-label">开启</span>
            <button
              className="ed-music-switch is-on"
              type="button"
              role="switch"
              aria-checked
              aria-label="背景音乐开关（后续版本开放）"
              title="背景音乐开关将在后续版本开放"
              disabled
            >
              <span className="ed-music-switch-knob" />
            </button>
          </div>
        </header>

        <section
          className="ed-music-card ed-music-current"
          aria-labelledby="ed-music-current-title"
        >
          <div className="ed-music-card-head">
            <h3 id="ed-music-current-title" className="ed-music-card-title">
              当前音乐
            </h3>
          </div>

          {selectedTrack ? (
            <div className="ed-music-current-body">
              <span
                className="ed-music-current-cover"
                style={{ backgroundImage: selectedTrack.gradient }}
              >
                <EditorIcon name="music" size={22} />
              </span>
              <span className="ed-music-current-info">
                <span className="ed-music-current-name">{selectedTrack.title}</span>
                <span className="ed-music-current-artist">{selectedTrack.artistLine}</span>
                <span className="ed-music-current-meta">{selectedTrack.metaLine}</span>
              </span>
            </div>
          ) : (
            <div className="ed-music-current-body">
              <span className="ed-music-current-cover is-empty">
                <EditorIcon name="music" size={22} />
              </span>
              <span className="ed-music-current-info">
                <span className="ed-music-current-name">尚未选择背景音乐</span>
                <span className="ed-music-current-artist">从推荐列表选择曲目并应用</span>
              </span>
            </div>
          )}
        </section>

        <section className="ed-music-card ed-music-volume" aria-labelledby="ed-music-volume-title">
          <div className="ed-music-card-head">
            <h3 id="ed-music-volume-title" className="ed-music-volume-title">
              <EditorIcon name="volume" size={16} />
              <span>音乐音量</span>
            </h3>
            <span className="ed-music-volume-value">{CURRENT_VOLUME}%</span>
          </div>

          <input
            className="ed-music-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={CURRENT_VOLUME}
            disabled
            aria-label="音乐音量（后续版本开放）"
            title="音乐音量调整将在后续版本开放"
            style={{ '--music-progress': `${CURRENT_VOLUME}%` } as CSSProperties}
          />
        </section>

        <section
          className="ed-music-card ed-music-recommend"
          aria-labelledby="ed-music-recommend-title"
        >
          <div className="ed-music-card-head">
            <h3 id="ed-music-recommend-title" className="ed-music-card-title">
              推荐音乐
            </h3>
            <button
              className="ed-music-filter"
              type="button"
              disabled
              aria-label="音乐筛选（后续版本开放）"
              title="音乐筛选将在后续版本开放"
            >
              <FilterIcon />
              <span>{CURRENT_FILTER}</span>
            </button>
          </div>

          <div className="ed-music-tabs" role="group" aria-label="音乐分类">
            {FILTERS.map((item) => (
              <button
                key={item}
                className={`ed-music-tab${CURRENT_FILTER === item ? ' is-active' : ''}`}
                type="button"
                disabled
                aria-pressed={CURRENT_FILTER === item}
                title="音乐分类将在后续版本开放"
              >
                {item}
              </button>
            ))}
            <button
              className="ed-music-tab ed-music-more"
              type="button"
              disabled
              title="更多分类将在后续版本开放"
            >
              更多
            </button>
          </div>

          <div className="ed-music-list">
            {visibleTracks.length > 0 ? (
              visibleTracks.map((track) => {
                const isSelected = track.id === CURRENT_TRACK_ID;

                return (
                  <button
                    key={track.id}
                    className={`ed-music-item${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    disabled
                    aria-pressed={isSelected}
                    title="选择与导入音乐将在后续版本开放"
                  >
                    <span
                      className="ed-music-item-cover"
                      style={{ backgroundImage: track.listGradient ?? track.gradient }}
                    >
                      <EditorIcon name="music" size={15} />
                    </span>
                    <span className="ed-music-item-info">
                      <span className="ed-music-item-title-row">
                        <span className="ed-music-item-title">{track.title}</span>
                        {isSelected ? <span className="ed-music-item-using">使用中</span> : null}
                        <span className="ed-music-item-duration">{track.duration}</span>
                      </span>
                      <span className="ed-music-item-meta-row">
                        <span className="ed-music-item-artist">{track.artist}</span>
                        <span className="ed-music-item-style">{track.mood}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="ed-music-empty">该分类暂无推荐音乐</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
