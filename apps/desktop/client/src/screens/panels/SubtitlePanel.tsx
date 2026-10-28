import { useState } from 'react';
import type { CSSProperties } from 'react';
import { SUBTITLE_PRESET_IDS } from '@miaoma/video-project';
import type { SubtitlePresetId } from '@miaoma/video-project';
import { SUBTITLE_PRESET_STYLES } from '../subtitle-presets';
import './subtitle-panel.css';

interface SubtitlePanelProps {
  onNotify?: (message: string) => void;
}

/** 样式卡与预览字幕叠层共用同一份预设颜色/描边，避免两处显示不一致。 */
const PRESETS = SUBTITLE_PRESET_IDS.map((id) => ({ ...SUBTITLE_PRESET_STYLES[id], id }));

const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 64;

export function SubtitlePanel({ onNotify }: SubtitlePanelProps) {
  const [enabled, setEnabled] = useState(true);
  const [fontSize, setFontSize] = useState(42);
  const [presetId, setPresetId] = useState<SubtitlePresetId>('white-outline');

  const selectedPreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const progress = ((fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100;

  return (
    <div className={`ed-panel ed-subtitle-panel${enabled ? '' : ' is-disabled'}`}>
      <header className="ed-subtitle-header">
        <div className="ed-subtitle-title-group">
          <h2 className="ed-subtitle-title">字幕设置</h2>
          <p className="ed-subtitle-description">调整当前字幕轨显示样式</p>
        </div>

        <div className="ed-subtitle-switch-row">
          <span className="ed-subtitle-switch-label">显示字幕</span>
          <button
            className={`ed-subtitle-switch${enabled ? ' is-on' : ''}`}
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="显示字幕"
            onClick={() => setEnabled((value) => !value)}
          >
            <span className="ed-subtitle-switch-knob" />
          </button>
        </div>
      </header>

      <div className="ed-subtitle-body">
        <section
          className="ed-subtitle-card ed-subtitle-size-card"
          aria-labelledby="ed-subtitle-size-title"
        >
          <div className="ed-subtitle-card-head">
            <h3 id="ed-subtitle-size-title" className="ed-subtitle-card-title">
              字号
            </h3>
            <span className="ed-subtitle-value">{fontSize} px</span>
          </div>

          <div className="ed-subtitle-slider-row">
            <input
              className="ed-subtitle-slider"
              type="range"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              disabled={!enabled}
              aria-label="字幕字号"
              style={{ '--subtitle-progress': `${progress}%` } as CSSProperties}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
        </section>

        <section
          className="ed-subtitle-card ed-subtitle-style-card"
          aria-labelledby="ed-subtitle-style-title"
        >
          <div className="ed-subtitle-card-head">
            <h3 id="ed-subtitle-style-title" className="ed-subtitle-card-title">
              字幕样式
            </h3>
          </div>

          <div className="ed-subtitle-presets" role="group" aria-label="字幕样式">
            {PRESETS.map((preset) => {
              const active = preset.id === presetId;

              return (
                <button
                  key={preset.id}
                  className={`ed-subtitle-preset${active ? ' is-active' : ''}`}
                  type="button"
                  disabled={!enabled}
                  aria-pressed={active}
                  aria-label={preset.label}
                  style={
                    {
                      '--preset-color': preset.color,
                      '--preset-outline': preset.outline,
                      '--preset-bg': preset.tileBackground ?? '#111214',
                      '--preset-border': preset.tileBorder ?? '#343841',
                    } as CSSProperties
                  }
                  onClick={() => setPresetId(preset.id)}
                >
                  <span className="ed-subtitle-preset-glyph">T</span>
                </button>
              );
            })}
          </div>

          <div className="ed-subtitle-preset-footer">
            <span className="ed-subtitle-preset-name">{selectedPreset?.label ?? '白字黑边'}</span>
            <button
              className="ed-subtitle-apply"
              type="button"
              disabled={!enabled}
              onClick={() => onNotify?.('应用到当前字幕轨将在 T17 接入。')}
            >
              应用到当前字幕轨
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
