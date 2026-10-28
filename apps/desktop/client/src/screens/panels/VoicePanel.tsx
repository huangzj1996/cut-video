import type { CSSProperties } from 'react';
import { EditorIcon } from '../editor-icons';
import './voice-panel.css';

/**
 * 口播面板首版保持 mock：只展示音色与参数，所有写操作禁用并标注"后续"，
 * 不发起真实试听或生成请求。
 */

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

const CURRENT_VOICE_ID = 'wenwan';
const VOLUME = 82;
const SPEED = 1.05;

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

export function VoicePanel() {
  return (
    <div className="ed-panel ed-voice-panel">
      <div className="ed-voice-scroll">
        <header className="ed-voice-header">
          <h2 className="ed-voice-title">口播配音</h2>
          <p className="ed-voice-subtitle">为当前分镜生成旁白音轨</p>
          <p className="ed-panel-followup" role="note">
            <span className="ed-followup-chip">后续</span>
            本轮只读：音色、试听与生成将在后续版本开放。
          </p>
        </header>

        <section className="ed-voice-card">
          <div className="ed-voice-card-head">
            <h3 className="ed-voice-card-title">选择音色</h3>
            <p className="ed-voice-card-sub">系统音色与自定义音色库 · 支持试听</p>
          </div>

          <div className="ed-voice-grid">
            {VOICE_OPTIONS.map((voice) => {
              const selected = voice.id === CURRENT_VOICE_ID;

              return (
                <div
                  key={voice.id}
                  className={`ed-voice-option is-disabled${selected ? ' is-selected' : ''}`}
                  aria-disabled="true"
                  title="音色选择将在后续版本开放"
                >
                  <span className="ed-voice-option-copy">
                    <span className="ed-voice-option-name">{voice.name}</span>
                    <span className="ed-voice-option-desc">{voice.description}</span>
                  </span>
                  <button
                    className="ed-voice-preview"
                    type="button"
                    disabled
                    aria-label={`试听 ${voice.name}（后续版本开放）`}
                    title="试听将在后续版本开放"
                  >
                    <EditorIcon name="play" size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="ed-voice-custom">
            <button
              className="ed-voice-custom-button"
              type="button"
              disabled
              title="自定义音色库将在后续版本开放"
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
              <span className="ed-voice-param-value">{VOLUME}%</span>
            </div>
            <input
              className="ed-voice-slider"
              type="range"
              min={0}
              max={100}
              value={VOLUME}
              disabled
              aria-label="音量（后续版本开放）"
              title="音量调整将在后续版本开放"
              style={{ '--range-progress': `${VOLUME}%` } as CSSProperties}
            />
          </div>

          <div className="ed-voice-param-group">
            <div className="ed-voice-param-row">
              <span className="ed-voice-param-icon">
                <SpeedIcon />
              </span>
              <span className="ed-voice-param-label">语速</span>
              <span className="ed-voice-param-value">{SPEED.toFixed(2)}x</span>
            </div>
            <input
              className="ed-voice-slider"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={SPEED}
              disabled
              aria-label="语速（后续版本开放）"
              title="语速调整将在后续版本开放"
              style={{ '--range-progress': `${((SPEED - 0.5) / 1.5) * 100}%` } as CSSProperties}
            />
          </div>
        </section>
      </div>

      <div className="ed-voice-footer">
        <button
          className="ed-voice-generate"
          type="button"
          disabled
          title="口播生成将在后续版本开放"
        >
          <EditorIcon name="mic" size={15} />
          生成口播音轨
        </button>
      </div>
    </div>
  );
}
