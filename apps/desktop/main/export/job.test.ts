import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_CANCEL_GRACE_MS, startExportJob } from './job';
import { compileExportPlan, type ExportPlan } from './plan';
import type { ExportProcessRequest, ExportProcessRunner } from './runner';
import { buildFfprobeArgs, syncToleranceMs } from './sync-check';
import { createFakeProcess, okProcess, type FakeProcess } from './test-support/fake-process';
import { createExportFixture } from './test-support/fixture';
import { GOLDEN_SYNC_OFFSET_FFPROBE_JSON } from './test-support/ffprobe-golden';
import { ffprobeAnswerFor, isProbeRequest } from './test-support/probe';

let root: string;
let plan: ExportPlan;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-job-'));
  plan = compileExportPlan({
    artifactToken: 'run-1',
    ffmpegPath: 'ffmpeg',
    fonts: null,
    project: createExportFixture({ musicPath: 'C:/media/music.mp3' }),
    targetPath: path.join(root, '成片.mp4'),
  });
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { force: true, recursive: true });
});

function writeLastArg(request: ExportProcessRequest): void {
  const outputPath = request.args.at(-1);

  if (outputPath) {
    writeFileSync(outputPath, 'fake-media');
  }
}

function isPremixRequest(request: ExportProcessRequest): boolean {
  return request.args === plan.premix.args;
}

/**
 * 成功进程。探测请求（ffprobe）要写出一份“正常成片”的 ffprobe 输出，
 * 否则导出任务会按 fail closed 处理，把不可读的媒体信息判成自检失败。
 */
function okFor(request: ExportProcessRequest): FakeProcess {
  if (isProbeRequest(request)) {
    request.onStdoutChunk?.(ffprobeAnswerFor(plan.expected));
  }

  return createFakeProcess({ autoExit: okProcess() });
}

function requireProcess(value: FakeProcess | null): FakeProcess {
  if (value === null) {
    throw new Error('渲染进程应该已经启动');
  }

  return value;
}

describe('export job', () => {
  it('premixes audio, renders video and commits only after both phases succeed', async () => {
    const phases: string[] = [];
    const received: string[][] = [];
    const runner: ExportProcessRunner = (request) => {
      received.push(request.args);
      writeLastArg(request);

      return okFor(request);
    };

    const result = await startExportJob({
      ffprobePath: 'ffprobe',
      onPhase: (phase) => phases.push(phase),
      plan,
      runner,
    }).result;

    expect(result).toMatchObject({ ok: true, outputPath: plan.targetPath });
    expect(phases).toEqual(['mixing', 'rendering', 'verifying', 'committing']);
    expect(received).toEqual([
      plan.premix.args,
      plan.render.args,
      buildFfprobeArgs(plan.temporaryPath),
    ]);
    expect(existsSync(plan.targetPath)).toBe(true);
    expect(existsSync(plan.temporaryPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('does not render video when the premix fails and cleans every temp artifact', async () => {
    const received: string[][] = [];
    const runner: ExportProcessRunner = (request) => {
      received.push(request.args);
      writeLastArg(request);

      return createFakeProcess({ autoExit: { exitCode: 1, stderrTail: 'premix boom' } });
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : 'error' in result ? result.error.message : '').toContain('预混音轨');
    expect(result.ok ? null : 'error' in result ? result.error.detail : '').toContain(
      'premix boom',
    );
    expect(received).toHaveLength(1);
    expect(isPremixRequest({ args: received[0] ?? [] } as ExportProcessRequest)).toBe(true);
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('treats a premix spawn error as a failure without touching the video phase', async () => {
    let calls = 0;
    const runner: ExportProcessRunner = () => {
      calls += 1;

      return createFakeProcess({
        autoExit: { exitCode: null, spawnError: 'ENOENT', stderrTail: '' },
      });
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('rejects a zero exit code without a premix file', async () => {
    const runner: ExportProcessRunner = (request) => okFor(request);

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : 'error' in result ? result.error.message : '').toContain('预混音轨');
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('does not commit when rendering fails after a successful premix and keeps the stderr tail', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      return createFakeProcess({
        autoExit: isPremixRequest(request)
          ? okProcess()
          : { exitCode: 1, stderrTail: 'render boom' },
      });
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    expect(result.ok).toBe(false);
    const error = result.ok ? null : 'error' in result ? result.error : null;
    expect(error?.code).toBe('EXPORT_RENDER_FAILED');
    expect(error?.detail).toContain('render boom');
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('rejects exit code 0 without a usable output file', async () => {
    const runner: ExportProcessRunner = (request) =>
      createFakeProcess({
        autoExit: isPremixRequest(request) ? (writeLastArg(request), okProcess()) : okProcess(),
      });

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : 'error' in result ? result.error.code : '').toBe(
      'EXPORT_RENDER_FAILED',
    );
    expect(existsSync(plan.targetPath)).toBe(false);
  });
});

describe('export job progress', () => {
  it('forwards parsed rendering samples and never reports premix progress', async () => {
    const samples: { outTimeMs: number; speed: number | null }[] = [];
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (!isPremixRequest(request) && !isProbeRequest(request)) {
        request.onStdoutChunk?.('out_time_us=500000\nspeed=2.0x\nprogress=continue\n');
        request.onStdoutChunk?.('out_time_us=1500000\nspeed=2.5x\nprogress=end\n');
      }

      return okFor(request);
    };

    const result = await startExportJob({
      ffprobePath: 'ffprobe',
      onProgress: (sample) => samples.push(sample),
      plan,
      runner,
    }).result;

    expect(result.ok).toBe(true);
    expect(samples).toEqual([
      { outTimeMs: 500, speed: 2 },
      { outTimeMs: 1_500, speed: 2.5 },
    ]);
  });
});

describe('export job sync self-check', () => {
  it('checks the rendered file before committing and reports the measured numbers', async () => {
    const received: string[][] = [];
    const runner: ExportProcessRunner = (request) => {
      received.push(request.args);
      writeLastArg(request);

      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;

    if (!result.ok) {
      throw new Error('export should succeed');
    }

    expect(received.at(-2)).toEqual(plan.render.args);
    expect(received.at(-1)).toEqual(buildFfprobeArgs(plan.temporaryPath));
    expect(received).toHaveLength(3);
    expect(result.sync.passed).toBe(true);
    expect(result.sync.toleranceMs).toBeCloseTo(syncToleranceMs(30), 6);
    expect(result.sync.measurements).toEqual({
      audioDurationMs: 2_000,
      audioStartMs: 0,
      durationDeltaMs: 0,
      startDeltaMs: 0,
      videoDurationMs: 2_000,
      videoStartMs: 0,
    });
    expect(existsSync(plan.targetPath)).toBe(true);
  });

  it('refuses to commit a file that fails the sync self-check and cleans every temp artifact', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isProbeRequest(request)) {
        // 真实注入 100ms 音轨偏移后的 ffprobe 输出：音频起点 78ms、时长 1.941333s。
        request.onStdoutChunk?.(GOLDEN_SYNC_OFFSET_FFPROBE_JSON);

        return createFakeProcess({ autoExit: okProcess() });
      }

      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;
    const error = result.ok ? null : 'error' in result ? result.error : null;

    expect(result.ok).toBe(false);
    expect(error?.code).toBe('EXPORT_SYNC_CHECK_FAILED');
    expect(error?.message).toContain('同步自检未通过');
    expect(error?.message).toContain('起点差');
    expect(error?.detail).toContain('audio starts at');
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('fails closed when ffprobe cannot read the rendered file', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isProbeRequest(request)) {
        return createFakeProcess({
          autoExit: { exitCode: 1, stderrTail: 'invalid data found when processing input' },
        });
      }

      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;
    const error = result.ok ? null : 'error' in result ? result.error : null;

    expect(error?.code).toBe('EXPORT_SYNC_CHECK_FAILED');
    expect(error?.message).toContain('读取成片媒体信息失败');
    expect(error?.detail).toContain('invalid data found when processing input');
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('fails closed when ffprobe returns output that is not media JSON', async () => {
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isProbeRequest(request)) {
        request.onStdoutChunk?.('not a probe result');

        return createFakeProcess({ autoExit: okProcess() });
      }

      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan, runner }).result;
    const error = result.ok ? null : 'error' in result ? result.error : null;

    expect(error?.code).toBe('EXPORT_SYNC_CHECK_FAILED');
    expect(error?.message).toContain('无法读取成片媒体信息');
    expect(existsSync(plan.targetPath)).toBe(false);
  });

  it('cancels during the sync self-check without committing', async () => {
    let probeProcess: FakeProcess | null = null;
    let markProbeStarted: () => void = () => undefined;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isProbeRequest(request)) {
        probeProcess = createFakeProcess({ exitOnQuit: okProcess() });
        markProbeStarted();

        return probeProcess;
      }

      return okFor(request);
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    await probeStarted;
    job.cancel();
    const result = await job.result;

    expect(result).toEqual({ cancelled: true, ok: false, phase: 'verifying' });
    expect(requireProcess(probeProcess).quitCount).toBe(1);
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });
});

describe('export job cancellation', () => {
  it('cancels during premix by asking the process to quit and never rendering or committing', async () => {
    const quits: string[] = [];
    let renderStarted = false;
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (!isPremixRequest(request)) {
        renderStarted = true;

        return okFor(request);
      }

      return createFakeProcess({
        exitOnQuit: okProcess(),
        onQuit: () => quits.push('premix'),
      });
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    job.cancel();
    const result = await job.result;

    expect(result).toEqual({ cancelled: true, ok: false, phase: 'mixing' });
    expect(quits).toEqual(['premix']);
    expect(renderStarted).toBe(false);
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('cancels during rendering with a graceful quit and removes every temp artifact', async () => {
    let renderProcess: FakeProcess | null = null;
    let markRenderStarted: () => void = () => undefined;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isPremixRequest(request)) {
        return okFor(request);
      }

      renderProcess = createFakeProcess({ exitOnQuit: { exitCode: 0, stderrTail: '' } });
      markRenderStarted();

      return renderProcess;
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    await renderStarted;
    job.cancel();
    const result = await job.result;

    expect(result).toEqual({ cancelled: true, ok: false, phase: 'rendering' });
    expect(requireProcess(renderProcess).quitCount).toBe(1);
    expect(requireProcess(renderProcess).killCount).toBe(0);
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('force-kills the process tree after the three second grace period', async () => {
    vi.useFakeTimers();
    let renderProcess: FakeProcess | null = null;
    let markRenderStarted: () => void = () => undefined;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isPremixRequest(request)) {
        return okFor(request);
      }

      renderProcess = createFakeProcess();
      markRenderStarted();

      return renderProcess;
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    await renderStarted;
    job.cancel();

    expect(requireProcess(renderProcess).killCount).toBe(0);

    await vi.advanceTimersByTimeAsync(EXPORT_CANCEL_GRACE_MS);

    expect(requireProcess(renderProcess).killCount).toBe(1);
    requireProcess(renderProcess).resolve({ exitCode: null, stderrTail: '' });
    const result = await job.result;

    expect(result).toEqual({ cancelled: true, ok: false, phase: 'rendering' });
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('does not commit when cancellation lands between render exit and commit', async () => {
    let renderProcess: FakeProcess | null = null;
    let markRenderStarted: () => void = () => undefined;
    const renderStarted = new Promise<void>((resolve) => {
      markRenderStarted = resolve;
    });
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      if (isPremixRequest(request)) {
        return okFor(request);
      }

      renderProcess = createFakeProcess();
      markRenderStarted();

      return renderProcess;
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    await renderStarted;
    requireProcess(renderProcess).resolve(okProcess());
    // 在渲染退出后的 continuation 之前同步请求取消：提交前必须看到取消标记。
    job.cancel();
    const result = await job.result;

    expect(result).toEqual({ cancelled: true, ok: false, phase: 'rendering' });
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('ignores cancellation after the export already succeeded', async () => {
    let quits = 0;
    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);
      const fake = isProbeRequest(request)
        ? okFor(request)
        : createFakeProcess({ autoExit: okProcess() });
      fake.requestQuit = () => {
        quits += 1;
      };

      return fake;
    };

    const job = startExportJob({ ffprobePath: 'ffprobe', plan, runner });
    const result = await job.result;
    job.cancel();

    expect(result.ok).toBe(true);
    expect(quits).toBe(0);
    expect(existsSync(plan.targetPath)).toBe(true);
  });
});

function subtitlePlan(): ExportPlan {
  const fontsDirectory = path.join(root, 'fonts');
  const fontFile = path.join(fontsDirectory, 'NotoSansSC-Regular.otf');
  mkdirSync(fontsDirectory, { recursive: true });
  writeFileSync(fontFile, 'font-bytes');

  return compileExportPlan({
    artifactToken: 'run-subtitles',
    ffmpegPath: 'ffmpeg',
    fonts: { directory: fontsDirectory, files: [fontFile] },
    project: createExportFixture({
      musicPath: 'C:/media/music.mp3',
      subtitle: { text: '中文字幕' },
    }),
    targetPath: path.join(root, '成片.mp4'),
  });
}

describe('export job subtitle artifacts', () => {
  it('writes the ASS document and bundled font and passes cwd to the render process', async () => {
    const renderPlan = subtitlePlan();
    const subtitles = renderPlan.subtitles;

    if (!subtitles) {
      throw new Error('fixture must produce subtitle artifacts');
    }

    let observed:
      | { assExists: boolean; assText: string; cwd: string | undefined; fontExists: boolean }
      | undefined;
    const runner: ExportProcessRunner = (request) => {
      if (request.args === renderPlan.render.args) {
        observed = {
          assExists: existsSync(subtitles.assPath),
          assText: readFileSync(subtitles.assPath, 'utf8'),
          cwd: request.cwd,
          fontExists: existsSync(path.join(subtitles.fontsDirPath, 'NotoSansSC-Regular.otf')),
        };
      }

      writeLastArg(request);
      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan: renderPlan, runner })
      .result;

    expect(result.ok).toBe(true);
    expect(observed?.cwd).toBe(path.dirname(renderPlan.targetPath));
    expect(observed?.assExists).toBe(true);
    expect(observed?.fontExists).toBe(true);
    expect(observed?.assText).toContain('[Script Info]');
    expect(observed?.assText).toContain('中文字幕');
    // 字幕与字体是临时产物：成功后不能留在导出目录里。
    expect(existsSync(subtitles.assPath)).toBe(false);
    expect(existsSync(subtitles.fontsDirPath)).toBe(false);
  });

  it('cleans subtitle artifacts when rendering fails after a successful premix', async () => {
    const renderPlan = subtitlePlan();
    const subtitles = renderPlan.subtitles;

    if (!subtitles) {
      throw new Error('fixture must produce subtitle artifacts');
    }

    const runner: ExportProcessRunner = (request) => {
      writeLastArg(request);

      return createFakeProcess({
        autoExit:
          request.args === renderPlan.premix.args
            ? okProcess()
            : { exitCode: 1, stderrTail: 'render boom' },
      });
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan: renderPlan, runner })
      .result;

    expect(result.ok).toBe(false);
    expect(existsSync(subtitles.assPath)).toBe(false);
    expect(existsSync(subtitles.fontsDirPath)).toBe(false);
    expect(existsSync(renderPlan.targetPath)).toBe(false);
  });

  it('reports EXPORT_FONT_MISSING before premixing when the bundled font cannot be copied', async () => {
    const missingFont = path.join(root, 'missing-fonts', 'NotoSansSC-Regular.otf');
    const renderPlan = compileExportPlan({
      artifactToken: 'run-missing-fonts',
      ffmpegPath: 'ffmpeg',
      fonts: { directory: path.dirname(missingFont), files: [missingFont] },
      project: createExportFixture({ subtitle: {} }),
      targetPath: path.join(root, '成片.mp4'),
    });
    let called = false;
    const runner: ExportProcessRunner = (request) => {
      called = true;

      return okFor(request);
    };

    const result = await startExportJob({ ffprobePath: 'ffprobe', plan: renderPlan, runner })
      .result;

    expect(result.ok).toBe(false);
    expect(result.ok ? null : 'error' in result ? result.error.code : '').toBe(
      'EXPORT_FONT_MISSING',
    );
    expect(called).toBe(false);
    expect(existsSync(renderPlan.temporaryPath)).toBe(false);
    expect(existsSync(renderPlan.premixTemporaryPath)).toBe(false);
  });
});
