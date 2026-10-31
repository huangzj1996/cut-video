import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeVideo } from '@miaoma/video-agent';
import type { ExportState } from '../../shared/ipc-contract';
import { ProjectStore } from '../projects/project-store';
import { compileExportPlan } from './plan';
import { ExportService } from './service';
import { createExportFixture } from './test-support/fixture';

const FFMPEG =
  process.platform === 'win32' ? path.resolve('resources/ffmpeg/ffmpeg.exe') : 'ffmpeg';
const FFPROBE =
  process.platform === 'win32' ? path.resolve('resources/ffmpeg/ffprobe.exe') : 'ffprobe';
const FONT_FILE = path.resolve('resources/fonts/NotoSansSC-Regular.otf');
const FONTS = { directory: path.dirname(FONT_FILE), files: [FONT_FILE] };

function canRun(binary: string): boolean {
  return spawnSync(binary, ['-version'], { windowsHide: true }).status === 0;
}

const HAS_FFMPEG = canRun(FFMPEG) && canRun(FFPROBE);

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-integration-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
  }
});

function generateClip(filePath: string, color: string): void {
  const result = spawnSync(
    FFMPEG,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=' + color + ':s=640x360:d=2:r=30',
      '-pix_fmt',
      'yuv420p',
      filePath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error('ffmpeg fixture failed: ' + result.stderr);
  }
}

interface Rgb {
  b: number;
  g: number;
  r: number;
}

interface CropArea {
  height: number;
  width: number;
  x: number;
  y: number;
}

/** 抽取一帧的指定区域，统计接近白色的像素数，用来证明字幕字形真的烧进了成片。 */
function countNearWhitePixels(filePath: string, frameIndex: number, area: CropArea): number {
  const result = spawnSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-i',
      filePath,
      '-vf',
      'select=eq(n\\,' +
        frameIndex +
        '),crop=' +
        area.width +
        ':' +
        area.height +
        ':' +
        area.x +
        ':' +
        area.y,
      '-vsync',
      '0',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error('ffmpeg frame extraction failed: ' + String(result.stderr));
  }

  const data: Buffer = result.stdout;
  let count = 0;

  for (let offset = 0; offset + 2 < data.length; offset += 3) {
    if (
      (data[offset] ?? 0) > 200 &&
      (data[offset + 1] ?? 0) > 200 &&
      (data[offset + 2] ?? 0) > 200
    ) {
      count += 1;
    }
  }

  return count;
}

/** 抽取指定输出帧并缩为 1 像素，用来证明片段边界落在正确帧上。 */
function frameColor(filePath: string, frameIndex: number): Rgb {
  const result = spawnSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-i',
      filePath,
      '-vf',
      'select=eq(n\\,' + frameIndex + '),scale=1:1',
      '-vsync',
      '0',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { maxBuffer: 8 * 1024 * 1024, windowsHide: true },
  );

  if (result.status !== 0 || result.stdout.length < 3) {
    throw new Error('ffmpeg frame extraction failed: ' + String(result.stderr));
  }

  return { b: result.stdout[2] ?? 0, g: result.stdout[1] ?? 0, r: result.stdout[0] ?? 0 };
}

describe.skipIf(!HAS_FFMPEG)('export integration', () => {
  it('renders a playable 1920x1080 30fps MP4 with frame-accurate clip boundaries', async () => {
    const root = tempRoot();
    const media = path.join(root, 'media');
    mkdirSync(media);
    const first = path.join(media, 'red.mp4');
    const second = path.join(media, 'blue.mp4');
    generateClip(first, 'red');
    generateClip(second, 'blue');

    const store = new ProjectStore(path.join(root, 'projects'));
    const created = store.create({ name: '集成导出' });
    const projectId = created.project.projectId;
    const fixture = createExportFixture({ audioPath: first, videoPaths: [first, second] });
    const saved = store.update({
      expectedRevision: 0,
      projectId,
      project: {
        ...fixture,
        project: { ...fixture.project, name: '集成导出', projectId },
      },
    });
    const outputDirectory = path.join(root, '导出');
    mkdirSync(outputDirectory);
    const targetPath = path.join(outputDirectory, '集成成片.mp4');
    const states: ExportState[] = [];
    const service = new ExportService({
      getExportFonts: () => FONTS,
      getProjectStore: () => store,
      getSettings: () => ({ defaultProjectDirectory: root }),
      getWorkflowStatus: () => null,
      media: () => ({ ffmpegAvailable: true, ffmpegPath: FFMPEG }),
      onProgress: () => undefined,
      onState: (state) => states.push(state),
    });

    await service.start({
      expectedRevision: saved.project.contentRevision,
      projectId,
      targetPath,
    });
    await service.whenIdle();

    expect(states.at(-1)).toMatchObject({ outputPath: targetPath, status: 'succeeded' });
    expect(existsSync(targetPath)).toBe(true);
    expect(existsSync(targetPath + '.partial')).toBe(false);

    const metadata = await probeVideo(FFPROBE, targetPath);

    expect(metadata).not.toBeNull();
    expect(metadata?.width).toBe(1920);
    expect(metadata?.height).toBe(1080);
    expect(metadata?.codec).toBe('h264');
    expect(Math.abs((metadata?.durationMs ?? 0) - 2_000)).toBeLessThanOrEqual(34);

    if (metadata?.frameCount !== undefined) {
      expect(Math.abs(metadata.frameCount - 60)).toBeLessThanOrEqual(1);
    }

    // 前 30 帧来自红色素材，第 31 帧起来自蓝色素材：边界误差不超过 1 帧。
    const lastRed = frameColor(targetPath, 29);
    const firstBlue = frameColor(targetPath, 30);

    expect(lastRed.r).toBeGreaterThan(150);
    expect(lastRed.b).toBeLessThan(100);
    expect(firstBlue.b).toBeGreaterThan(150);
    expect(firstBlue.r).toBeLessThan(100);
  }, 120_000);

  it('burns Chinese subtitles with the bundled font from Chinese/space directories', async () => {
    const root = tempRoot();
    const media = path.join(root, '素材 目录');
    mkdirSync(media);
    const first = path.join(media, 'red.mp4');
    const second = path.join(media, 'blue.mp4');
    generateClip(first, 'red');
    generateClip(second, 'blue');

    // 工程目录同样使用中文与空格，覆盖“工程路径含中文/空格”的验收项。
    const store = new ProjectStore(path.join(root, '工程 目录'));
    const created = store.create({ name: '字幕导出' });
    const projectId = created.project.projectId;
    const fixture = createExportFixture({
      audioPath: first,
      subtitle: { endMs: 2_000, fontSize: 48, startMs: 0, text: '中文字幕测试' },
      videoPaths: [first, second],
    });
    const saved = store.update({
      expectedRevision: 0,
      projectId,
      project: {
        ...fixture,
        project: { ...fixture.project, name: '字幕导出', projectId },
      },
    });
    const outputDirectory = path.join(root, '导出 目录');
    mkdirSync(outputDirectory);
    const targetPath = path.join(outputDirectory, '集成 成片.mp4');
    const states: ExportState[] = [];
    const service = new ExportService({
      getExportFonts: () => FONTS,
      getProjectStore: () => store,
      getSettings: () => ({ defaultProjectDirectory: root }),
      getWorkflowStatus: () => null,
      media: () => ({ ffmpegAvailable: true, ffmpegPath: FFMPEG }),
      onProgress: () => undefined,
      onState: (state) => states.push(state),
    });

    await service.start({
      expectedRevision: saved.project.contentRevision,
      projectId,
      targetPath,
    });
    await service.whenIdle();

    expect(states.at(-1)).toMatchObject({ outputPath: targetPath, status: 'succeeded' });
    expect(existsSync(targetPath)).toBe(true);
    // 字幕与字体属于临时产物，导出结束必须清掉，且不能留下同名残留。
    const leftoverArtifacts = readdirSync(outputDirectory).filter((name) =>
      name.startsWith('.miaoma-export-'),
    );
    expect(leftoverArtifacts).toEqual([]);

    // 第 15 帧（第一段红色画面）：底部安全区应有白色字形，顶部区域没有。
    const bottomWhite = countNearWhitePixels(targetPath, 15, {
      height: 260,
      width: 1920,
      x: 0,
      y: 760,
    });
    const topWhite = countNearWhitePixels(targetPath, 15, {
      height: 200,
      width: 1920,
      x: 0,
      y: 0,
    });

    expect(bottomWhite).toBeGreaterThan(800);
    expect(topWhite).toBeLessThan(50);
  }, 120_000);

  it('makes libass load the bundled Noto Sans SC face instead of a system font', () => {
    const root = tempRoot();
    const media = path.join(root, 'media');
    mkdirSync(media);
    const first = path.join(media, 'red.mp4');
    const second = path.join(media, 'blue.mp4');
    generateClip(first, 'red');
    generateClip(second, 'blue');

    const plan = compileExportPlan({
      artifactToken: 'run-font-probe',
      ffmpegPath: FFMPEG,
      fonts: FONTS,
      project: createExportFixture({
        audioPath: first,
        subtitle: { text: '中文字体' },
        videoPaths: [first, second],
      }),
      targetPath: path.join(root, '字体探测.mp4'),
    });
    const subtitles = plan.subtitles;

    if (!subtitles) {
      throw new Error('fixture must produce subtitle artifacts');
    }

    writeFileSync(subtitles.assPath, subtitles.assText, 'utf8');
    mkdirSync(subtitles.fontsDirPath, { recursive: true });
    copyFileSync(FONT_FILE, path.join(subtitles.fontsDirPath, path.basename(FONT_FILE)));

    const probe = spawnSync(
      FFMPEG,
      [
        '-v',
        'verbose',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x180:d=0.1:r=30',
        '-vf',
        'ass=filename=' +
          path.basename(subtitles.assPath) +
          ':fontsdir=' +
          path.basename(subtitles.fontsDirPath),
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ],
      { cwd: plan.cwd, encoding: 'utf8', windowsHide: true },
    );

    expect(probe.status).toBe(0);
    // libass 日志：fontselect: (Noto Sans SC, 700, 0) -> NotoSansSC-Regular ...
    expect(probe.stderr).toContain('NotoSansSC-Regular');
  }, 60_000);
});
