import type { LucideIcon } from 'lucide-react';

export type EditorTool = 'picture' | 'voice' | 'subtitle' | 'music';

export interface ToolRailEntry {
  id: EditorTool | null;
  label: string;
  icon: LucideIcon;
}

export interface ToolRailProps {
  activeTool: EditorTool;
  onSelect: (tool: EditorTool) => void;
}
