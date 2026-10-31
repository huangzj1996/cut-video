import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SUBTITLE_PRESET_IDS } from '@miaoma/video-project';
import type { SubtitlePresetId, VideoProject } from '@miaoma/video-project';
import type { EditAction } from '../editor-video/project-edit';
import { SUBTITLE_FONT_SIZE_MAX, SUBTITLE_FONT_SIZE_MIN } from '../editor-video/subtitle-overlay';
import { SUBTITLE_PRESET_STYLES } from '../subtitle-presets';
import './subtitle-panel.css';

/**
 * 字幕设置面板：显示开关、字号与样式都是轨道级设置，全部经 `applyEdit` 写入工程，
 * 因此会走编辑器的自动保存、撤销与只读拦截。预览叠层读同一份 `track.style`，
 * 面板选中样式/字号后预览立即一致；拖动字号时只把未提交值透传给预览做实时反馈。
 */

const PRESETS = SUBTITLE_PRESET_IDS.map((id) => ({ ...SUBTITLE_PRESET_STYLES[id], id }));

interface SubtitlePanelProps {
  onEdit: (action: EditAction) => void;
  /** 拖动字号时把未提交值透传给预览；提交、失焦或卸载时传 null 还原。 */
  onFontSizePreview: (fontSize: number | null) => void;
  project: VideoProject;
  readonly: boolean;
}

export function SubtitlePanel({
  onEdit,
  onFontSizePreview,
  project,
  readonly,
}: SubtitlePanelProps) {
  const [fontSizeDraft, setFontSizeDraft] = useState<number | null>(null);
  const fontSizeDraftRef = useRef<number | null>(null);
  const canWrite = !readonly;
  const track = project.tracks.find((candidate) => candidate.kind === 'subtitle');

  // 切到别的 rail 时面板卸载，清掉未提交的字号预览，避免预览停在草稿值上。
  useEffect(() => {
    return () => {
      onFontSizePreview(null);
    };
  }, [onFontSizePreview]);

  if (!track) {
    return (
      <div className="ed-panel ed-subtitle-panel">
        <header className="ed-subtitle-header">
          <div className="ed-subtitle-title-group">
            <h2 className="ed-subtitle-title">字幕设置</h2>
            <p className="ed-subtitle-description">调整当前字幕轨显示样式</p>
          </div>
        </header>
        <p className="ed-subtitle-empty">当前工程没有字幕轨。</p>
      </div>
    );
  }

  const fontSize = fontSizeDraft ?? track.style.fontSize;
  const progress =
    ((fontSize - SUBTITLE_FONT_SIZE_MIN) / (SUBTITLE_FONT_SIZE_MAX - SUBTITLE_FONT_SIZE_MIN)) * 100;
  const selectedPreset = PRESETS.find((preset) => preset.id === track.style.presetId) ?? PRESETS[0];

  const selectPreset = (presetId: SubtitlePresetId) => {
    if (!canWrite || presetId === track.style.presetId) {
      return;
    }

    onEdit({ type: 'set-subtitle-style', presetId });
  };

  const toggleVisible = () => {
    if (!canWrite) {
      return;
    }

    onEdit({ type: 'set-subtitle-visible', visible: !track.visible });
  };

  const previewFontSize = (value: number) => {
    if (!canWrite) {
      return;
    }

    fontSizeDraftRef.current = value;
    setFontSizeDraft(value);
    onFontSizePreview(value);
  };

  const commitFontSize = () => {
    const value = fontSizeDraftRef.current;
    fontSizeDraftRef.current = null;
    setFontSizeDraft(null);
    onFontSizePreview(null);

    if (!canWrite || value === null || value === track.style.fontSize) {
      return;
    }

    onEdit({ type: 'set-subtitle-style', fontSize: value });
  };

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
            className={`ed-subtitle-switch${track.visible ? ' is-on' : ''}`}
            type="button"
            role="switch"
            aria-checked={track.visible}
            aria-label={track.visible ? '隐藏字幕' : '显示字幕'}
            title={
              !canWrite
                ? '编辑器只读，暂不能修改字幕'
                : track.visible
                  ? '隐藏字幕（保留片段与样式）'
                  : '显示字幕'
            }
            disabled={!canWrite}
            onClick={toggleVisible}
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
              min={SUBTITLE_FONT_SIZE_MIN}
              max={SUBTITLE_FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              disabled={!canWrite}
              aria-label="字幕字号"
              title={!canWrite ? '编辑器只读，暂不能修改字幕' : '拖动调整字幕字号'}
              onBlur={commitFontSize}
              onChange={(event) => previewFontSize(Number(event.target.value))}
              onKeyUp={commitFontSize}
              onPointerUp={commitFontSize}
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
              const active = preset.id === track.style.presetId;

              return (
                <button
                  key={preset.id}
                  className={`ed-subtitle-preset${active ? ' is-active' : ''}`}
                  type="button"
                  disabled={!canWrite}
                  aria-pressed={active}
                  aria-label={preset.label}
                  title={
                    !canWrite ? '编辑器只读，暂不能修改字幕' : `应用「${preset.label}」到当前字幕轨`
                  }
                  onClick={() => selectPreset(preset.id)}
                  style={
                    {
                      '--preset-color': preset.color,
                      '--preset-outline': preset.outline,
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
            <span className="ed-subtitle-preset-scope">应用到当前字幕轨</span>
          </div>
        </section>
      </div>
    </div>
  );
}
