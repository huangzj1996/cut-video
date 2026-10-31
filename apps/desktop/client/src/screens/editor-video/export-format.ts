/**
 * 导出进度的纯格式化函数：只做展示换算，方便在 reducer/组件之外单测。
 *
 * 时间口径：已用时间向下取整（不提前跳秒），预计剩余向上取整（避免提前归零）；
 * 不足 1 小时用 mm:ss，达到 1 小时用 h:mm:ss，小时不补零。
 */

const CALCULATING = '计算中';
const IMMINENT = '即将完成';

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function formatExportEta(etaMs: number | null): string {
  // 负数说明估算尚未稳定，按“没有估算”处理，避免展示已过期的时间。
  if (etaMs === null || !Number.isFinite(etaMs) || etaMs < 0) {
    return CALCULATING;
  }

  if (etaMs < 3000) {
    return IMMINENT;
  }

  return formatClock(Math.ceil(etaMs / 1000));
}

export function formatExportElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return '00:00';
  }

  return formatClock(Math.floor(elapsedMs / 1000));
}

export function formatExportSpeed(speed: number | null): string {
  if (speed === null || !Number.isFinite(speed) || speed <= 0) {
    return CALCULATING;
  }

  return `${speed.toFixed(1)}x`;
}

/** 同步自检的客观数字：毫秒保留一位小数；没有测量值时不编数字。 */
export function formatExportDelta(deltaMs: number | null): string {
  if (deltaMs === null || !Number.isFinite(deltaMs) || deltaMs < 0) {
    return '—';
  }

  return (Math.round(deltaMs * 10) / 10).toFixed(1) + 'ms';
}

export function formatExportPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) {
    return '—';
  }

  // 渲染线程偶尔会给出越界值；这里夹紧到 0..100，保证可以直接用于展示。
  return `${Math.round(Math.min(100, Math.max(0, percent)))}%`;
}
