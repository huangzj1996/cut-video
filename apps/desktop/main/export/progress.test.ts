import { describe, expect, it } from 'vitest';
import { createEtaEstimator, createRenderProgressParser } from './progress';

function block(fields: Record<string, string>, end = 'continue'): string {
  return (
    Object.entries(fields)
      .map(([key, value]) => key + '=' + value)
      .join('\n') +
    '\nprogress=' +
    end +
    '\n'
  );
}

describe('ffmpeg progress parser', () => {
  it('parses out_time_us as microseconds and the reported speed', () => {
    const parser = createRenderProgressParser();
    const samples = parser.push(
      block({ out_time_us: '2500000', out_time_ms: '2500000', speed: '12.5x' }),
    );

    expect(samples).toEqual([{ outTimeMs: 2_500, speed: 12.5 }]);
  });

  it('returns one sample per progress block and keeps the remainder buffered', () => {
    const parser = createRenderProgressParser();
    const samples = parser.push(
      block({ out_time_us: '500000', speed: '2.0x' }) +
        block({ out_time_us: '1000000', speed: '4.0x' }) +
        'out_time_us=1500',
    );

    expect(samples.map((sample) => sample.outTimeMs)).toEqual([500, 1_000]);

    const rest = parser.push('000\nspeed=6.0x\nprogress=end\n');

    expect(rest).toEqual([{ outTimeMs: 1_500, speed: 6 }]);
  });

  it('treats missing or unusable speed as unknown', () => {
    const parser = createRenderProgressParser();
    const samples = parser.push(
      block({ out_time_us: '1000000', speed: 'N/A' }) + block({ out_time_us: '2000000' }),
    );

    expect(samples).toEqual([
      { outTimeMs: 1_000, speed: null },
      { outTimeMs: 2_000, speed: null },
    ]);
  });

  it('ignores progress blocks without a usable out_time_us', () => {
    const parser = createRenderProgressParser();

    expect(parser.push('speed=10.0x\nprogress=continue\n')).toEqual([]);
  });
});

describe('export ETA estimator', () => {
  const TOTAL_MS = 60_000;

  it('reports the real percentage and no ETA until a usable speed sample arrives', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS });
    const first = estimator.update({ outTimeMs: 6_000, speed: null });

    expect(first).toMatchObject({ etaMs: null, percent: 10, renderedMediaMs: 6_000, speed: null });

    const second = estimator.update({ outTimeMs: 12_000, speed: 2 });

    expect(second).toMatchObject({ percent: 20, renderedMediaMs: 12_000, speed: 2 });
    // 剩余 48s，速度 2x → 24s。
    expect(second.etaMs).toBe(24_000);
  });

  it('smooths speed with a median window', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS });
    const estimates = [
      estimator.update({ outTimeMs: 10_000, speed: 10 }),
      estimator.update({ outTimeMs: 20_000, speed: 10 }),
      estimator.update({ outTimeMs: 30_000, speed: 1 }),
    ];

    // 第三个样本速度骤降，但窗口里仍是 10x 占多数（中位数），ETA 不被抖动带飞。
    expect(estimates.map((estimate) => estimate.speed)).toEqual([10, 10, 10]);
    expect(estimates.map((estimate) => estimate.etaMs)).toEqual([5_000, 4_000, 3_000]);
  });

  it('never lets the displayed ETA grow when the raw estimate regresses', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS, windowSize: 1 });
    const first = estimator.update({ outTimeMs: 10_000, speed: 10 });
    const stalled = estimator.update({ outTimeMs: 11_000, speed: 1 });

    expect(first.etaMs).toBe(5_000);
    // 原始 ETA 变成 49s，但显示层保持不回涨。
    expect(stalled.etaMs).toBe(5_000);
  });

  it('re-estimates once the old ETA has been proven optimistic instead of staying pinned', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS, windowSize: 1 });
    const optimistic = estimator.update({ outTimeMs: 10_000, speed: 10 }, { elapsedMs: 0 });

    expect(optimistic.etaMs).toBe(5_000);

    // 已用 9s 还没渲染完（5s ETA + 2s 宽限已过），速度回落到 1x：允许上修到真实剩余。
    const corrected = estimator.update({ outTimeMs: 11_000, speed: 1 }, { elapsedMs: 9_000 });

    expect(corrected.etaMs).toBe(49_000);
  });

  it('keeps the ETA pinned while it has not expired yet', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS, windowSize: 1 });
    estimator.update({ outTimeMs: 10_000, speed: 10 }, { elapsedMs: 0 });
    const stillValid = estimator.update({ outTimeMs: 11_000, speed: 1 }, { elapsedMs: 6_000 });

    // 6s 还没超过 5s ETA + 2s 宽限：显示层仍然不回涨。
    expect(stillValid.etaMs).toBe(5_000);
  });

  it('keeps percentage and rendered media time monotonic on regressed samples', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS });
    estimator.update({ outTimeMs: 30_000, speed: 2 });
    const regressed = estimator.update({ outTimeMs: 20_000, speed: 2 });

    expect(regressed).toMatchObject({ percent: 50, renderedMediaMs: 30_000 });
  });

  it('clamps the percentage to 100 and drops the ETA to zero at the end', () => {
    const estimator = createEtaEstimator({ totalDurationMs: TOTAL_MS });
    estimator.update({ outTimeMs: 30_000, speed: 2 });
    const done = estimator.update({ outTimeMs: 90_000, speed: 2 });

    expect(done).toMatchObject({ etaMs: 0, percent: 100, renderedMediaMs: TOTAL_MS });
  });
});
