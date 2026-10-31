import { describe, expect, it } from 'vitest';
import {
  compileExportPlan,
  ExportPlanError,
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
} from './plan';
import { createExportFixture } from './test-support/fixture';

function filterGraph(args: string[]): string {
  const index = args.indexOf('-filter_complex');

  return index >= 0 ? (args[index + 1] ?? '') : '';
}

describe('export plan compiler', () => {
  it('compiles 1920x1080 30fps video-only ffmpeg arguments', () => {
    const plan = compileExportPlan({
      ffmpegPath: 'ffmpeg',
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
    expect(graph).not.toContain('导出');
    expect(graph).not.toContain('C:\\');
  });

  it('applies clip speed to the source timestamps', () => {
    const plan = compileExportPlan({
      ffmpegPath: 'ffmpeg',
      project: createExportFixture({ speed: 2 }),
      targetPath: 'C:\\out.mp4',
    });

    expect(filterGraph(plan.ffmpeg.args)).toContain('(PTS-STARTPTS)/2');
  });

  it('loops image assets instead of trimming a single frame', () => {
    const plan = compileExportPlan({
      ffmpegPath: 'ffmpeg',
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
      compileExportPlan({ ffmpegPath: 'ffmpeg', project, targetPath: 'C:\\out.mp4' }),
    ).toThrow(ExportPlanError);
  });

  it('rejects a project without a video track', () => {
    const project = createExportFixture();
    project.tracks = project.tracks.filter((track) => track.kind !== 'video');

    expect(() =>
      compileExportPlan({ ffmpegPath: 'ffmpeg', project, targetPath: 'C:\\out.mp4' }),
    ).toThrow(ExportPlanError);
  });
});
