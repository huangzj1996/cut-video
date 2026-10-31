import type { SubtitleClip, SubtitleTrack, VideoProject } from '@miaoma/video-project';
import { EXPORT_OUTPUT_SPEC } from '../../shared/ipc-contract';
import { isRenderableSubtitleClip, shouldBurnSubtitles } from '../../shared/subtitle-burn';
import { subtitlePresetStyle } from '../../shared/subtitle-presets';
import { EXPORT_FONT_FAMILY } from './fonts';

/** 与预览同一块画布：1920×1080 的工程像素。 */
const CANVAS_WIDTH = EXPORT_OUTPUT_SPEC.width;
const CANVAS_HEIGHT = EXPORT_OUTPUT_SPEC.height;

/** 预览底部安全区是画面高度的 7%，导出沿用同一比例换算 ASS MarginV。 */
const BOTTOM_SAFE_AREA_RATIO = 0.07;
/** 预览字幕容器宽 84%，左右各留 8%。 */
const SIDE_SAFE_AREA_RATIO = 0.08;
/** 需求 §7.3：字幕最多 2 行、每行 16–20 字。 */
const MAX_LINE_CHARS = 20;
const MIN_LINE_CHARS = 16;

/** 预览 `-webkit-text-stroke: 0.045em`，换算成 ASS Outline。 */
const OUTLINE_EM = 0.045;
/** 与 SubtitleStyleSchema 的 24–72 一致；越界数据不让它撑破安全区。 */
const FONT_SIZE_MIN = 24;
const FONT_SIZE_MAX = 72;
/** ASS 里 -1 表示真值（加粗），与预览 font-weight: 700 对齐。 */
const ASS_BOLD = -1;
/** ASS alignment 2 = 底部居中。 */
const ALIGNMENT_BOTTOM_CENTER = 2;
/** 底部安全区与左右安全区按画布像素换算成 ASS 边距。 */
const ASS_MARGIN_V = Math.round(CANVAS_HEIGHT * BOTTOM_SAFE_AREA_RATIO);
const ASS_MARGIN_LR = Math.round(CANVAS_WIDTH * SIDE_SAFE_AREA_RATIO);

/**
 * 滤镜参数里的路径必须用相对 ASCII 文件名（实测中文绝对路径会让滤镜初始化失败），
 * 因此 ASS 与 fontsdir 都写在目标目录下，进程 cwd 指向目标目录。
 * 文件名带每次导出的唯一 token，避免覆盖或误删导出目录里已有的同名文件。
 */
const ARTIFACT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface SubtitleArtifactFileNames {
  assFileName: string;
  fontsDirName: string;
}

export function subtitleArtifactFileNames(token: string): SubtitleArtifactFileNames {
  if (!ARTIFACT_TOKEN_PATTERN.test(token)) {
    throw new Error('无效的导出产物标识：' + token);
  }

  return {
    assFileName: '.miaoma-export-' + token + '.ass',
    fontsDirName: '.miaoma-export-' + token + '-fonts',
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** ASS 时间戳：H:MM:SS.cc（厘秒）。 */
export function formatAssCentiseconds(centiseconds: number): string {
  const total = Math.max(0, Math.round(centiseconds));
  const cs = total % 100;
  const totalSeconds = (total - cs) / 100;

  return (
    Math.floor(totalSeconds / 3600) +
    ':' +
    pad2(Math.floor((totalSeconds % 3600) / 60)) +
    ':' +
    pad2(totalSeconds % 60) +
    '.' +
    pad2(cs)
  );
}

/** ASS 颜色：&HAABBGGRR（不透明），由预设的 #RRGGBB 换序得到。 */
export function assColor(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());

  if (!match) {
    throw new Error('无效的字幕颜色：' + hex);
  }

  const value = match[1] ?? '';
  const red = value.slice(0, 2);
  const green = value.slice(2, 4);
  const blue = value.slice(4, 6);

  return '&H00' + (blue + green + red).toUpperCase();
}

/** 一行里优先断在标点/空格之后，避免把词语或句子切在中间。 */
const LINE_BREAK_CHARS = new Set([
  '，',
  '。',
  '！',
  '？',
  '；',
  '：',
  '、',
  '）',
  '…',
  ',',
  '.',
  '!',
  '?',
  ';',
  ':',
  ')',
  ' ',
]);

/**
 * 在「两行都能放下」的区间里选断点：优先靠近均分的标点/空格，其次按均分硬切。
 * 超过 40 字时两行放不下，只保证第一行 16–20 字，剩余部分由调用方截断。
 */
function findLineBreak(text: string): number {
  const upper = Math.min(MAX_LINE_CHARS, text.length - 1);
  const lower = Math.max(MIN_LINE_CHARS, text.length - MAX_LINE_CHARS);

  if (lower > upper) {
    for (let index = upper; index >= MIN_LINE_CHARS; index -= 1) {
      if (LINE_BREAK_CHARS.has(text[index - 1] ?? '')) {
        return index;
      }
    }

    return upper;
  }

  const balanced = Math.ceil(text.length / 2);
  let bestBreak = -1;
  let bestDistance = Infinity;

  for (let index = lower; index <= upper; index += 1) {
    if (LINE_BREAK_CHARS.has(text[index - 1] ?? '')) {
      const distance = Math.abs(index - balanced);

      if (distance < bestDistance) {
        bestBreak = index;
        bestDistance = distance;
      }
    }
  }

  return bestBreak > 0 ? bestBreak : Math.min(upper, Math.max(lower, balanced));
}

/**
 * 句级字幕的两行切分：合并空白后按 16–20 字断行，最多两行。
 * 正常句级字幕由 TTS 按 ≤24 字切块；超过 40 字的异常长句两行放不下，
 * 按预览的两行截断语义收口（末行加省略号），不生成第三行。
 */
export function wrapSubtitleText(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) {
    return [];
  }

  if (normalized.length <= MAX_LINE_CHARS) {
    return [normalized];
  }

  const breakAt = Math.max(1, Math.min(findLineBreak(normalized), normalized.length));
  const first = normalized.slice(0, breakAt).trim();
  const rest = normalized.slice(breakAt).trim();

  if (first.length === 0) {
    return rest.length > 0 ? [rest] : [];
  }

  if (rest.length === 0) {
    return [first];
  }

  if (rest.length <= MAX_LINE_CHARS) {
    return [first, rest];
  }

  return [first, rest.slice(0, MAX_LINE_CHARS - 1).trimEnd() + '…'];
}

/**
 * ASS 正文转义：`{` 会被 libass 当成覆盖块起始，反斜杠本身有换行/空格转义语义。
 * 这里把反斜杠转义成字面量并去掉花括号，保证任意字幕文本都不会破坏 ASS 结构。
 */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[{}]/g, '');
}

function clampFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return FONT_SIZE_MIN;
  }

  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize));
}

function formatMetric(value: number): string {
  return String(Number(value.toFixed(2)));
}

function findSubtitleTrack(project: VideoProject): SubtitleTrack | undefined {
  return project.tracks.find((track): track is SubtitleTrack => track.kind === 'subtitle');
}

function dialogueLine(clip: SubtitleClip): string | null {
  // 空白文本与零/负时长片段不会进入 ASS；这条判定与预览/弹窗共用同一份规则。
  if (!isRenderableSubtitleClip(clip)) {
    return null;
  }

  const lines = wrapSubtitleText(clip.text);

  const startCentiseconds = Math.max(0, Math.round(clip.startMs / 10));
  const endCentiseconds = Math.max(startCentiseconds + 1, Math.round(clip.endMs / 10));
  const text = lines.map((line) => escapeAssText(line)).join('\\N');

  return (
    'Dialogue: 0,' +
    formatAssCentiseconds(startCentiseconds) +
    ',' +
    formatAssCentiseconds(endCentiseconds) +
    ',Default,,0,0,0,,' +
    text
  );
}

function buildStyleLine(track: SubtitleTrack): string {
  const preset = subtitlePresetStyle(track.style.presetId);
  const fontSize = clampFontSize(track.style.fontSize);
  const primary = assColor(preset.color);
  const outlineColor = assColor(preset.outline);

  return [
    'Style: Default',
    EXPORT_FONT_FAMILY,
    String(fontSize),
    primary,
    primary,
    outlineColor,
    '&H00000000',
    String(ASS_BOLD),
    '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    '1',
    formatMetric(OUTLINE_EM * fontSize),
    '0',
    String(ALIGNMENT_BOTTOM_CENTER),
    String(ASS_MARGIN_LR),
    String(ASS_MARGIN_LR),
    String(ASS_MARGIN_V),
    '1',
  ].join(',');
}

/**
 * 把工程字幕轨编译成一份可烧录的 ASS 文档；返回 null 表示这次导出不烧录字幕
 * （轨道不存在、轨道不可见或没有有效字幕）。
 * 纯函数：不读磁盘、不启动进程。
 */
export function buildSubtitleDocument(project: VideoProject): string | null {
  // 工程开关、轨道可见性与有效字幕三条规则与导出弹窗共用，避免两处判定漂移。
  if (!shouldBurnSubtitles(project)) {
    return null;
  }

  const track = findSubtitleTrack(project);

  // shouldBurnSubtitles 已保证存在；这里只为类型窄化。
  if (!track) {
    return null;
  }

  const events = track.clips
    .slice()
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .map(dialogueLine)
    .filter((line): line is string => line !== null);

  if (events.length === 0) {
    return null;
  }

  return [
    '[Script Info]',
    '; 妙剪 Magicut 导出字幕（按工程字幕轨样式生成）',
    'ScriptType: v4.00+',
    'PlayResX: ' + CANVAS_WIDTH,
    'PlayResY: ' + CANVAS_HEIGHT,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    buildStyleLine(track),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
