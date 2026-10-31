import { describe, expect, it } from 'vitest';
import type { VideoProject } from '@miaoma/video-project';
import {
  assColor,
  buildSubtitleDocument,
  escapeAssText,
  formatAssCentiseconds,
  subtitleArtifactFileNames,
  wrapSubtitleText,
} from './subtitles';
import { createExportFixture } from './test-support/fixture';

function projectWithBurnSubtitleDisabled(project: VideoProject): VideoProject {
  // Schema 目前把 burnSubtitles 固定为 true；这里显式放宽类型，覆盖未来关闭烧录的分支。
  const render = { ...project.render, burnSubtitles: false };

  return { ...project, render: render as unknown as VideoProject['render'] };
}

describe('export subtitles', () => {
  it('generates a 1920x1080 ASS document from the subtitle track style', () => {
    const ass = buildSubtitleDocument(
      createExportFixture({ subtitle: { fontSize: 48, presetId: 'yellow' } }),
    );

    expect(ass).not.toBeNull();
    const document = ass ?? '';

    expect(document.startsWith('[Script Info]')).toBe(true);
    expect(document.endsWith('\n')).toBe(true);
    expect(document).toContain('PlayResX: 1920');
    expect(document).toContain('PlayResY: 1080');
    expect(document).toContain('WrapStyle: 2');
    // 黄字黑边：主色 &H0000D4FF、描边 &H00050505；Outline=48*0.045=2.16；底部安全区 76。
    expect(document).toContain(
      'Style: Default,Noto Sans SC,48,&H0000D4FF,&H0000D4FF,&H00050505,&H00000000,-1,0,0,0,100,100,0,0,1,2.16,0,2,154,154,76,1',
    );
    expect(document).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,第一句字幕');
  });

  it('keeps the style line aligned with the default preset', () => {
    const document = buildSubtitleDocument(createExportFixture({ subtitle: {} })) ?? '';

    // 白字黑边：主色 &H00FAF7F5、描边 &H00000000；字号 42 → Outline 1.89。
    expect(document).toContain(
      'Style: Default,Noto Sans SC,42,&H00FAF7F5,&H00FAF7F5,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,1.89,0,2,154,154,76,1',
    );
  });

  it('wraps text into at most two lines of 20 characters', () => {
    expect(wrapSubtitleText('第一句字幕')).toEqual(['第一句字幕']);

    const twenty = '字'.repeat(20);
    expect(wrapSubtitleText(twenty)).toEqual([twenty]);

    const thirty = '字'.repeat(30);
    const lines = wrapSubtitleText(thirty);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 20)).toBe(true);
    expect(lines.join('')).toBe(thirty);
  });

  it('prefers breaking after punctuation inside the 16-20 character window', () => {
    const text = '一'.repeat(17) + '，' + '二'.repeat(10);
    const lines = wrapSubtitleText(text);

    expect(lines[0]).toBe('一'.repeat(17) + '，');
    expect(lines[1]).toBe('二'.repeat(10));
  });

  it('splits a 32-40 character cue into two 16-20 character lines without losing text', () => {
    const text = '一'.repeat(10) + '，' + '二'.repeat(25);
    const lines = wrapSubtitleText(text);

    expect(lines).toHaveLength(2);
    expect(lines.join('')).toBe(text);
    expect(lines.every((line) => line.length >= 16 && line.length <= 20)).toBe(true);
  });

  it('keeps the first line within 16-20 characters even when the tail is shorter', () => {
    const lines = wrapSubtitleText('字'.repeat(21));

    expect(lines[0]).toHaveLength(16);
    expect(lines[1]).toHaveLength(5);
  });

  it('truncates text longer than two lines to keep the two-line cap', () => {
    const lines = wrapSubtitleText('字'.repeat(60));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(20);
    expect(lines[1]).toHaveLength(20);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('joins wrapped lines with the ASS newline escape', () => {
    const text = '字'.repeat(26);
    const ass = buildSubtitleDocument(createExportFixture({ subtitle: { text } })) ?? '';

    expect(ass).toContain(
      'Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,' +
        '字'.repeat(16) +
        '\\N' +
        '字'.repeat(10),
    );
  });

  it('escapes ASS control characters', () => {
    expect(escapeAssText('a{b}c' + String.fromCharCode(92) + 'd')).toBe(
      'abc' + String.fromCharCode(92, 92) + 'd',
    );
  });

  it('returns null when there is no subtitle track', () => {
    expect(buildSubtitleDocument(createExportFixture())).toBeNull();
  });

  it('returns null for a hidden subtitle track', () => {
    expect(buildSubtitleDocument(createExportFixture({ subtitle: { visible: false } }))).toBeNull();
  });

  it('returns null when every cue is blank', () => {
    expect(buildSubtitleDocument(createExportFixture({ subtitle: { text: '   ' } }))).toBeNull();
  });

  it('returns null when RenderConfig disables subtitle burning', () => {
    expect(
      buildSubtitleDocument(projectWithBurnSubtitleDisabled(createExportFixture({ subtitle: {} }))),
    ).toBeNull();
  });

  it('maps preset colours to ASS BGR order', () => {
    expect(assColor('#f5f7fa')).toBe('&H00FAF7F5');
    expect(assColor('#ffd400')).toBe('&H0000D4FF');
    expect(assColor('#24cff2')).toBe('&H00F2CF24');
    expect(assColor('#000000')).toBe('&H00000000');
    expect(assColor('#ffffff')).toBe('&H00FFFFFF');
    expect(() => assColor('nope')).toThrow();
  });

  it('formats ASS timestamps in centiseconds', () => {
    expect(formatAssCentiseconds(0)).toBe('0:00:00.00');
    expect(formatAssCentiseconds(150)).toBe('0:00:01.50');
    expect(formatAssCentiseconds(360_000 + 61_234)).toBe('1:10:12.34');
  });

  it('names temporary subtitle artifacts after the per-run token', () => {
    expect(subtitleArtifactFileNames('run-1')).toEqual({
      assFileName: '.miaoma-export-run-1.ass',
      fontsDirName: '.miaoma-export-run-1-fonts',
    });
    expect(subtitleArtifactFileNames('run-1').assFileName).not.toBe(
      subtitleArtifactFileNames('run-2').assFileName,
    );
    expect(() => subtitleArtifactFileNames('中文')).toThrow();
  });
});
