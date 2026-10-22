import { useState } from 'react';
import type { CSSProperties } from 'react';
import { EditorIcon } from '../editor-icons';
import './voice-panel.css';

interface VoicePanelProps {
  onNotify?: (message: string) => void;
}

interface VoiceOption {
  id: string;
  name: string;
  description: string;
}

const VOICE_OPTIONS: readonly VoiceOption[] = [
  { id: 'wenwan', name: '温婉学姐', description: '自然女声 · 推荐' },
  { id: 'chenwen', name: '沉稳男声', description: '低频清晰' },
  { id: 'xinwen', name: '新闻播报', description: '稳重正式' },
  { id: 'huoli', name: '活力讲解', description: '节奏明快' },
];

function SpeedIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={16}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.7}
      viewBox="0 0 24 24"
      width={16}
    >
      <path d="M20.5 15a9 9 0 1 0-17 0" />
      <path d="m13.4 12.6 4.1-4.1" />
      <circle cx="12" cy="14" r="2" />
    </svg>
  );
}

export function VoicePanel({ onNotify }: VoicePanelProps) {
  const [selectedVoice, setSelectedVoice] = useState('wenwan');
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [volume, setVolume] = useState(82);
  const [speed, setSpeed] = useState(1.05);

  const selectVoice = (id: string) => {
    setSelectedVoice(id);
    setPreviewing(null);
  };

  const togglePreview = (id: string, name: string) => {
    setPreviewing((current) => (current === id ? null : id));
    onNotify?.(`正在试听「${name}」；真实试听将在 T12 接入。`);
  };

  return (
    <div className="ed-panel ed-voice-panel">
      <div className="ed-voice-scroll">
        <header className="ed-voice-header">
          <h2 className="ed-voice-title">口播配音</h2>
          <p className="ed-voice-subtitle">为当前分镜生成旁白音轨</p>
        </header>

        <section className="ed-voice-card">
          <div className="ed-voice-card-head">
            <h3 className="ed-voice-card-title">选择音色</h3>
            <p className="ed-voice-card-sub">系统音色与自定义音色库 · 支持试听</p>
          </div>

          <div className="ed-voice-grid">
            {VOICE_OPTIONS.map((voice) => {
              const selected = voice.id === selectedVoice;
              const preview = previewing === voice.id;

              return (
                <div
                  key={voice.id}
                  className={`ed-voice-option${selected ? ' is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  onClick={() => selectVoice(voice.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return;
                    }

                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectVoice(voice.id);
                    }
                  }}
                >
                  <span className="ed-voice-option-copy">
                    <span className="ed-voice-option-name">{voice.name}</span>
                    <span className="ed-voice-option-desc">{voice.description}</span>
                  </span>
                  <button
                    className="ed-voice-preview"
                    type="button"
                    aria-label={preview ? `停止试听 ${voice.name}` : `试听 ${voice.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePreview(voice.id, voice.name);
                    }}
                  >
                    <EditorIcon name={preview ? 'pause' : 'play'} size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="ed-voice-custom">
            <button
              className="ed-voice-custom-button"
              type="button"
              onClick={() => onNotify?.('自定义音色库上传将在 T12 接入。')}
            >
              <EditorIcon name="plus" size={16} />
              自定义音色库
            </button>
            <p className="ed-voice-custom-note">上传 10 s 内音频，保存后可直接作为音色使用</p>
          </div>
        </section>

        <section className="ed-voice-card ed-voice-params">
          <h3 className="ed-voice-card-title">参数调整</h3>

          <div className="ed-voice-param-group">
            <div className="ed-voice-param-row">
              <span className="ed-voice-param-icon">
                <EditorIcon name="volume" size={16} />
              </span>
              <span className="ed-voice-param-label">音量</span>
              <span className="ed-voice-param-value">{volume}%</span>
            </div>
            <input
              className="ed-voice-slider"
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="音量"
              style={{ '--range-progress': `${volume}%` } as CSSProperties}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>

          <div className="ed-voice-param-group">
            <div className="ed-voice-param-row">
              <span className="ed-voice-param-icon">
                <SpeedIcon />
              </span>
              <span className="ed-voice-param-label">语速</span>
              <span className="ed-voice-param-value">{speed.toFixed(2)}x</span>
            </div>
            <input
              className="ed-voice-slider"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              aria-label="语速"
              style={{ '--range-progress': `${((speed - 0.5) / 1.5) * 100}%` } as CSSProperties}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </div>
        </section>
      </div>

      <div className="ed-voice-footer">
        <button
          className="ed-voice-generate"
          type="button"
          onClick={() => onNotify?.('口播生成将在 T12 接入。')}
        >
          <EditorIcon name="mic" size={15} />
          生成口播音轨
        </button>
      </div>
    </div>
  );
}
