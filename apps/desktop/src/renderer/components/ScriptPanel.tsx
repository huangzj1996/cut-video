import { useState } from 'react';

const scenes = [
  { id: 1, time: '00:00-00:04', lines: ['开场把原始素材拖入时间线，', '系统开始识别画面节奏。'] },
  { id: 2, time: '00:04-00:08', lines: ['AI 自动挑选高光片段，', '同步生成第一版字幕。'] },
  { id: 3, time: '00:00-00:04', lines: ['是的发送到asdfasdfasdf', '阿斯顿发送到发的阿'] },
  { id: 4, time: '00:00-00:04', lines: ['是的发送到', '官方去潍坊过去问', '是的发送到发的岗位工区'] },
  { id: 5, time: '00:00-00:04', lines: ['阿斯顿发的', '刚刚我去二', '撒旦法水电费赶过去'] },
  { id: 6, time: '00:00-00:04', lines: ['谁的法谁的规'] },
];

export function ScriptPanel() {
  const [selectedScene, setSelectedScene] = useState(2);

  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="shrink-0 space-y-1.5 px-4 pt-[18px] pb-[14px]">
        <h2 className="text-[20px] leading-6 font-bold">文稿字幕</h2>
        <p className="text-[11px] leading-4 text-[var(--text-muted)]">8 段分镜 · 00:30 · 当前 00:04-00:08</p>
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-[18px]">
        {scenes.map((scene) => {
          const active = scene.id === selectedScene;
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => setSelectedScene(scene.id)}
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
