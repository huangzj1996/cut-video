import { Children, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { ConfigPanel } from '../../src/renderer/components/config/ConfigPanel';
import { ConfigRange } from '../../src/renderer/components/config/ConfigRange';
import { MusicTrackOption } from '../../src/renderer/components/config/music/MusicTrackOption';
import { SubtitlePresetOption } from '../../src/renderer/components/config/subtitle/SubtitlePresetOption';
import { SubtitleOverlay } from '../../src/renderer/components/preview/SubtitleOverlay';
import { SCENES } from '../../src/renderer/constants/scenes';
import { DEFAULT_SUBTITLE_SETTINGS, SUBTITLE_PRESETS } from '../../src/renderer/constants/subtitle';
import { DEFAULT_MUSIC_SETTINGS, MUSIC_TRACKS, getVisibleMusicCategories, matchesMusicCategory } from '../../src/renderer/constants/music';
import songData from '../../src/renderer/assets/song/song.json';

describe('editor workspace', () => {
  it('shows the main editing areas', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('口播短片自动剪辑工程');
    expect(html).toContain('文稿字幕');
    expect(html).toContain('6 段分镜');
    expect(html).toContain('视频预览');
    expect(html).toContain('时间线');
    expect(html).toContain('Whisper 字幕');
    expect(html).toContain('字幕预览');
    expect(html).toContain(SCENES[1].lines[0]);
  });
});

describe('configuration panel strategies', () => {
  it('shows the panel for the selected editor tool', () => {
    const props = { subtitleSettings: DEFAULT_SUBTITLE_SETTINGS, onSubtitleChange: () => {}, musicSettings: DEFAULT_MUSIC_SETTINGS, onMusicChange: () => {} };
    const picture = renderToStaticMarkup(<ConfigPanel {...props} activeTool="picture" />);
    const voice = renderToStaticMarkup(<ConfigPanel {...props} activeTool="voice" />);
    const subtitle = renderToStaticMarkup(<ConfigPanel {...props} activeTool="subtitle" />);
    const music = renderToStaticMarkup(<ConfigPanel {...props} activeTool="music" />);

    expect(picture).toContain('画面分析回复');
    expect(picture).not.toContain('生成口播音轨');
    expect(voice).toContain('生成口播音轨');
    expect(voice).not.toContain('画面分析回复');
    expect(subtitle).toContain('字幕设置');
    expect(subtitle).toContain('字幕字号');
    expect(subtitle).toContain('白字黑边');
    expect(subtitle).not.toContain('生成口播音轨');
    expect(music).toContain('音乐设置');
    expect(music).toContain('Eutopia');
    expect(music).toContain('音乐音量');
    expect(music).toContain('更多音乐分类');
    expect(music).not.toContain('应用音乐');
    expect(music).not.toContain('移除音乐');
    for (const panel of [voice, subtitle, music]) {
      expect(panel).toMatch(/<header class="[^"]*pb-\[5px\][^"]*">.*<\/header><div class="thin-scrollbar/s);
    }
    expect(music).toContain('width:60%;background-color:#ffffff');
  });
});

describe('subtitle appearance', () => {
  it('uses the selected preset and size in the preview and respects visibility', () => {
    const settings = { ...DEFAULT_SUBTITLE_SETTINGS, fontSize: 56, presetId: 'yellow-outline' as const };
    const html = renderToStaticMarkup(<SubtitleOverlay scene={SCENES[0]} settings={settings} />);

    expect(html).toContain('font-size:56px');
    expect(html).toContain('color:#ffd400');
    expect(html).toContain(SCENES[0].lines[0]);
    expect(renderToStaticMarkup(<SubtitleOverlay scene={SCENES[0]} settings={{ ...settings, visible: false }} />)).toBe('');
  });

  it('renders each preset sample as two colored text layers', () => {
    const html = renderToStaticMarkup(<SubtitlePresetOption preset={SUBTITLE_PRESETS[2]} selected={false} onSelect={() => {}} />);

    expect(html.match(/>T<\/span>/g)).toHaveLength(2);
    expect(html).toContain('color:#050505');
    expect(html).toContain('color:#ffd400');
    expect(html).toContain('bg-[#111214]');
    expect(html).toContain('hover:bg-[#3A3B3E]');
  });

  it('uses one accessible range control for configuration sliders', () => {
    const html = renderToStaticMarkup(<ConfigRange label="字幕字号" value={45} min={0} max={100} onChange={() => {}} />);

    expect(html).toContain('aria-label="字幕字号"');
    expect(html).toContain('width:45%');
    expect(html).not.toContain('focus-within:outline');
  });
});

describe('music catalog', () => {
  it('keeps selection and preview on separate controls', () => {
    const select = vi.fn();
    const preview = vi.fn();
    const option = MusicTrackOption({ track: { id: 'demo', title: '示例曲目', mood: '平静', tempo: '适中', duration: '00:30', scenes: [], audioUrl: '', coverUrl: null }, selected: false, playing: false, onSelect: select, onTogglePreview: preview });
    const controls = Children.toArray(option.props.children);
    const [previewButton, selectButton] = controls;

    if (!isValidElement<{ onClick: () => void; 'aria-label': string }>(previewButton) || !isValidElement<{ onClick: () => void; 'aria-label': string }>(selectButton)) throw new Error('音乐操作按钮缺失');
    expect(previewButton.props['aria-label']).toContain('开始试听');
    expect(selectButton.props['aria-label']).toContain('选择音乐');
    selectButton.props.onClick();
    expect(select).toHaveBeenCalledOnce();
    expect(preview).not.toHaveBeenCalled();
    previewButton.props.onClick();
    expect(preview).toHaveBeenCalledOnce();
  });

  it('links every catalog item to a bundled audio file and filters by mood', () => {
    expect(songData.items).toHaveLength(10);
    expect(MUSIC_TRACKS.every((track) => track.audioUrl.length > 0)).toBe(true);
    expect(MUSIC_TRACKS.every((track) => track.coverUrl !== null)).toBe(true);
    expect(MUSIC_TRACKS.filter((track) => matchesMusicCategory(track, '平静')).every((track) => track.mood === '平静')).toBe(true);
    expect(MUSIC_TRACKS.filter((track) => matchesMusicCategory(track, '励志')).every((track) => track.mood === '励志')).toBe(true);
  });

  it('moves categories into the more menu as the available width shrinks', () => {
    expect(getVisibleMusicCategories(260)).toEqual(['全部', '平静', '欢快', '励志', '抒情']);
    expect(getVisibleMusicCategories(210)).toEqual(['全部', '平静', '欢快', '励志']);
    expect(getVisibleMusicCategories(170)).toEqual(['全部', '平静', '欢快']);
  });
});
