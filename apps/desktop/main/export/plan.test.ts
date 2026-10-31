import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileExportPlan,
  ExportPlanError,
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
} from './plan';
import { createExportFixture, EXPORT_TEST_FONTS } from './test-support/fixture';

function filterGraph(args: string[]): string {
  const index = args.indexOf('-filter_complex');

  return index >= 0 ? (args[index + 1] ?? '') : '';
}

describe('export plan compiler', () => {
  it('compiles 1920x1080 30fps video-only ffmpeg arguments', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture(),
      targetPath: 'C:\\导出\\成片.mp4',
    });
    const graph = filterGraph(plan.ffmpeg.args);

    expect(plan.expected).toEqual({
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
    expect(plan.ffmpeg.command).toBe('ffmpeg');
    expect(plan.ffmpeg.args).toContain('-an');
    expect(plan.ffmpeg.args).toContain('-c:v');
    expect(plan.ffmpeg.args).toContain('libx264');
    expect(plan.ffmpeg.args).toContain('mp4');
    expect(plan.ffmpeg.args).toContain('+faststart');
    expect(plan.ffmpeg.args.at(-1)).toBe(plan.temporaryPath);
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

  it('applies clip speed to the source timestamps', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({ speed: 2 }),
      targetPath: 'C:\\out.mp4',
    });

    expect(filterGraph(plan.ffmpeg.args)).toContain('(PTS-STARTPTS)/2');
  });

  it('loops image assets instead of trimming a single frame', () => {
    const plan = compileExportPlan({
      artifactToken: 'run-1',
      ffmpegPath: 'ffmpeg',
      fonts: null,
      project: createExportFixture({ firstMediaType: 'image' }),
      targetPath: 'C:\\out.mp4',
    });
    const args = plan.ffmpeg.args;

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
    const graph = filterGraph(plan.ffmpeg.args);

    expect(plan.expected.durationMs).toBe(2_000);
    expect(plan.expected.frameCount).toBe(60);
    expect(graph.match(/trim=end_frame=30/g)).toHaveLength(2);
    expect(plan.ffmpeg.args[plan.ffmpeg.args.indexOf('-t') + 1]).toBe('2.000');
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
    const graph = filterGraph(plan.ffmpeg.args);

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
    expect(filterGraph(plan.ffmpeg.args)).not.toContain('ass=');
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
