import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MusicTrack, VideoProject } from '@miaoma/video-project';
import {
  compileExportPlan,
  ExportPlanError,
  OUTPUT_CHANNELS,
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_SAMPLE_RATE,
  OUTPUT_WIDTH,
} from './plan';
import { createExportFixture, EXPORT_TEST_FONTS } from './test-support/fixture';

function filterGraph(args: string[]): string {
  const index = args.indexOf('-filter_complex');

  return index >= 0 ? (args[index + 1] ?? '') : '';
}

function argumentAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index >= 0 ? args[index + 1] : undefined;
}

function musicTrack(project: VideoProject): MusicTrack {
  const track = project.tracks.find(
    (candidate): candidate is MusicTrack => candidate.kind === 'music',
  );

  if (!track) {
    throw new Error('fixture missing music track');
  }

  return track;
}

describe('export plan compiler', () => {
  it('compiles 1920x1080 30fps H.264/AAC 192k arguments with a premixed audio track', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture(),
      targetPath: 'C:\\导出\\成片.mp4',
    });
    const graph = filterGraph(plan.render.args);

    expect(plan.expected).toEqual({
      audioBitrateKbps: 192,
      audioCodec: 'aac',
      container: 'mp4',
      durationMs: 2_000,
      frameCount: 60,
      fps: OUTPUT_FPS,
      height: OUTPUT_HEIGHT,
      videoCodec: 'h264',
      width: OUTPUT_WIDTH,
    });
    expect(plan.cwd).toBe('C:\\导出');
    expect(plan.subtitles).toBeNull();
    expect(plan.temporaryPath).toBe('C:\\导出\\成片.mp4.partial');
    expect(plan.premixTemporaryPath).toBe('C:\\导出\\成片.mp4.partial.wav');
    expect(plan.render.command).toBe('ffmpeg');
    expect(plan.render.args).not.toContain('-an');
    expect(plan.render.args).toContain(plan.premixTemporaryPath);
    expect(argumentAfter(plan.render.args, '-c:v')).toBe('libx264');
    expect(argumentAfter(plan.render.args, '-c:a')).toBe('aac');
    expect(argumentAfter(plan.render.args, '-b:a')).toBe('192k');
    expect(argumentAfter(plan.render.args, '-ar')).toBe(String(OUTPUT_SAMPLE_RATE));
    expect(argumentAfter(plan.render.args, '-ac')).toBe(String(OUTPUT_CHANNELS));
    expect(plan.render.args).toContain('mp4');
    expect(plan.render.args).toContain('+faststart');
    expect(plan.render.args.at(-1)).toBe(plan.temporaryPath);
    expect(graph).toContain('trim=start=0.000:end=1.000');
    expect(graph).toContain('fps=30');
    expect(graph).toContain('scale=1920:1080');
    expect(graph).toContain('concat=n=2:v=1:a=0');
    expect(graph).toContain('trim=end_frame=30');
    expect(graph).toContain('[vout]');
    expect(graph).not.toContain('ass=');
    expect(graph).not.toContain('导出');
    expect(graph).not.toContain('C:\\');
  });

  it('maps the premixed audio input after the video inputs and never the source audio', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture(),
      targetPath: 'C:\\out.mp4',
    });
    const mapValues = plan.render.args.flatMap((value, index) =>
      value === '-map' ? [plan.render.args[index + 1] ?? ''] : [],
    );

    // 两个视频输入之后才是预混音轨；源视频只取 :v，原声不映射。
    expect(mapValues).toEqual(['[vout]', '2:a']);
  });

  it('mixes voice clips by clip volume, speed and timeline start', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({ voiceSpeed: 1.5, voiceVolume: 0.4 }),
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.premix.args);

    expect(plan.premix.command).toBe('ffmpeg');
    expect(plan.premix.args.at(-1)).toBe(plan.premixTemporaryPath);
    expect(graph).toContain('atempo=1.5');
    expect(graph).toContain('volume=0.4');
    expect(graph).toContain('atrim=end_sample=48000');
    expect(graph).toContain('apad=whole_len=96000');
    expect(graph).toContain('adelay=1000|1000');
    expect(graph).toContain('[voicebus]volume=1[aout]');
    // 只有配音一路时不做二路混音，也不加倍增益。
    expect(graph).not.toContain('musicbus');
    expect(graph).not.toContain('C:\\');
    expect(plan.premix.args).toContain('C:/media/voice.m4a');
  });

  it('loops a trimmed music window and mixes voice plus music with gain compensation', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({
        musicLoop: true,
        musicPath: 'C:/media/music.mp3',
        musicSourceEndMs: 1_000,
        musicVolume: 0.35,
      }),
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.premix.args);

    expect(graph).toContain('atrim=start_sample=0:end_sample=48000');
    expect(graph).toContain('aloop=loop=3:size=48000');
    expect(graph).toContain('volume=0.35');
    expect(graph).toContain(
      '[voicebus][musicbus]amix=inputs=2:duration=longest,volume=2,alimiter=limit=0.98:level=false:attack=0.1',
    );
    expect(graph).toContain('[aout]');
  });

  it('does not loop music when loop is off and pads the silent tail', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({
        musicLoop: false,
        musicPath: 'C:/media/music.mp3',
        musicSourceEndMs: 1_000,
      }),
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.premix.args);

    expect(graph).not.toContain('aloop=');
    expect(graph).toContain('atrim=start_sample=0:end_sample=48000');
    expect(graph).toContain('apad=whole_len=96000');
  });

  it('drops the music track from the mix when the track is switched off', () => {
    const project = createExportFixture({ musicPath: 'C:/media/music.mp3' });
    project.tracks = project.tracks.map((track) =>
      track.kind === 'music' ? { ...track, visible: false } : track,
    );

    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project,
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.premix.args);

    expect(graph).not.toContain('musicbus');
    expect(graph).not.toContain('C:/media/music.mp3');
    expect(graph).toContain('[voicebus]volume=1[aout]');
  });

  it('emits a silent premix track when neither voice nor music carries clips', () => {
    const project = createExportFixture();
    project.tracks = project.tracks.filter((track) => track.kind !== 'voice');

    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project,
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.premix.args);

    expect(graph).toContain(`anullsrc=r=${OUTPUT_SAMPLE_RATE}:cl=stereo`);
    expect(graph).toContain('atrim=end_sample=96000');
    expect(graph).toContain('[aout]');
    expect(plan.premix.args).not.toContain('-i');
  });

  it('rejects an audio clip that runs past the timeline', () => {
    const project = createExportFixture({ musicPath: 'C:/media/music.mp3' });
    const music = musicTrack(project).clips[0];

    if (!music) {
      throw new Error('fixture missing music clip');
    }

    music.endMs = 2_500;

    expect(() =>
      compileExportPlan({
        artifactToken: 'run-1',
        ffmpegPath: 'ffmpeg',
        fonts: null,
        project,
        targetPath: 'C:\\out.mp4',
      }),
    ).toThrow(ExportPlanError);
  });

  it('applies clip speed to the source timestamps', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({ speed: 2 }),
      targetPath: 'C:\\out.mp4',
    });

    expect(filterGraph(plan.render.args)).toContain('(PTS-STARTPTS)/2');
  });

  it('loops image assets instead of trimming a single frame', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({ firstMediaType: 'image' }),
      targetPath: 'C:\\out.mp4',
    });
    const args = plan.render.args;

    expect(args.join(' ')).toContain('-loop 1 -i C:/media/a.mp4');
    expect(filterGraph(args)).toContain('trim=end=1.000');
  });

  it('rejects video clips with gaps', () => {
    const project = createExportFixture();
    const videoTrack = project.tracks.find((track) => track.kind === 'video');

    if (!videoTrack || videoTrack.kind !== 'video') {
      throw new Error('fixture missing video track');
    }

    const second = videoTrack.clips[1];

    if (!second) {
      throw new Error('fixture missing second clip');
    }

    videoTrack.clips[1] = { ...second, endMs: 2_100, startMs: 1_100 };

    expect(() =>
      compileExportPlan({
        artifactToken: 'run-1',
        ffmpegPath: 'ffmpeg',
        fonts: null,
        project,
        targetPath: 'C:\\out.mp4',
      }),
    ).toThrow(ExportPlanError);
  });

  it('quantizes non-frame-aligned clip boundaries to output frames', () => {
    const project = createExportFixture();
    const videoTrack = project.tracks.find((track) => track.kind === 'video');

    if (!videoTrack || videoTrack.kind !== 'video') {
      throw new Error('fixture missing video track');
    }

    const first = videoTrack.clips[0];
    const second = videoTrack.clips[1];

    if (!first || !second) {
      throw new Error('fixture missing clips');
    }

    project.scenes[0] = { ...project.scenes[0]!, durationMs: 1_005 };
    project.scenes[1] = { ...project.scenes[1]!, durationMs: 1_005 };
    videoTrack.clips[0] = { ...first, endMs: 1_005 };
    videoTrack.clips[1] = { ...second, endMs: 2_010, startMs: 1_005 };

    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project,
      targetPath: 'C:\\out.mp4',
    });
    const graph = filterGraph(plan.render.args);

    expect(plan.expected.durationMs).toBe(2_000);
    expect(plan.expected.frameCount).toBe(60);
    expect(graph.match(/trim=end_frame=30/g)).toHaveLength(2);
    expect(argumentAfter(plan.render.args, '-t')).toBe('2.000');
  });

  it('rejects a project without a video track', () => {
    const project = createExportFixture();
    project.tracks = project.tracks.filter((track) => track.kind !== 'video');

    expect(() =>
      compileExportPlan({
        artifactToken: 'run-1',
        ffmpegPath: 'ffmpeg',
        fonts: null,
        project,
        targetPath: 'C:\\out.mp4',
      }),
    ).toThrow(ExportPlanError);
  });
});

describe('export plan subtitle burn-in', () => {
  it('burns subtitles with relative ASCII paths and a target-directory cwd', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: EXPORT_TEST_FONTS,
      project: createExportFixture({ subtitle: { fontSize: 48, presetId: 'white-outline' } }),
      targetPath: 'D:\\导出 目录\\成片.mp4',
    });
    const graph = filterGraph(plan.render.args);

    expect(graph).toContain(
      'ass=filename=.miaoma-export-run-1.ass:fontsdir=.miaoma-export-run-1-fonts',
    );
    // 滤镜参数里不能出现中文绝对路径；目标目录用 cwd 传进去。
    expect(graph).not.toContain('导出');
    expect(graph).not.toContain('D:\\');
    expect(plan.cwd).toBe('D:\\导出 目录');
    expect(plan.subtitles).not.toBeNull();
    expect(plan.subtitles?.assPath).toBe(path.join('D:\\导出 目录', '.miaoma-export-run-1.ass'));
    expect(plan.subtitles?.fontsDirPath).toBe(
      path.join('D:\\导出 目录', '.miaoma-export-run-1-fonts'),
    );
    expect(plan.subtitles?.fontFiles).toEqual(EXPORT_TEST_FONTS.files);
    expect(plan.subtitles?.assText).toContain('Style: Default,Noto Sans SC,48');
  });

  it('skips the ass filter when the subtitle track is hidden', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: EXPORT_TEST_FONTS,
      project: createExportFixture({ subtitle: { visible: false } }),
      targetPath: 'C:\\out.mp4',
    });

    expect(plan.subtitles).toBeNull();
    expect(filterGraph(plan.render.args)).not.toContain('ass=');
  });

  it('rejects subtitle burn-in without the bundled font', () => {
    expect(() =>
      compileExportPlan({
        artifactToken: 'run-1',
        ffmpegPath: 'ffmpeg',
        fonts: null,
        project: createExportFixture({ subtitle: {} }),
        targetPath: 'C:\\out.mp4',
      }),
    ).toThrow(ExportPlanError);
  });
});
