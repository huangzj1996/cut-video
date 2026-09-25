import type { Scene } from './scene';
import type { SubtitleSettings } from './subtitle';

export interface PreviewPanelProps {
  scene: Scene;
  subtitleSettings: SubtitleSettings;
}

export interface SubtitleOverlayProps {
  scene: Scene;
  settings: SubtitleSettings;
}
