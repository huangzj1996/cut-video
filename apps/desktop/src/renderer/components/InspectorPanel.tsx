import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Image as ImageIcon, X } from 'lucide-react';
import { useRef } from 'react';

const contextTags = [
  ['视频画面', '智能匹配素材'],
  ['旁白配音', '温婉学姐'],
  ['创作倾向', 'AI智能创作（默认）'],
];

export function InspectorPanel() {
  const repliesRef = useRef<HTMLDivElement>(null);

  return (
    <aside className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[#111214]">
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
            {contextTags.map(([label, value]) => (
              <div className="flex gap-1.5" key={label}>
                <span className="rounded-[7px] bg-[#3a3b3e] px-2 py-1 text-[11.5px] font-medium whitespace-nowrap">{label}</span>
                <span className="rounded-[7px] bg-[#303133] px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-[var(--text-secondary)]">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div aria-label="画面分析回复" className="relative min-h-[64px] flex-1">
        <div ref={repliesRef} className="thin-scrollbar h-full overflow-y-auto px-[18px] pt-8 pb-4 text-[12.2px] leading-[1.36] font-medium text-[#d6d8dd]">
          <p>我来分析你的文稿，这是一份关于“前端AI进阶学习路线”的教学内容，时间线清晰、结构完整。让我先加载制片技能来完成方案设计。</p>
          <p className="mt-5">我已经加载了制片技能。现在分析你的文稿：</p>
          <p className="mt-5">这是一份完整的技术教学口播稿，主题聚焦“前端AI进阶学习路线”，包含4个时间段的内容：</p>
          <ul className="mt-4 list-inside list-disc space-y-0.5">
            <li>开场问题引入（0:00-0:25）</li>
            <li>为什么不能直接学AI（0:25-0:55）</li>
            <li>三个月学习路线详解（0:55-2:45）</li>
            <li>收尾总结（2:45-3:05）</li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => repliesRef.current?.scrollTo({ top: repliesRef.current.scrollHeight, behavior: 'smooth' })}
          className="absolute bottom-2 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-2 rounded-full bg-[#2b2d31] px-4 text-[12px] font-bold whitespace-nowrap text-[var(--text-secondary)] shadow-[0_4px_16px_#0008]"
        >
          <ArrowDown size={15} />回到底部
        </button>
      </div>

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
    </aside>
  );
}
