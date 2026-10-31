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

function subtitlePlan(): ExportPlan {
  const fontsDirectory = path.join(root, 'fonts');
  const fontFile = path.join(fontsDirectory, 'NotoSansSC-Regular.otf');
  mkdirSync(fontsDirectory, { recursive: true });
  writeFileSync(fontFile, 'font-bytes');

  return compileExportPlan({
    artifactToken: 'run-subtitles',
    ffmpegPath: 'ffmpeg',
    fonts: { directory: fontsDirectory, files: [fontFile] },
    project: createExportFixture({ subtitle: { text: '中文字幕' } }),
    targetPath: path.join(root, '成片.mp4'),
  });
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

  it('writes the ASS document and bundled font next to the target and passes cwd', async () => {
    const renderPlan = subtitlePlan();
    const subtitles = renderPlan.subtitles;

    if (!subtitles) {
      throw new Error('fixture must produce subtitle artifacts');
    }

    let observed:
      | { assExists: boolean; assText: string; cwd: string | undefined; fontExists: boolean }
      | undefined;
    const runner: ExportProcessRunner = async (request) => {
      observed = {
        assExists: existsSync(subtitles.assPath),
        assText: readFileSync(subtitles.assPath, 'utf8'),
        cwd: request.cwd,
        fontExists: existsSync(path.join(subtitles.fontsDirPath, 'NotoSansSC-Regular.otf')),
      };
      writeTemp(request);
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

  it('cleans subtitle artifacts when the render fails', async () => {
    const renderPlan = subtitlePlan();
    const subtitles = renderPlan.subtitles;

    if (!subtitles) {
      throw new Error('fixture must produce subtitle artifacts');
    }

    const runner: ExportProcessRunner = async (request) => {
      writeTemp(request);
      return { exitCode: 1, stderrTail: 'boom' };
    };

    const result = await runExportJob({ plan: renderPlan, runner });

    expect(result.ok).toBe(false);
    expect(existsSync(subtitles.assPath)).toBe(false);
    expect(existsSync(subtitles.fontsDirPath)).toBe(false);
    expect(existsSync(renderPlan.targetPath)).toBe(false);
  });

  it('reports EXPORT_FONT_MISSING when the bundled font cannot be copied', async () => {
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
  });
});
