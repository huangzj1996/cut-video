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
    project: createExportFixture(),
    targetPath: path.join(root, '成片.mp4'),
  });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function writeTemp(request: { args: string[] }): void {
  const temporaryPath = request.args.at(-1);

  if (temporaryPath) {
    writeFileSync(temporaryPath, 'fake-mp4');
  }
}

describe('export job', () => {
  it('renders to the partial file and commits only after success', async () => {
    const phases: string[] = [];
    const received: string[][] = [];
    const runner: ExportProcessRunner = async (request) => {
      received.push(request.args);
      writeTemp(request);
      return { exitCode: 0, stderrTail: '' };
    };

    const result = await runExportJob({
      onPhase: (phase) => phases.push(phase),
      plan,
      runner,
    });

    expect(result).toEqual({ ok: true, outputPath: plan.targetPath });
    expect(phases).toEqual(['rendering', 'committing']);
    expect(received[0]).toEqual(plan.ffmpeg.args);
    expect(existsSync(plan.targetPath)).toBe(true);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('does not commit on a non-zero exit code and removes the partial file', async () => {
    const runner: ExportProcessRunner = async (request) => {
      writeTemp(request);
      return { exitCode: 1, stderrTail: 'boom' };
    };

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_RENDER_FAILED');
    expect(existsSync(plan.targetPath)).toBe(false);
    expect(existsSync(plan.temporaryPath)).toBe(false);
  });

  it('treats a spawn error as a render failure', async () => {
    const runner: ExportProcessRunner = async () => ({
      exitCode: null,
      spawnError: 'ENOENT',
      stderrTail: '',
    });

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(existsSync(plan.targetPath)).toBe(false);
  });

  it('rejects exit code 0 without a usable output file', async () => {
    const runner: ExportProcessRunner = async () => ({ exitCode: 0, stderrTail: '' });

    const result = await runExportJob({ plan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_RENDER_FAILED');
    expect(existsSync(plan.targetPath)).toBe(false);
  });
});
