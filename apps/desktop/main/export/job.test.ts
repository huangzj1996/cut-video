import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runExportJob } from './job';
import { compileExportPlan, type ExportPlan } from './plan';
import type { ExportProcessRunner } from './runner';
import { createExportFixture } from './test-support/fixture';

let root: string;
let plan: ExportPlan;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-job-'));
  plan = compileExportPlan({
    ffmpegPath: 'ffmpeg',
    project: createExportFixture({ musicPath: 'C:/media/music.mp3' }),
    targetPath: path.join(root, '成片.mp4'),
  });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function writeLastArg(request: { args: string[] }): void {
  const outputPath = request.args.at(-1);

  if (outputPath) {
    writeFileSync(outputPath, 'fake-media');
  }
}

function isPremixRequest(request: { args: string[] }): boolean {
  return request.args.at(-1) === plan.premixTemporaryPath;
}

describe('export job', () => {
  it('premixes audio, renders video and commits only after both phases succeed', async () => {
    const phases: string[] = [];
    const received: string[][] = [];
    const runner: ExportProcessRunner = async (request) => {
      received.push(request.args);
      writeLastArg(request);
      return { exitCode: 0, stderrTail: '' };
    };

    const result = await runExportJob({
      onPhase: (phase) => phases.push(phase),
      plan,
      runner,
    });

    expect(result).toEqual({ ok: true, outputPath: plan.targetPath });
    expect(phases).toEqual(['mixing', 'rendering', 'committing']);
    expect(received).toEqual([plan.premix.args, plan.render.args]);
    expect(existsSync(plan.targetPath)).toBe(true);
    expect(existsSync(plan.temporaryPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('does not render video when the premix fails and cleans every temp artifact', async () => {
    const received: string[][] = [];
    const runner: ExportProcessRunner = async (request) => {
      received.push(request.args);
      writeLastArg(request);
      return { exitCode: 1, stderrTail: 'premix boom' };
    };

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_RENDER_FAILED');
    expect(result.ok ? null : result.error.message).toContain('预混音轨');
    expect(received).toHaveLength(1);
    expect(isPremixRequest({ args: received[0] ?? [] })).toBe(true);
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('treats a premix spawn error as a failure without touching the video phase', async () => {
    let calls = 0;
    const runner: ExportProcessRunner = async () => {
      calls += 1;
      return { exitCode: null, spawnError: 'ENOENT', stderrTail: '' };
    };

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
  });

  it('rejects a zero exit code without a premix file', async () => {
    const runner: ExportProcessRunner = async () => ({ exitCode: 0, stderrTail: '' });

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.message).toContain('预混音轨');
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('does not commit when rendering fails after a successful premix and cleans both artifacts', async () => {
    const runner: ExportProcessRunner = async (request) => {
      writeLastArg(request);

      return isPremixRequest(request)
        ? { exitCode: 0, stderrTail: '' }
        : { exitCode: 1, stderrTail: 'render boom' };
    };

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_RENDER_FAILED');
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.premixTemporaryPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('rejects exit code 0 without a usable output file', async () => {
    const runner: ExportProcessRunner = async (request) =>
      isPremixRequest(request)
        ? (writeLastArg(request), { exitCode: 0, stderrTail: '' })
        : { exitCode: 0, stderrTail: '' };

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_RENDER_FAILED');
    expect(existsSync(plan.targetPath)).toBe(false);
  });
});
