import { ChevronDown } from 'lucide-react';
import { CONTEXT_TAGS } from '../../../constants/visual';

export function SegmentContextCard() {
  return (
    <div className="thin-scrollbar min-h-0 shrink overflow-y-auto">
      <div className="flex h-[58px] items-center justify-center text-[13px] font-semibold text-[var(--text-muted)]">6月10日 17:42</div>
      <div className="mx-[18px] rounded-[18px] bg-[#252628] px-[14px] py-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-medium">0:00-0:25 开场问题</h2>
          <ChevronDown size={17} className="text-[var(--text-secondary)]" />
        </div>
        <p className="mb-2 line-clamp-2 text-[12.5px] leading-[1.35] font-medium text-[#d5d8de]">
          大家好，很多前端同学现在都在焦虑一件事：AI到底应该怎么学。我先问一下大家，如果...
        </p>
        <div className="mb-2 h-px bg-[#ffffff18]" />
        <div className="space-y-1.5">
            {CONTEXT_TAGS.map(([label, value]) => (
            <div className="flex gap-1.5" key={label}>
              <span className="rounded-[7px] bg-[#3a3b3e] px-2 py-1 text-[11.5px] font-medium whitespace-nowrap">{label}</span>
              <span className="rounded-[7px] bg-[#303133] px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-[var(--text-secondary)]">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
