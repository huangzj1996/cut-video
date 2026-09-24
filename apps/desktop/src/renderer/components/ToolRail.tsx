import { Captions, Image as ImageIcon, Mic, Music2 } from 'lucide-react';

const entries = [
  { label: '画面', icon: ImageIcon, active: true },
  { label: '口播', icon: Mic, active: false },
  { label: '字幕', icon: Captions, active: false },
  { label: '音乐', icon: Music2, active: false },
];

export function ToolRail() {
  return (
    <nav aria-label="编辑工具" className="flex w-[59px] shrink-0 flex-col items-center gap-2.5 border-l border-[var(--border-subtle)] bg-[#101216] pt-[18px]">
      {entries.map(({ label, icon: Icon, active }) => (
        <button key={label} type="button" aria-current={active ? 'page' : undefined} className={`flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[12px] font-semibold ${active ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
          <Icon size={20} strokeWidth={1.8} />
          {label}
        </button>
      ))}
    </nav>
  );
}
