import { SUBTITLE_PRESETS } from '../../../constants/subtitle';
import type { SubtitleStyleCardProps } from '../../../types/subtitle';
import { ConfigCard } from '../ConfigCard';
import { SubtitlePresetOption } from './SubtitlePresetOption';

export function SubtitleStyleCard({ selectedPreset, onSelect }: SubtitleStyleCardProps) {
  const selectedName = SUBTITLE_PRESETS.find((preset) => preset.id === selectedPreset)?.name;

  return (
    <ConfigCard className="mt-[13px] h-[142px] p-[13px]">
      <h3 className="text-[14px] leading-5 font-extrabold">字幕样式</h3>
      <div className="mt-3 flex items-center gap-[6px]">
        {SUBTITLE_PRESETS.map((preset) => (
          <SubtitlePresetOption key={preset.id} preset={preset} selected={preset.id === selectedPreset} onSelect={() => onSelect(preset.id)} />
        ))}
      </div>
      <div className="mt-[13px] flex items-center justify-between">
        <span className="text-[11px] font-semibold">{selectedName}</span>
        <span className="text-[10px] font-semibold text-[var(--text-muted)]">应用到当前字幕轨</span>
      </div>
    </ConfigCard>
  );
}
