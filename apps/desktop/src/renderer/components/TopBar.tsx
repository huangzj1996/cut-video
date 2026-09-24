import { Upload } from 'lucide-react';

export function TopBar() {
  return (
    <header className="top-bar relative flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[#111318] px-5">
      <div className="flex w-[230px] items-center gap-3">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[var(--accent-red)]">
          <div className="h-full w-full opacity-35 [background-image:conic-gradient(#ffb5be_25%,transparent_0_50%,#ffb5be_0_75%,transparent_0)] [background-size:14px_14px]" />
        </div>
        <div className="flex flex-col gap-0.5 whitespace-nowrap">
          <strong className="text-[15px] leading-4 font-bold">妙剪 Magicut</strong>
          <span className="text-[11px] text-[var(--text-muted)]">智能视频剪辑工具</span>
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5 whitespace-nowrap">
        <h1 className="text-[20px] leading-6 font-semibold">口播短片自动剪辑工程</h1>
        <span className="text-[11px] text-[var(--text-muted)]">2 分钟前更新 · 已自动保存</span>
      </div>

      <div className="window-control flex items-center">
        <button className="flex h-9 items-center gap-2 rounded-lg bg-[var(--accent-red)] px-3.5 text-[13px] font-bold text-white hover:brightness-110" type="button">
          <Upload size={15} strokeWidth={2} />
          渲染导出
        </button>
      </div>
    </header>
  );
}
