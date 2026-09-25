export type MusicCategory = '全部' | '平静' | '欢快' | '励志' | '抒情' | '治愈' | '悲壮' | '宏伟' | '悬疑';

export interface MusicTrack {
  id: string;
  title: string;
  mood: string;
  tempo: string;
  duration: string;
  scenes: readonly string[];
  audioUrl: string;
  coverUrl: string | null;
}

export interface MusicSettings {
  enabled: boolean;
  volume: number;
  appliedTrackId: string | null;
}

export interface MusicPanelProps {
  settings: MusicSettings;
  onChange: (settings: MusicSettings) => void;
}
