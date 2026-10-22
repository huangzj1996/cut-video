import { useState } from 'react';
import type { CSSProperties } from 'react';
import { EditorIcon } from '../editor-icons';
import './music-panel.css';

interface MusicPanelProps {
  onNotify?: (message: string) => void;
}

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

export function MusicPanel({ onNotify }: MusicPanelProps) {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(60);
  const [filter, setFilter] = useState<MusicFilter>('平静');
  const [selectedId, setSelectedId] = useState('eutopia');

  const selectedTrack = TRACKS.find((track) => track.id === selectedId) ?? null;
  const visibleTracks =
    filter === '全部' ? TRACKS : TRACKS.filter((track) => track.category === filter);

  return (
    <div className={`ed-panel ed-music-panel${enabled ? '' : ' is-off'}`}>
      <div className="ed-music-scroll">
        <header className="ed-music-head">
          <div className="ed-music-title-group">
            <h2 className="ed-music-title">音乐设置</h2>
            <p className="ed-music-subtitle">控制背景音乐与推荐曲库</p>
          </div>

          <div className="ed-music-switch-group">
            <span className="ed-music-switch-label">{enabled ? '开启' : '关闭'}</span>
            <button
              className={`ed-music-switch${enabled ? ' is-on' : ''}`}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="背景音乐开关"
              onClick={() => setEnabled((value) => !value)}
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
            <span className="ed-music-volume-value">{volume}%</span>
          </div>

          <input
            className="ed-music-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            disabled={!enabled}
            aria-label="音乐音量"
            style={{ '--music-progress': `${volume}%` } as CSSProperties}
            onChange={(event) => setVolume(Number(event.target.value))}
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
              aria-label="音乐筛选"
              onClick={() => onNotify?.('音乐筛选将在 T17 接入。')}
            >
              <FilterIcon />
              <span>{filter}</span>
            </button>
          </div>

          <div className="ed-music-tabs" role="group" aria-label="音乐分类">
            {FILTERS.map((item) => (
              <button
                key={item}
                className={`ed-music-tab${filter === item ? ' is-active' : ''}`}
                type="button"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
            <button
              className="ed-music-tab ed-music-more"
              type="button"
              onClick={() => onNotify?.('更多分类将在 T17 接入。')}
            >
              更多
            </button>
          </div>

          <div className="ed-music-list">
            {visibleTracks.length > 0 ? (
              visibleTracks.map((track) => {
                const isSelected = track.id === selectedId;
                const isUsing = isSelected && enabled;

                return (
                  <button
                    key={track.id}
                    className={`ed-music-item${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(track.id)}
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
                        {isUsing ? <span className="ed-music-item-using">使用中</span> : null}
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
