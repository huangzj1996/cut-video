/**
 * 解析 ffmpeg 的 `-progress pipe:1` 输出，并把进度样本换算成百分比与 ETA。
 *
 * 本构建（2018 版 ffmpeg）的进度字段：每个块以 `progress=continue|end` 收尾，
 * 块内 `out_time_us` 的单位是微秒（`out_time_ms` 同值，不能当毫秒用）。
 * `progress=end` 不是成功信号：取消时 ffmpeg 也会打印 end，甚至以退出码 0 结束。
 * 因此这里只负责“显示层”的进度与 ETA，成功判定由导出任务自己看取消标记、
 * 退出码与真实产物。
 *
 * 刷新频率由上游决定：本构建 ffmpeg 没有 -stats_period，进度按内置统计节流
 * 输出（约 0.5 秒一块），正好符合 UI 约 0.5 秒刷新一次的约定。
 */

const SPEED_PATTERN = /^([0-9]+(?:\.[0-9]+)?)x$/;
const SPEED_WINDOW_SIZE = 5;

/** ffmpeg 一个进度块里我们关心的两个字段。 */
export interface RenderProgressSample {
  /** 已渲染的媒体时间（毫秒），来自 out_time_us / 1000。 */
  outTimeMs: number;
  /** 平滑前的渲染速度倍率；0 或 N/A 视为未知。 */
  speed: number | null;
}

export interface RenderProgressParser {
  /** 喂入一段 stdout 文本，返回本次完整解析出的进度块；不完整的行留在缓冲区。 */
  push(chunk: string): RenderProgressSample[];
}

function parseSpeed(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  // ffmpeg 在开头几块可能打印 0.00x 或 N/A。
  if (trimmed.length === 0 || trimmed === 'N/A') {
    return null;
  }

  const match = SPEED_PATTERN.exec(trimmed);

  if (!match) {
    return null;
  }

  const speed = Number(match[1]);

  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

/**
 * 进度块解析器：ffmpeg 的进度按块重复输出，块与块之间用 `progress=` 行分隔。
 * 解析器不假设每个 chunk 都正好是完整行，也不假设一次 push 只有一个块。
 */
export function createRenderProgressParser(): RenderProgressParser {
  let buffered = '';
  let fields = new Map<string, string>();

  const toSample = (): RenderProgressSample | null => {
    const outTimeUs = Number(fields.get('out_time_us'));

    if (!Number.isFinite(outTimeUs)) {
      return null;
    }

    return {
      // 负数/异常值按 0 处理，避免百分比与 ETA 出现负剩余。
      outTimeMs: Math.max(0, outTimeUs) / 1000,
      speed: parseSpeed(fields.get('speed')),
    };
  };

  return {
    push(chunk: string): RenderProgressSample[] {
      const samples: RenderProgressSample[] = [];
      buffered += chunk;

      const lastNewline = buffered.lastIndexOf('\n');

      if (lastNewline < 0) {
        return samples;
      }

      const complete = buffered.slice(0, lastNewline);
      buffered = buffered.slice(lastNewline + 1);

      for (const rawLine of complete.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        const separator = line.indexOf('=');

        if (separator < 0) {
          continue;
        }

        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);

        if (key === 'progress') {
          const sample = toSample();

          if (sample) {
            samples.push(sample);
          }

          fields = new Map<string, string>();
          continue;
        }

        fields.set(key, value);
      }

      return samples;
    },
  };
}

export interface EtaEstimate {
  /** 预计剩余渲染时间（毫秒）；还没有可信速度样本时为 null（显示“计算中”）。 */
  etaMs: number | null;
  /** 0..100 的整数百分比。 */
  percent: number;
  /** 单调不回退的已渲染媒体时间（毫秒）。 */
  renderedMediaMs: number;
  /** 平滑后的渲染速度倍率；未知时为 null。 */
  speed: number | null;
}

/** ETA 过期重估：已用时间超过展示 ETA 这么多毫秒后，承认旧估计失效。 */
export const ETA_RECALIBRATE_GRACE_MS = 2_000;

export interface EtaUpdateOptions {
  /** 渲染已用毫秒；提供后才启用“过期重估”。 */
  elapsedMs?: number;
}

export interface EtaEstimator {
  update(sample: RenderProgressSample, options?: EtaUpdateOptions): EtaEstimate;
}

export interface EtaEstimatorOptions {
  /** 时间线总时长（毫秒），用于百分比与剩余媒体时间。 */
  totalDurationMs: number;
  /** 速度平滑窗口：最近 N 个有效样本的中位数，默认 5。 */
  windowSize?: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];

  return lower !== undefined && upper !== undefined ? (lower + upper) / 2 : null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * ETA 估计器：用“剩余媒体时间 / 平滑后的速度”估算，显示层不回涨。
 *
 * 速度取最近几个有效样本的中位数，避免单个抖动样本把 ETA 拉飞；ETA 在第一次
 * 拿到有效速度前是 null（未知态），之后取历史最小值，普通抖动不会让界面回涨。
 *
 * 但“永远取最小值”会被第一个偏乐观的样本永久钉死：渲染早就超过展示的 ETA 还没
 * 结束时，那个估计已经被证伪。因此提供 elapsedMs 时做“过期重估”——已用时间超过
 * 展示 ETA + ETA_RECALIBRATE_GRACE_MS 后，允许按当前速度重估，避免长任务长期
 * 停在“即将完成”。
 */
export function createEtaEstimator(options: EtaEstimatorOptions): EtaEstimator {
  const totalDurationMs = Math.max(0, options.totalDurationMs);
  const windowSize = Math.max(1, options.windowSize ?? SPEED_WINDOW_SIZE);
  const speeds: number[] = [];
  let renderedMediaMs = 0;
  let displayedEtaMs: number | null = null;
  let displayedAtElapsedMs = 0;

  return {
    update(sample: RenderProgressSample, updateOptions: EtaUpdateOptions = {}): EtaEstimate {
      renderedMediaMs = Math.max(
        renderedMediaMs,
        Math.min(totalDurationMs, Math.max(0, sample.outTimeMs)),
      );

      if (sample.speed !== null && Number.isFinite(sample.speed) && sample.speed > 0) {
        speeds.push(sample.speed);

        if (speeds.length > windowSize) {
          speeds.shift();
        }
      }

      const speed = median(speeds);
      const remainingMs = Math.max(0, totalDurationMs - renderedMediaMs);
      const rawEtaMs = speed !== null ? Math.round(remainingMs / speed) : null;

      const elapsedMs = updateOptions.elapsedMs;

      if (rawEtaMs !== null) {
        if (displayedEtaMs === null) {
          displayedEtaMs = rawEtaMs;
          displayedAtElapsedMs = elapsedMs ?? 0;
        } else if (rawEtaMs < displayedEtaMs) {
          displayedEtaMs = rawEtaMs;
          displayedAtElapsedMs = elapsedMs ?? displayedAtElapsedMs;
        } else if (
          elapsedMs !== undefined &&
          elapsedMs - displayedAtElapsedMs > displayedEtaMs + ETA_RECALIBRATE_GRACE_MS
        ) {
          // 旧 ETA 已被实际耗时证伪，允许上修，避免一直停在“即将完成”。
          displayedEtaMs = rawEtaMs;
          displayedAtElapsedMs = elapsedMs;
        }
      }

      return {
        etaMs: displayedEtaMs,
        percent:
          totalDurationMs === 0 ? 100 : clampPercent((renderedMediaMs / totalDurationMs) * 100),
        renderedMediaMs: Math.round(renderedMediaMs),
        speed,
      };
    },
  };
}
