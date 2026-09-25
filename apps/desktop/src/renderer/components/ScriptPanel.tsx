import { SCENES } from '../constants/scenes';
import type { ScriptPanelProps } from '../types/scene';

export function ScriptPanel({ selectedScene, onSelectScene }: ScriptPanelProps) {
  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="shrink-0 space-y-1.5 px-4 pt-[18px] pb-[14px]">
        <h2 className="text-[20px] leading-6 font-bold">文稿字幕</h2>
        <p className="text-[11px] leading-4 text-[var(--text-muted)]">{SCENES.length} 段分镜 · 当前 {selectedScene.time}</p>
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-[18px]">
        {SCENES.map((scene) => {
          const active = scene.id === selectedScene.id;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelectScene(scene.id)}
              aria-current={active ? 'true' : undefined}
              className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${active ? 'border-[var(--accent-red)] bg-[#0b0d11] shadow-[0_10px_20px_#00000099]' : 'border-transparent bg-[#1c1f24] hover:bg-[#23272d]'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 whitespace-nowrap">
                <span className={`text-[11px] font-bold ${active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                  分镜 {String(scene.id).padStart(2, '0')}
                  {active && <span className="ml-2 text-[10px] text-[var(--accent-red)]">当前</span>}
                </span>
                <span className={`text-[10px] font-semibold ${active ? 'text-[#dce7ff]' : 'text-[var(--text-muted)]'}`}>{scene.time}</span>
              </div>
              <p className={`whitespace-pre-line text-[14px] leading-[1.5] ${active ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                {scene.lines.join('\n')}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
