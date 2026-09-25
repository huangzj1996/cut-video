export interface VideoClip {
  label: string;
  start: number;
  end: number;
  color: string;
  accent: string;
}

export interface RulerMark {
  seconds: number;
  label: string;
}
