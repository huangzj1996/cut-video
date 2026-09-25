import type { SubtitlePresetOptionProps } from '../../../types/subtitle';

export function SubtitlePresetOption({ preset, selected, onSelect }: SubtitlePresetOptionProps) {
  return (
    <button
      type="button"
      aria-label={preset.name}
      aria-pressed={selected}
      title={preset.name}
      onClick={onSelect}
      className={`relative h-9 w-8 shrink-0 rounded-lg border bg-[#111214] transition-colors duration-150 hover:bg-[#3A3B3E] focus-visible:outline-2 focus-visible:outline-white ${selected ? 'border-[var(--accent-red)]' : 'border-[#343841]'}`}
    >
      <span aria-hidden="true" className="absolute top-[6px] left-[8px] font-[Inter] text-[20px] leading-6 font-black" style={{ color: preset.outlineColor }}>T</span>
      <span aria-hidden="true" className="absolute top-[6px] left-[10px] font-[Inter] text-[20px] leading-6 font-black" style={{ color: preset.textColor }}>T</span>
    </button>
  );
}
