import { Captions, Image as ImageIcon, Mic, Music2 } from 'lucide-react';
import type { ToolRailEntry } from '../types/editor';

export const TOOL_RAIL_ENTRIES = [
  { id: 'picture', label: '画面', icon: ImageIcon },
  { id: 'voice', label: '口播', icon: Mic },
  { id: 'subtitle', label: '字幕', icon: Captions },
  { id: 'music', label: '音乐', icon: Music2 },
] as const satisfies readonly ToolRailEntry[];
