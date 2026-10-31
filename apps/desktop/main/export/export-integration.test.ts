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
const SAMPLE_RATE = 48_000;
const FONT_FILE = path.resolve('resources/fonts/NotoSansSC-Regular.otf');
const FONTS = { directory: path.dirname(FONT_FILE), files: [FONT_FILE] };
const SOURCE_AUDIO_FREQUENCY = 2_000;
const VOICE_FREQUENCY = 440;
const MUSIC_FREQUENCY = 880;

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

function assertSpawnOk(result: ReturnType<typeof spawnSync>, label: string): void {
  if (result.status !== 0) {
    throw new Error(label + ' failed: ' + String(result.stderr));
  }
}

/** 生成带 2000Hz 原声的彩条视频：用来证明成片没有混入源视频原声。 */
function generateClip(filePath: string, color: string): void {
  assertSpawnOk(
    spawnSync(
      FFMPEG,
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=' + color + ':s=640x360:d=2:r=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=' + SOURCE_AUDIO_FREQUENCY + ':sample_rate=48000:duration=2',
        '-shortest',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        filePath,
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
    'ffmpeg fixture',
  );
}

function generateTone(filePath: string, frequency: number, seconds: number): void {
  assertSpawnOk(
    spawnSync(
      FFMPEG,
      [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=' + frequency + ':sample_rate=' + SAMPLE_RATE + ':duration=' + seconds,
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        filePath,
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
    'ffmpeg tone',
  );
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

/** 把成片音轨解码成 48kHz 单声道浮点样本，供频点能量检测。 */
function decodeMono(filePath: string): Float32Array {
  const result = spawnSync(
    FFMPEG,
    [
      '-v',
      'error',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );

  if (result.status !== 0) {
    throw new Error('ffmpeg audio decode failed: ' + String(result.stderr));
  }

  const buffer = result.stdout;
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return new Float32Array(copy);
}

function windowSeconds(
  samples: Float32Array,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  const from = Math.max(0, Math.round(startSeconds * SAMPLE_RATE));
  const to = Math.min(samples.length, Math.round(endSeconds * SAMPLE_RATE));

  return samples.subarray(from, to);
}

/** Goertzel：只测某个频点的能量，用来判断混音里有哪些音调。 */
function tonePower(samples: Float32Array, frequency: number): number {
  const size = samples.length;
  const angle = (2 * Math.PI * frequency) / SAMPLE_RATE;
  const coefficient = 2 * Math.cos(angle);
  let previous = 0;
  let beforePrevious = 0;

  for (let index = 0; index < size; index += 1) {
    const current = (samples[index] ?? 0) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }

  return (
    (previous * previous +
      beforePrevious * beforePrevious -
      coefficient * previous * beforePrevious) /
    (size * size)
  );
}

/** 采样峰值：用来证明二路混音补偿后没有削波。 */
function peakLevel(samples: Float32Array): number {
  let peak = 0;

  for (const sample of samples) {
    const value = Math.abs(sample);

    if (value > peak) {
      peak = value;
    }
  }

  return peak;
}

function audioDurationSeconds(filePath: string): number {
  const result = spawnSync(
    FFPROBE,
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=duration',
      '-of',
      'default=nw=1:nk=1',
      filePath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const seconds = Number((result.stdout ?? '').trim());

  if (result.status !== 0 || !Number.isFinite(seconds)) {
    throw new Error('ffprobe audio duration failed: ' + String(result.stderr));
  }

  return seconds;
}

describe.skipIf(!HAS_FFMPEG)('export integration', () => {
  it('renders a playable MP4 with mixed voice and music, muted source audio and frame-accurate cuts', async () => {
    const root = tempRoot();
    const media = path.join(root, 'media');
    mkdirSync(media);
    const first = path.join(media, 'red.mp4');
    const second = path.join(media, 'blue.mp4');
    const voice = path.join(media, 'voice.wav');
    const music = path.join(media, 'music.wav');
    generateClip(first, 'red');
    generateClip(second, 'blue');
    generateTone(voice, VOICE_FREQUENCY, 1);
    generateTone(music, MUSIC_FREQUENCY, 1);

    const store = new ProjectStore(path.join(root, 'projects'));
    const created = store.create({ name: '集成导出' });
    const projectId = created.project.projectId;
    const fixture = createExportFixture({
      audioPath: voice,
      musicLoop: true,
      musicPath: music,
      // 1 秒的音乐窗口覆盖 2 秒时间线：只有循环生效，后半段才有音乐。
      musicSourceEndMs: 1_000,
      musicVolume: 0.5,
      videoPaths: [first, second],
    });

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
    expect(existsSync(targetPath + '.partial.wav')).toBe(false);

    const metadata = await probeVideo(FFPROBE, targetPath);

    expect(metadata).not.toBeNull();
    expect(metadata?.width).toBe(1920);
    expect(metadata?.height).toBe(1080);
    expect(metadata?.codec).toBe('h264');
    expect(metadata?.audio?.codec).toBe('aac');
    expect(metadata?.audio?.sampleRate).toBe(SAMPLE_RATE);
    expect(metadata?.audio?.channels).toBe(2);
    expect(metadata?.audio?.bitRate ?? 0).toBeGreaterThan(100_000);
    expect(Math.abs((metadata?.durationMs ?? 0) - 2_000)).toBeLessThanOrEqual(34);
    expect(Math.abs(audioDurationSeconds(targetPath) * 1_000 - 2_000)).toBeLessThanOrEqual(34);

    if (metadata?.frameCount !== undefined) {
      expect(Math.abs(metadata.frameCount - 60)).toBeLessThanOrEqual(1);
    }

    const samples = decodeMono(targetPath);
    const opening = windowSeconds(samples, 0.25, 0.75);
    const loopedMusic = windowSeconds(samples, 1.25, 1.75);
    const voicePower = tonePower(opening, VOICE_FREQUENCY);
    const musicPower = tonePower(opening, MUSIC_FREQUENCY);
    const sourceAudioPower = tonePower(opening, SOURCE_AUDIO_FREQUENCY);
    const loopedMusicPower = tonePower(loopedMusic, MUSIC_FREQUENCY);

    // 配音与音乐都在，且 amix 的归一化已按输入数补偿回去（否则能量会少一半）。
    expect(voicePower).toBeGreaterThan(2e-3);
    expect(musicPower).toBeGreaterThan(5e-4);
    // 源视频原声被静音：2000Hz 不应出现。
    expect(sourceAudioPower).toBeLessThan(voicePower / 100);
    // 音乐窗口只有 1 秒而时间线 2 秒：后半段仍有音乐，说明循环生效。
    expect(loopedMusicPower).toBeGreaterThan(5e-4);
    // 补偿后仍不削波：峰值必须低于满幅。
    expect(peakLevel(samples)).toBeGreaterThan(0.12);
    expect(peakLevel(samples)).toBeLessThan(1);

    // 前 30 帧来自红色素材，第 31 帧起来自蓝色素材：边界误差不超过 1 帧。
    const lastRed = frameColor(targetPath, 29);
    const firstBlue = frameColor(targetPath, 30);

    expect(lastRed.r).toBeGreaterThan(150);
    expect(lastRed.b).toBeLessThan(100);
    expect(firstBlue.b).toBeGreaterThan(150);
    expect(firstBlue.r).toBeLessThan(100);
  }, 120_000);

  it('applies voice speed, non-loop music trim and per-clip volumes in the real premix command', () => {
    const root = tempRoot();
    const voice = path.join(root, 'voice.wav');
    const music = path.join(root, 'music.wav');
    generateTone(voice, VOICE_FREQUENCY, 1);
    generateTone(music, MUSIC_FREQUENCY, 2);

    const project = createExportFixture({
      audioPath: voice,
      musicLoop: false,
      musicPath: music,
      musicSourceEndMs: 1_000,
      musicVolume: 0.25,
      videoPaths: [voice, voice],
      voiceSpeed: 2,
      voiceVolume: 0.5,
    });
    const plan = compileExportPlan({
      artifactToken: 'run-premix-check',
      ffmpegPath: FFMPEG,
      fonts: null,
      project,
      targetPath: path.join(root, '成片.mp4'),
    });

    assertSpawnOk(spawnSync(FFMPEG, plan.premix.args, { windowsHide: true }), 'premix');
    expect(existsSync(plan.premixTemporaryPath)).toBe(true);
    expect(
      Math.abs(audioDurationSeconds(plan.premixTemporaryPath) * 1_000 - 2_000),
    ).toBeLessThanOrEqual(2);

    const samples = decodeMono(plan.premixTemporaryPath);
    const voiceStops = windowSeconds(samples, 0.6, 0.9);
    const secondClip = windowSeconds(samples, 1.25, 1.45);
    const tail = windowSeconds(samples, 1.6, 1.9);
    const opening = windowSeconds(samples, 0.25, 0.45);
    const voicePower = tonePower(opening, VOICE_FREQUENCY);
    const musicPower = tonePower(opening, MUSIC_FREQUENCY);

    // 语速 2 倍：1 秒配音只覆盖每个 1 秒片段的前半段，后半段静音。
    expect(tonePower(voiceStops, VOICE_FREQUENCY)).toBeLessThan(voicePower / 50);
    expect(tonePower(secondClip, VOICE_FREQUENCY)).toBeGreaterThan(voicePower / 2);
    // 非循环音乐只覆盖 1 秒窗口：后半段静音，前 1 秒仍有声音。
    expect(tonePower(voiceStops, MUSIC_FREQUENCY)).toBeGreaterThan(musicPower / 2);
    expect(tonePower(secondClip, MUSIC_FREQUENCY)).toBeLessThan(musicPower / 50);
    expect(tonePower(tail, VOICE_FREQUENCY)).toBeLessThan(voicePower / 50);
    expect(tonePower(tail, MUSIC_FREQUENCY)).toBeLessThan(musicPower / 50);
    // 逐片段音量生效：0.5 对 0.25 时能量比约 4。
    const volumeRatio = voicePower / musicPower;
    expect(volumeRatio).toBeGreaterThan(2.5);
    expect(volumeRatio).toBeLessThan(6);
    // 预混音轨峰值不削波。
    expect(peakLevel(samples)).toBeLessThan(0.985);
  }, 60_000);

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
    // 字幕与字体属于临时产物，导出结束必须清掉，且不能留下任何残留。
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
