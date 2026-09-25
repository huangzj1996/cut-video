import type { ReactNode } from 'react';
import type { ConfigPanelProps } from '../../types/config';
import type { EditorTool } from '../../types/editor';
import { InspectorShell } from './InspectorShell';
import { MusicPanel } from './music/MusicPanel';
import { SubtitlePanel } from './subtitle/SubtitlePanel';
import { VisualConfigPanel } from './visual/VisualConfigPanel';
import { VoiceoverPanel } from './voiceover/VoiceoverPanel';

const panelStrategies: Record<EditorTool, (props: ConfigPanelProps) => ReactNode> = {
  picture: () => <VisualConfigPanel />,
  voice: () => <VoiceoverPanel />,
  subtitle: ({ subtitleSettings, onSubtitleChange }) => <SubtitlePanel settings={subtitleSettings} onChange={onSubtitleChange} />,
  music: ({ musicSettings, onMusicChange }) => <MusicPanel settings={musicSettings} onChange={onMusicChange} />,
};

export function ConfigPanel(props: ConfigPanelProps) {
  const renderPanel = panelStrategies[props.activeTool];

  return (
    <InspectorShell>
      {renderPanel(props)}
    </InspectorShell>
  );
}
