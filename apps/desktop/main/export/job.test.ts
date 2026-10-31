import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    artifactToken: 'run-1',
    ffmpegPath: 'ffmpeg',
    fonts: null,
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
    const runner: ExportProcessRunner = async (request) => {
      if (request.args === renderPlan.render.args) {
        observed = {
          assExists: existsSync(subtitles.assPath),
          assText: readFileSync(subtitles.assPath, 'utf8'),
          cwd: request.cwd,
          fontExists: existsSync(path.join(subtitles.fontsDirPath, 'NotoSansSC-Regular.otf')),
        };
      }

      writeLastArg(request);
      return { exitCode: 0, stderrTail: '' };
    };

    const result = await runExportJob({ plan: renderPlan, runner });

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

    const runner: ExportProcessRunner = async (request) => {
      writeLastArg(request);

      return request.args === renderPlan.premix.args
        ? { exitCode: 0, stderrTail: '' }
        : { exitCode: 1, stderrTail: 'render boom' };
    };

    const result = await runExportJob({ plan: renderPlan, runner });

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
    const runner: ExportProcessRunner = async () => {
      called = true;
      return { exitCode: 0, stderrTail: '' };
    };

    const result = await runExportJob({ plan: renderPlan, runner });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.code).toBe('EXPORT_FONT_MISSING');
    expect(called).toBe(false);
    expect(existsSync(renderPlan.temporaryPath)).toBe(false);
    expect(existsSync(renderPlan.premixTemporaryPath)).toBe(false);
  });
});
