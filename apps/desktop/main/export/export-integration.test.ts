import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeVideo } from '@miaoma/video-agent';
import type { ExportState } from '../../shared/ipc-contract';
import { ProjectStore } from '../projects/project-store';
import { ExportService } from './service';
import { createExportFixture } from './test-support/fixture';

const FFMPEG =
  process.platform === 'win32' ? path.resolve('resources/ffmpeg/ffmpeg.exe') : 'ffmpeg';
const FFPROBE =
  process.platform === 'win32' ? path.resolve('resources/ffmpeg/ffprobe.exe') : 'ffprobe';

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
});
