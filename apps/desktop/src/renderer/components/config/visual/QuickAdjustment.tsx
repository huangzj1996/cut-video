import { ArrowUp, ChevronUp, Image as ImageIcon, X } from 'lucide-react';

export function QuickAdjustment() {
  return (
    <div className="shrink-0 bg-[#111214] pb-[9px]">
      <div className="mx-[9px] h-[129px] rounded-[14px] bg-[#1a1b1e] pt-2.5">
        <div className="flex h-[18px] items-center justify-between px-3 text-[12px] font-bold text-[var(--text-secondary)]">
          <span>快捷调整</span><ChevronUp size={18} />
        </div>
        <div className="mt-2 flex h-[93px] flex-col justify-between rounded-[10px] border border-[#34363b] px-3 py-2.5">
          <textarea aria-label="快捷调整内容" placeholder="输入你的任何想法" rows={1} className="w-full resize-none bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[#6f737c]" />
          <div className="flex items-center justify-between">
            <span className="flex h-[22px] items-center gap-1 rounded-md bg-[#303136] px-1.5 text-[11px] font-bold text-[#d5d8de]">
              <ImageIcon size={14} className="text-[var(--text-secondary)]" />分镜 01<X size={12} className="text-[var(--text-secondary)]" />
            </span>
            <button type="button" aria-label="发送" className="text-white"><ArrowUp size={19} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
