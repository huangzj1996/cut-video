import { TOOL_RAIL_ENTRIES } from '../constants/editor';
import type { ToolRailProps } from '../types/editor';

export function ToolRail({ activeTool, onSelect }: ToolRailProps) {
  return (
    <nav aria-label="编辑工具" className="flex w-[59px] shrink-0 flex-col items-center gap-2.5 border-l border-[var(--border-subtle)] bg-[#101216] pt-[18px]">
      {TOOL_RAIL_ENTRIES.map(({ id, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          disabled={id === null}
          onClick={() => id && onSelect(id)}
          aria-current={id === activeTool ? 'page' : undefined}
          title={id === null ? '音乐功能即将开放' : undefined}
          className={`group flex h-[52px] w-[52px] flex-col items-center justify-center gap-0.5 rounded-[10px] text-[12px] font-semibold transition-[color,background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#242831] focus-visible:outline-2 focus-visible:outline-[var(--accent-red)] motion-reduce:transition-none ${id === activeTool ? 'text-[var(--accent-red)] hover:bg-[#2b242a]' : id ? 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]' : 'cursor-default text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
        >
          <Icon size={20} strokeWidth={1.8} className="transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none" />
          {label}
        </button>
      ))}
    </nav>
  );
}
