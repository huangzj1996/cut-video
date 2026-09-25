export interface Scene {
  id: number;
  time: string;
  lines: readonly string[];
}

export interface ScriptPanelProps {
  selectedScene: Scene;
  onSelectScene: (sceneId: number) => void;
}
