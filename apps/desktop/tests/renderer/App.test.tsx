import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';

describe('editor workspace', () => {
  it('shows the main editing areas', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('口播短片自动剪辑工程');
    expect(html).toContain('文稿字幕');
    expect(html).toContain('视频预览');
    expect(html).toContain('时间线');
    expect(html).toContain('Whisper 字幕');
  });
});
