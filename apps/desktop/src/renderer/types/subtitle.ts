export type SubtitlePresetId =
  | 'white-outline'
  | 'classic-white'
  | 'yellow-outline'
  | 'red-outline'
  | 'cyan-gray'
  | 'pink'
  | 'blue';

export interface SubtitlePreset {
  id: SubtitlePresetId;
  name: string;
  textColor: string;
  outlineColor: string;
}

export interface SubtitleSettings {
  visible: boolean;
  fontSize: number;
  presetId: SubtitlePresetId;
}

export interface SubtitlePanelProps {
  settings: SubtitleSettings;
  onChange: (settings: SubtitleSettings) => void;
}

export interface SubtitleSizeCardProps {
  value: number;
  onChange: (value: number) => void;
}

export interface SubtitleStyleCardProps {
  selectedPreset: SubtitlePresetId;
  onSelect: (preset: SubtitlePresetId) => void;
}

export interface SubtitlePresetOptionProps {
  preset: SubtitlePreset;
  selected: boolean;
  onSelect: () => void;
}
