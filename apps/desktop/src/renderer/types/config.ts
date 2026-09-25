import type { LucideIcon } from 'lucide-react';
import type { EditorTool } from './editor';
import type { SubtitleSettings } from './subtitle';
import type { MusicSettings } from './music';

export interface ConfigPanelProps {
  activeTool: EditorTool;
  subtitleSettings: SubtitleSettings;
  onSubtitleChange: (settings: SubtitleSettings) => void;
  musicSettings: MusicSettings;
  onMusicChange: (settings: MusicSettings) => void;
}

export interface ConfigRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  progressColor?: string;
}

export interface ConfigSliderProps extends ConfigRangeProps {
  icon: LucideIcon;
  displayValue: string;
}
