import {
  AudioLines,
  Captions,
  Film,
  Link2,
  Magnet,
  Mic,
  Minus,
  Plus,
  Redo2,
  Scissors,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { DURATION_SECONDS, INITIAL_ZOOM, RULER_MARKS, TIMELINE_DISPLAY_TIME, VIDEO_CLIPS, WAVEFORM_BARS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../constants/timeline';

function positionAt(seconds: number) {
  return `${(seconds / DURATION_SECONDS) * 100}%`;
}

function clipPosition(start: number, end: number) {
  return { left: positionAt(start), width: positionAt(end - start) };
}

function ToolButton({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button type="button" aria-label={label} className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] ${active ? 'bg-[#2a2e34] text-white' : 'bg-[#1d2026] hover:text-white'}`}>
      <Icon size={15} strokeWidth={1.8} />
    </button>
  );
}

function TrackLabel({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex h-16 items-center gap-2.5 border-b border-[var(--border-subtle)] bg-[#111318] px-[18px]">
      <Icon size={18} className="shrink-0 text-[var(--text-secondary)]" strokeWidth={1.7} />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-[10px] text-[var(--text-muted)]">{subtitle}</span>
      </div>
    </div>
  );
}

function Waveform() {
  return (
    <span className="ml-2 flex h-6 items-center gap-[3px] opacity-60" aria-hidden="true">
      {WAVEFORM_BARS.map((height, index) => <i key={index} className={`w-[3px] rounded-full bg-[#a3d8ae] ${height}`} />)}
    </span>
  );
}

export function Timeline() {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const changeZoom = (change: number) => setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((current + change) * 10) / 10)));
  const zoomProgress = ((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;

  return (
    <section aria-label="时间线" className="h-[275px] shrink-0 border-t border-[var(--border-subtle)] bg-[#121418]">
      <div className="flex h-[52px] items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5">
        <div className="flex items-center gap-4">
          <h2 className="text-[18px] font-extrabold">时间线</h2>
          <span className="font-mono text-[14px] font-semibold text-[var(--text-secondary)]">{TIMELINE_DISPLAY_TIME}</span>
          <div className="flex gap-2"><ToolButton icon={Undo2} label="撤销" /><ToolButton icon={Redo2} label="重做" /></div>
        </div>
        <div className="flex items-center gap-2.5">
          <ToolButton icon={Scissors} label="分割" />
          <ToolButton icon={Magnet} label="吸附" active />
          <ToolButton icon={Link2} label="联动" />
          <ToolButton icon={AudioLines} label="显示波形" />
          <button type="button" aria-label="缩小时间线" onClick={() => changeZoom(-ZOOM_STEP)} className="ml-1 text-[var(--text-muted)] hover:text-white"><Minus size={15} /></button>
          <div className="relative flex h-4 w-[104px] items-center">
            <span className="h-1 w-full rounded-full bg-[#343941]" />
            <span className="pointer-events-none absolute left-0 h-1 rounded-full bg-white" style={{ width: `${zoomProgress}%` }} />
            <span className="pointer-events-none absolute top-[2px] h-3 w-3 -translate-x-1/2 rounded-full bg-white" style={{ left: `${zoomProgress}%` }} />
            <input aria-label="时间线缩放" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="absolute inset-0 w-full cursor-pointer opacity-0" />
          </div>
          <button type="button" aria-label="放大时间线" onClick={() => changeZoom(ZOOM_STEP)} className="text-[var(--text-muted)] hover:text-white"><Plus size={15} /></button>
        </div>
      </div>

      <div className="flex h-[222px]">
        <div aria-label="轨道标签" className="w-[200px] shrink-0 border-r border-[var(--border-subtle)]">
          <div className="h-[30px] border-b border-[var(--border-subtle)] bg-[#121418]" />
          <TrackLabel icon={Film} title="视频 1" subtitle="5 个分镜" />
          <TrackLabel icon={Mic} title="配音" subtitle="IndexTTS2 + 旁白" />
          <TrackLabel icon={Captions} title="字幕" subtitle="Whisper 已对齐" />
        </div>

        <div aria-label="时间片段" className="thin-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative h-full" style={{ width: `${zoom * 100}%` }}>
            <div className="relative h-[30px] border-b border-[var(--border-subtle)] bg-[#121418]">
              {RULER_MARKS.map(({ seconds, label }) => (
                <div key={seconds} className="absolute top-0 h-full border-l border-[#313741] pl-2 pt-1.5 font-mono text-[10px] whitespace-nowrap text-[var(--text-muted)]" style={{ left: positionAt(seconds) }}>
                  {label}
                </div>
              ))}
            </div>

            <div className="relative h-16 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              {VIDEO_CLIPS.map((clip) => (
                <div key={clip.label} style={clipPosition(clip.start, clip.end)} className={`absolute top-[10px] flex h-[44px] items-center gap-2.5 overflow-hidden rounded-md border px-3 text-[13px] font-semibold whitespace-nowrap ${clip.color}`}>
                  <span className={`h-[17px] w-1 rounded-full ${clip.accent}`} />
                  <span>{clip.label}</span>
                  <span className="ml-1 flex gap-1 opacity-35" aria-hidden="true"><i className="h-[15px] w-[18px] rounded bg-white/30" /><i className="h-[15px] w-[18px] rounded bg-black/25" /><i className="h-[15px] w-[18px] rounded bg-white/25" /><i className="h-[15px] w-[18px] rounded bg-black/25" /></span>
                </div>
              ))}
            </div>

            <div className="relative h-16 border-b border-[var(--border-subtle)] bg-[#101216]">
              <div style={clipPosition(0.8, 28.8)} className="absolute top-[10px] flex h-[44px] items-center overflow-hidden rounded-md border border-[#ffffff18] bg-[#245a34] px-3 text-[13px] whitespace-nowrap">IndexTTS2 口播<Waveform /></div>
              <div style={clipPosition(29.6, 34)} className="absolute top-[10px] flex h-[44px] items-center justify-between overflow-hidden rounded-md border border-[#ffffff18] bg-[#2c3038] px-2 text-[13px] whitespace-nowrap">停顿<span className="text-[#91a8a1]">Ⅱ</span></div>
              <div style={clipPosition(34.7, 56.7)} className="absolute top-[10px] flex h-[44px] items-center overflow-hidden rounded-md border border-[#ffffff18] bg-[#245a34] px-3 text-[13px] whitespace-nowrap">旁白 02<Waveform /></div>
            </div>

            <div className="relative h-16 bg-[var(--bg-panel)]">
              <div style={clipPosition(0.8, 51.5)} className="absolute top-[10px] flex h-[44px] items-center gap-3 overflow-hidden rounded-md border border-[#ffffff18] bg-[#6b471e] px-[14px] text-[13px] whitespace-nowrap">
                <Captions size={16} className="text-[var(--accent-amber)]" />Whisper 字幕 · 自动断句 · 可逐字微调
              </div>
            </div>

            <div style={{ left: positionAt(0.6) }} className="pointer-events-none absolute top-[-7px] z-20 flex h-[229px] -translate-x-1/2 flex-col items-center">
              <span className="h-[14px] w-[14px] rounded-full border-[3px] border-[#06372f] bg-[var(--accent-red)]" />
              <span className="-mt-[7px] h-[222px] w-[2px] bg-[var(--accent-red)]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
