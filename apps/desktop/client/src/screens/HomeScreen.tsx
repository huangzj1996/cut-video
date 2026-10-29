import brandMarkUrl from '../assets/brand-mark.png';
import { CreateVideoScreen } from './CreateVideoScreen';
import { SidebarTabs, type SidebarTabItem } from './SidebarTabs';
import { WorkspaceScreen } from './WorkspaceScreen';
import './home.css';

export type HomeTab = 'create' | 'projects';

type SidebarTab = HomeTab | 'home';

const TABS: readonly SidebarTabItem<SidebarTab>[] = [
  { disabled: true, icon: 'home', id: 'home', label: '首页', title: '后续任务' },
  { icon: 'scissors', iconSize: 22, id: 'create', label: '创作' },
  { icon: 'folder', id: 'projects', label: '项目' },
];

const tabId = (tab: SidebarTab): string => `home-tab-${tab}`;
const panelId = (tab: SidebarTab): string => `home-panel-${tab}`;

export function HomeScreen({ activeTab }: { activeTab: HomeTab }) {
  const handleTabChange = (tab: SidebarTab): void => {
    if (tab === 'create') {
      window.location.hash = '#/create';
    } else if (tab === 'projects') {
      window.location.hash = '#/workspace';
    }
  };

  return (
    <div className="home-screen">
      <aside className="cr-sidebar">
        <div aria-hidden="true" className="cr-sidebar-glow" />
        <div aria-hidden="true" className="cr-sidebar-band" />

        <button
          className="cr-brand"
          type="button"
          onClick={() => {
            window.location.hash = '#/create';
          }}
        >
          <img alt="" className="cr-brand-mark" src={brandMarkUrl} />
          <span className="cr-brand-copy">
            <strong>妙剪 Magicut</strong>
            <small>智能视频剪辑工具</small>
          </span>
        </button>

        <SidebarTabs
          activeTab={activeTab}
          ariaLabel="主导航"
          className="cr-capsule"
          items={TABS}
          onChange={handleTabChange}
          panelId={panelId}
          tabId={tabId}
        />
      </aside>

      <main className="home-content">
        <section
          aria-labelledby={tabId('create')}
          className="home-panel"
          hidden={activeTab !== 'create'}
          id={panelId('create')}
          role="tabpanel"
        >
          <CreateVideoScreen />
        </section>

        <section
          aria-labelledby={tabId('projects')}
          className="home-panel"
          hidden={activeTab !== 'projects'}
          id={panelId('projects')}
          role="tabpanel"
        >
          <WorkspaceScreen active={activeTab === 'projects'} />
        </section>
      </main>
    </div>
  );
}
