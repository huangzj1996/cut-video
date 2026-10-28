export interface RectLike {
  left: number;
  width: number;
}

export function clampTime(time: number, maxSeconds: number): number {
  const upper = Math.max(0, maxSeconds);

  return Math.min(Math.max(0, time), upper);
}

export function clientXToTime(clientX: number, rect: RectLike, maxSeconds: number): number {
  if (rect.width <= 0 || maxSeconds <= 0) {
    return 0;
  }

  const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

  return fraction * maxSeconds;
}

export function secondsToPercent(seconds: number, spanSeconds: number): number {
  if (spanSeconds <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (seconds / spanSeconds) * 100));
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
