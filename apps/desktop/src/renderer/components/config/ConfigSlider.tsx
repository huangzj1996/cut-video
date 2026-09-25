import type { ConfigSliderProps } from '../../types/config';
import { ConfigRange } from './ConfigRange';

export function ConfigSlider({ icon: Icon, label, displayValue, ...rangeProps }: ConfigSliderProps) {
  return (
    <div>
      <div className="flex h-4 items-center justify-between text-[12px] font-semibold">
        <span className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Icon size={16} strokeWidth={1.8} />
          {label}
        </span>
        <span className="font-mono text-[var(--text-primary)]">{displayValue}</span>
      </div>
      <ConfigRange {...rangeProps} label={label} className="mt-[5px]" />
    </div>
  );
}
