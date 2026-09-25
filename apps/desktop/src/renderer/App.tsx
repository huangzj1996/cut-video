import { useState } from 'react';
import { INITIAL_SCENE_ID, SCENES } from './constants/scenes';
import { DEFAULT_SUBTITLE_SETTINGS } from './constants/subtitle';
import { DEFAULT_MUSIC_SETTINGS } from './constants/music';
import { ConfigPanel } from './components/config/ConfigPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { ScriptPanel } from './components/ScriptPanel';
import { Timeline } from './components/Timeline';
import { ToolRail } from './components/ToolRail';
import { TopBar } from './components/TopBar';
import type { EditorTool } from './types/editor';
import type { SubtitleSettings } from './types/subtitle';
import type { MusicSettings } from './types/music';

export function App() {
  const [activeTool, setActiveTool] = useState<EditorTool>('picture');
  const [selectedSceneId, setSelectedSceneId] = useState(INITIAL_SCENE_ID);
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(DEFAULT_SUBTITLE_SETTINGS);
  const [musicSettings, setMusicSettings] = useState<MusicSettings>(DEFAULT_MUSIC_SETTINGS);
  const selectedScene = SCENES.find((scene) => scene.id === selectedSceneId) ?? SCENES[0];

  return (
    <main className="flex h-screen min-h-[720px] w-screen min-w-[1100px] flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="titlebar-clearance shrink-0 bg-[#111318]" aria-hidden="true" />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ScriptPanel selectedScene={selectedScene} onSelectScene={setSelectedSceneId} />
        <PreviewPanel scene={selectedScene} subtitleSettings={subtitleSettings} />
        <ConfigPanel activeTool={activeTool} subtitleSettings={subtitleSettings} onSubtitleChange={setSubtitleSettings} musicSettings={musicSettings} onMusicChange={setMusicSettings} />
        <ToolRail activeTool={activeTool} onSelect={setActiveTool} />
      </div>
      <Timeline />
    </main>
  );
}
