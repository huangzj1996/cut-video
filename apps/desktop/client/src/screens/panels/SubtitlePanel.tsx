import type { CSSProperties } from 'react';
import { SUBTITLE_PRESET_IDS } from '@miaoma/video-project';
import type { SubtitlePresetId } from '@miaoma/video-project';
import { SUBTITLE_PRESET_STYLES } from '../subtitle-presets';
import './subtitle-panel.css';

/**
 * 字幕面板首版保持 mock：样式卡与预览共用同一份预设，写操作全部禁用并标注"后续"。
 */

/** 样式卡与预览字幕叠层共用同一份预设颜色/描边，避免两处显示不一致。 */
const PRESETS = SUBTITLE_PRESET_IDS.map((id) => ({ ...SUBTITLE_PRESET_STYLES[id], id }));

const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 72;
const CURRENT_FONT_SIZE = 42;
const CURRENT_PRESET_ID: SubtitlePresetId = 'white-outline';

export function SubtitlePanel() {
  const fontSize = CURRENT_FONT_SIZE;
  const presetId = CURRENT_PRESET_ID;
  const selectedPreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const progress = ((fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100;

  return (
    <div className="ed-panel ed-subtitle-panel">
      <header className="ed-subtitle-header">
        <div className="ed-subtitle-title-group">
          <h2 className="ed-subtitle-title">字幕设置</h2>
          <p className="ed-subtitle-description">调整当前字幕轨显示样式</p>
        </div>

        <div className="ed-subtitle-switch-row">
          <span className="ed-subtitle-switch-label">显示字幕</span>
          <button
            className="ed-subtitle-switch is-on"
            type="button"
            role="switch"
            aria-checked
            aria-label="显示字幕（后续版本开放）"
            title="显示开关将在后续版本开放"
            disabled
          >
            <span className="ed-subtitle-switch-knob" />
          </button>
        </div>
      </header>

      <p className="ed-panel-followup" role="note">
        <span className="ed-followup-chip">后续</span>
        本轮只读：显示开关、字号与样式写入将在后续版本开放。
      </p>

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
              disabled
              aria-label="字幕字号（后续版本开放）"
              title="字幕字号调整将在后续版本开放"
              style={{ '--subtitle-progress': `${progress}%` } as CSSProperties}
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
                  disabled
                  aria-pressed={active}
                  aria-label={`${preset.label}（后续版本开放）`}
                  title="字幕样式写入将在后续版本开放"
                  style={
                    {
                      '--preset-color': preset.color,
                      '--preset-outline': preset.outline,
                      '--preset-bg': preset.tileBackground ?? '#111214',
                      '--preset-border': preset.tileBorder ?? '#343841',
                    } as CSSProperties
                  }
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
              disabled
              title="应用到当前字幕轨将在后续版本开放"
            >
              应用到当前字幕轨
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
