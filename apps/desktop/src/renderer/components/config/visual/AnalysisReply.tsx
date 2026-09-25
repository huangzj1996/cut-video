import { ArrowDown } from 'lucide-react';
import { useRef } from 'react';

export function AnalysisReply() {
  const repliesRef = useRef<HTMLDivElement>(null);

  return (
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
  );
}
