import type { ReactNode, SVGProps } from 'react';

export type EditorIconName =
  | 'export'
  | 'play'
  | 'pause'
  | 'volume'
  | 'volume-off'
  | 'expand'
  | 'image'
  | 'mic'
  | 'subtitles'
  | 'music'
  | 'undo'
  | 'redo'
  | 'split'
  | 'magnet'
  | 'link'
  | 'wave'
  | 'minus'
  | 'plus'
  | 'arrow-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-down'
  | 'send'
  | 'close'
  | 'home'
  | 'scissors'
  | 'folder'
  | 'sparkles'
  | 'check'
  | 'lock'
  | 'video-track'
  | 'mic-track'
  | 'subtitle-track';

const FILLED_ICONS: ReadonlySet<EditorIconName> = new Set(['play', 'pause']);

const ICON_NODES: Record<EditorIconName, ReactNode> = {
  export: (
    <>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" />,
  pause: (
    <>
      <path d="M7 5h3.5v14H7z" />
      <path d="M13.5 5H17v14h-3.5z" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
      <path d="M19.5 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="m17 9 5 5" />
      <path d="m22 9-5 5" />
    </>
  ),
  expand: (
    <>
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M8 20H4v-4" />
      <path d="M16 20h4v-4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h4" />
      <path d="M13 10h4" />
      <path d="M7 14h3" />
      <path d="M12 14h5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h9a5 5 0 0 1 5 5v1" />
    </>
  ),
  redo: (
    <>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a5 5 0 0 0-5 5v1" />
    </>
  ),
  split: (
    <>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <path d="M8 8.5 20 17" />
      <path d="M8 15.5 20 7" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6z" />
      <path d="M6 8h4" />
      <path d="M14 8h4" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  wave: (
    <>
      <path d="M3 12h2" />
      <path d="M7 8v8" />
      <path d="M11 5v14" />
      <path d="M15 7v10" />
      <path d="M19 10v4" />
      <path d="M21 12h0" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  'arrow-left': <path d="m15 18-6-6 6-6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m18 15-6-6-6 6" />,
  'arrow-down': (
    <>
      <path d="M12 4v12" />
      <path d="m8 12 4 4 4-4" />
      <path d="M5 20h14" />
    </>
  ),
  send: (
    <>
      <path d="M12 20V5" />
      <path d="m6 11 6-6 6 6" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88" />
      <path d="M14.47 14.48 20 20" />
      <path d="M8.12 8.12 12 12" />
    </>
  ),
  folder: (
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  sparkles: (
    <>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  'video-track': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v14" />
      <path d="M16 5v14" />
      <path d="M3 9h5" />
      <path d="M3 15h5" />
      <path d="M16 9h5" />
      <path d="M16 15h5" />
    </>
  ),
  'mic-track': (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  'subtitle-track': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11h10" />
      <path d="M7 15h6" />
    </>
  ),
};

interface EditorIconProps extends SVGProps<SVGSVGElement> {
  name: EditorIconName;
  size?: number;
}

export function EditorIcon({ name, size = 18, ...props }: EditorIconProps) {
  const filled = FILLED_ICONS.has(name);

  return (
    <svg
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      height={size}
      stroke={filled ? 'none' : 'currentColor'}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={filled ? undefined : 1.7}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {ICON_NODES[name]}
    </svg>
  );
}
