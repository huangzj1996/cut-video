import { Play } from 'lucide-react';
import type { Voice } from '../../../types/voiceover';

export function VoiceOption({
  voice,
  selected,
  onSelect,
}: {
  voice: Voice;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex h-[54px] w-full items-center justify-between rounded-[10px] border px-3 text-left ${selected ? 'border-[var(--accent-red)] bg-[#f0607333]' : 'border-[var(--border-subtle)] bg-[#13161b] hover:border-[#525966]'}`}
    >
      <span className="min-w-0">
        <strong className={`block truncate text-[13px] font-bold ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{voice.name}</strong>
        <span className={`mt-1 block truncate text-[10px] font-semibold ${selected ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>{voice.description}</span>
      </span>
      <span aria-hidden="true" className={`ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-[#f0607340] text-[var(--accent-red)]' : 'bg-[#20242b] text-[var(--text-secondary)]'}`}>
        <Play size={12} strokeWidth={1.8} />
      </span>
    </button>
  );
}
