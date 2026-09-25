import { Gauge, Mic, Plus, Volume2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { DEFAULT_SPEED, DEFAULT_VOICE_ID, DEFAULT_VOLUME, VOICES } from '../../../constants/voiceover';
import { ConfigCard } from '../ConfigCard';
import { ConfigPanelHeader } from '../ConfigPanelHeader';
import { ConfigSlider } from '../ConfigSlider';
import { VoiceOption } from './VoiceOption';

export function VoiceoverPanel() {
  const [selectedVoice, setSelectedVoice] = useState<string>(DEFAULT_VOICE_ID);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <ConfigPanelHeader className="pt-5">
        <div className="flex h-[54px] flex-col gap-[5px]">
          <h2 className="text-[20px] leading-6 font-extrabold">口播配音</h2>
          <p className="text-[11px] font-semibold text-[var(--text-muted)]">为当前分镜生成旁白音轨</p>
        </div>
      </ConfigPanelHeader>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <ConfigCard className="mt-[18px] h-[284px] p-[13px]">
          <h3 className="text-[14px] leading-5 font-extrabold">选择音色</h3>
          <p className="mt-[3px] text-[11px] font-semibold text-[var(--text-muted)]">系统音色与自定义音色库 · 支持试听</p>
          <div className="mt-[13px] grid grid-cols-2 gap-2">
            {VOICES.map((voice) => (
              <VoiceOption
                key={voice.id}
                voice={voice}
                selected={selectedVoice === voice.id}
                onSelect={() => setSelectedVoice(voice.id)}
              />
            ))}
          </div>
          <div className="mt-4 h-[72px] rounded-xl border border-[#3a3f49] bg-[#101216] px-[9px] pt-[9px]">
            <input
              ref={referenceInput}
              type="file"
              accept="audio/*"
              aria-label="选择自定义音色参考音频"
              className="sr-only"
              onChange={(event) => setReferenceName(event.target.files?.[0]?.name ?? null)}
            />
            <button type="button" onClick={() => referenceInput.current?.click()} className="flex items-center gap-1 text-[12px] font-extrabold text-[var(--text-primary)]">
              <Plus size={16} />
              自定义音色库
            </button>
            <p className="mt-1 truncate text-[10px] font-semibold text-[var(--text-muted)]">
              {referenceName ?? '上传 10 s 内音频，保存后可直接作为音色使用'}
            </p>
          </div>
        </ConfigCard>

        <ConfigCard className="mt-4 h-[148px] px-[14px] pt-[13px]">
          <h3 className="text-[14px] leading-5 font-extrabold">参数调整</h3>
          <div className="mt-[13px]">
            <ConfigSlider icon={Volume2} label="音量" value={volume} min={0} max={100} step={1} displayValue={`${volume}%`} onChange={setVolume} />
          </div>
          <div className="mt-[13px]">
            <ConfigSlider icon={Gauge} label="语速" value={speed} min={0.5} max={1.4} step={0.05} displayValue={`${speed.toFixed(2)}x`} onChange={setSpeed} />
          </div>
        </ConfigCard>
      </div>

      <div className="flex h-[76px] shrink-0 items-center justify-center px-4 pb-6">
        <button type="button" className="flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent-red)] text-[13px] font-extrabold text-white hover:brightness-110">
          <Mic size={15} strokeWidth={2} />
          生成口播音轨
        </button>
      </div>
    </>
  );
}
