import { InspectorPanel } from './components/InspectorPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { ScriptPanel } from './components/ScriptPanel';
import { Timeline } from './components/Timeline';
import { ToolRail } from './components/ToolRail';
import { TopBar } from './components/TopBar';

export function App() {
  return (
    <main className="flex h-screen min-h-[720px] w-screen min-w-[1100px] flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="titlebar-clearance shrink-0 bg-[#111318]" aria-hidden="true" />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ScriptPanel />
        <PreviewPanel />
        <InspectorPanel />
        <ToolRail />
      </div>
      <Timeline />
    </main>
  );
}
