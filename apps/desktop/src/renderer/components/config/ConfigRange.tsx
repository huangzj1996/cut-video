import type { ConfigRangeProps } from '../../types/config';

export function ConfigRange({ label, value, min, max, step, onChange, className = '', progressColor = '#ffffff' }: ConfigRangeProps) {
  const progress = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <div className={`config-range relative h-4 rounded-full ${className}`}>
      <span className="absolute top-[5px] h-[6px] w-full rounded-full bg-[#30343c]" />
      <span className="pointer-events-none absolute top-[5px] h-[6px] rounded-full" style={{ width: `${progress}%`, backgroundColor: progressColor }} />
      <span className="pointer-events-none absolute top-0 h-4 w-4 -translate-x-1/2 rounded-full border-[3px] border-[var(--bg-app)] bg-white" style={{ left: `${progress}%` }} />
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
