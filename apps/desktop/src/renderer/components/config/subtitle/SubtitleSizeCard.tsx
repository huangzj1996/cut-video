import { ConfigCard } from '../ConfigCard';
import { ConfigRange } from '../ConfigRange';
import { SUBTITLE_SIZE_MAX, SUBTITLE_SIZE_MIN } from '../../../constants/subtitle';
import type { SubtitleSizeCardProps } from '../../../types/subtitle';

export function SubtitleSizeCard({ value, onChange }: SubtitleSizeCardProps) {
  return (
    <ConfigCard className="mt-[26px] h-[116px] p-[13px]">
      <div className="flex h-5 items-center justify-between">
        <h3 className="text-[14px] font-extrabold">字号</h3>
        <span className="font-mono text-[11px] text-[var(--text-primary)]">{value} px</span>
      </div>
      <ConfigRange label="字幕字号" value={value} min={SUBTITLE_SIZE_MIN} max={SUBTITLE_SIZE_MAX} step={1} onChange={onChange} className="mt-[21px]" />
    </ConfigCard>
  );
}
