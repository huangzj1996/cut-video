import type { SubtitlePanelProps } from '../../../types/subtitle';
import { ConfigPanelHeader } from '../ConfigPanelHeader';
import { SubtitleSizeCard } from './SubtitleSizeCard';
import { SubtitleStyleCard } from './SubtitleStyleCard';

export function SubtitlePanel({ settings, onChange }: SubtitlePanelProps) {
  return (
    <>
      <ConfigPanelHeader>
        <div className="flex h-[54px] items-start justify-between">
          <div className="mt-0.5">
            <h2 className="text-[20px] leading-[29px] font-extrabold">字幕设置</h2>
            <p className="mt-[5px] text-[10px] font-semibold text-[var(--text-muted)]">调整当前字幕轨显示样式</p>
          </div>
          <div className="mt-[13px] flex items-center gap-2 text-[11px] font-semibold whitespace-nowrap">
            <span>显示字幕</span>
            <button
              type="button"
              role="switch"
              aria-label="显示字幕"
              aria-checked={settings.visible}
              onClick={() => onChange({ ...settings, visible: !settings.visible })}
              className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${settings.visible ? 'bg-[var(--accent-red)]' : 'bg-[#41454e]'}`}
            >
              <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left] duration-200 ${settings.visible ? 'left-[23px]' : 'left-[3px]'}`} />
            </button>
          </div>
        </div>
      </ConfigPanelHeader>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <SubtitleSizeCard value={settings.fontSize} onChange={(fontSize) => onChange({ ...settings, fontSize })} />
        <SubtitleStyleCard selectedPreset={settings.presetId} onSelect={(presetId) => onChange({ ...settings, presetId })} />
      </div>
    </>
  );
}
