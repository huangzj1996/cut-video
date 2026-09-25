import { Volume2 } from 'lucide-react';
import { ConfigCard } from '../ConfigCard';
import { ConfigRange } from '../ConfigRange';

export function MusicVolumeCard({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <ConfigCard className="mt-3 h-[92px] px-[13px] pt-[12px]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-[7px] text-[13px] font-bold"><Volume2 size={15} />音乐音量</h3>
        <span className="font-mono text-[11px]">{value}%</span>
      </div>
      <ConfigRange label="音乐音量" value={value} min={0} max={100} step={1} onChange={onChange} className="mt-[17px]" />
    </ConfigCard>
  );
}
