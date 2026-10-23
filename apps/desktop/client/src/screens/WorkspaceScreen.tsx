import { useCallback, useEffect, useRef, useState } from 'react';
import brandMarkUrl from '../assets/brand-mark.png';
import projectAiAdvancedUrl from '../assets/workspace/project-ai-advanced.jpg';
import projectAiLearningUrl from '../assets/workspace/project-ai-learning.jpg';
import projectCeoInterviewUrl from '../assets/workspace/project-ceo-interview.jpg';
import projectCityVlogUrl from '../assets/workspace/project-city-vlog.jpg';
import projectGameTrailerUrl from '../assets/workspace/project-game-trailer.jpg';
import projectLivestreamUrl from '../assets/workspace/project-livestream.jpg';
import projectSaasLaunchUrl from '../assets/workspace/project-saas-launch.jpg';
import { EditorIcon } from './editor-icons';
import './workspace.css';

interface ProjectItem {
  coverUrl: string;
  createdAt: string;
  id: string;
  title: string;
}

const PROJECTS: readonly ProjectItem[] = [
  {
    coverUrl: projectAiAdvancedUrl,
    createdAt: '2026-06-10',
    id: 'ai-advanced',
    title: '前端AI进阶路线：3个月从调接口到架构师',
  },
  {
    coverUrl: projectAiLearningUrl,
    createdAt: '2026-06-10',
    id: 'ai-learning',
    title: '前端AI学习路线：从调接口到50K架构师的3个月进阶攻略',
  },
  {
    coverUrl: projectLivestreamUrl,
    createdAt: '2026-06-11',
    id: 'livestream',
    title: '618直播高光混剪：从长视频自动提炼爆点',
  },
  {
    coverUrl: projectSaasLaunchUrl,
    createdAt: '2026-06-12',
    id: 'saas-launch',
    title: 'SaaS新功能发布短片：一分钟讲清核心卖点',
  },
  {
    coverUrl: projectCeoInterviewUrl,
    createdAt: '2026-06-09',
    id: 'ceo-interview',
    title: 'CEO访谈精剪版：品牌故事与团队幕后',
  },
  {
    coverUrl: projectCityVlogUrl,
    createdAt: '2026-06-08',
    id: 'city-vlog',
    title: '周末城市咖啡探店：生活方式短片模板',
  },
  {
    coverUrl: projectGameTrailerUrl,
    createdAt: '2026-06-07',
    id: 'game-trailer',
    title: '独立游戏实机预告：节奏卡点与字幕包装',
  },
];

const GO_EDITOR = () => {
  window.location.hash = '#/editor';
};

interface ProjectCardProps {
  project: ProjectItem;
  onNotify: (message: string) => void;
}

function ProjectCard({ project, onNotify }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupId = `ws-project-menu-${project.id}`;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const closeAndNotify = (message: string) => {
    setMenuOpen(false);
    onNotify(message);
  };

  return (
    <article
      aria-labelledby={`ws-project-title-${project.id}`}
      className={`ws-project-card${menuOpen ? ' is-menu-open' : ''}`}
    >
      <button
        aria-label={`继续编辑：${project.title}`}
        className="ws-project-body"
        type="button"
        onClick={GO_EDITOR}
      >
        <span className="ws-project-cover">
          <img alt="" draggable={false} src={project.coverUrl} />
        </span>
        <span className="ws-project-info">
          <span className="ws-project-title" id={`ws-project-title-${project.id}`}>
            {project.title}
          </span>
          <span className="ws-project-meta">创建时间 {project.createdAt}</span>
        </span>
      </button>

      <div className="ws-project-menu" ref={menuRef}>
        <button
          aria-controls={popupId}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`${project.title}的项目菜单`}
          className="ws-project-menu-trigger"
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg aria-hidden="true" height="18" viewBox="0 0 18 18" width="18">
            <circle cx="4" cy="9" fill="currentColor" r="1.35" />
            <circle cx="9" cy="9" fill="currentColor" r="1.35" />
            <circle cx="14" cy="9" fill="currentColor" r="1.35" />
          </svg>
        </button>

        {menuOpen ? (
          <div
            aria-label={`${project.title}的操作`}
            className="ws-project-menu-popup"
            id={popupId}
            role="menu"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                GO_EDITOR();
              }}
            >
              打开项目
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => closeAndNotify('重命名/删除将在后续版本开放')}
            >
              重命名
            </button>
            <button
              className="ws-project-menu-danger"
              role="menuitem"
              type="button"
              onClick={() => closeAndNotify('重命名/删除将在后续版本开放')}
            >
              删除
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function WorkspaceScreen() {
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const notify = useCallback((message: string) => {
    setNotice(message);

    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
    }

    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
      }
    };
  }, []);

  const scrollToTop = () => {
    mainRef.current?.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <div className="ws-screen">
      <aside className="ws-sidebar">
        <div aria-hidden="true" className="ws-sidebar-glow" />
        <div aria-hidden="true" className="ws-sidebar-orb" />

        <div className="ws-brand">
          <img alt="" className="ws-brand-mark" src={brandMarkUrl} />
          <span className="ws-brand-copy">
            <strong>妙剪 Magicut</strong>
            <small>智能视频剪辑工具</small>
          </span>
        </div>

        <nav aria-label="主导航" className="ws-capsule">
          <button className="ws-nav-item" disabled title="后续任务" type="button">
            <span className="ws-nav-icon">
              <EditorIcon name="home" size={20} />
            </span>
            <span className="ws-nav-label">首页</span>
          </button>

          <button
            className="ws-nav-item ws-nav-item--link"
            type="button"
            onClick={() => {
              window.location.hash = '#/create';
            }}
          >
            <span className="ws-nav-icon">
              <EditorIcon name="scissors" size={22} />
            </span>
            <span className="ws-nav-label">创作</span>
          </button>

          <button
            aria-current="page"
            className="ws-nav-item ws-nav-item--active"
            type="button"
            onClick={scrollToTop}
          >
            <span className="ws-nav-icon">
              <EditorIcon name="folder" size={20} />
            </span>
            <span className="ws-nav-label">项目</span>
          </button>
        </nav>
      </aside>

      <main className="ws-main" ref={mainRef}>
        <div className="ws-content">
          <header className="ws-heading">
            <h1>所有项目</h1>
            <p>创建、查看和继续编辑你的智能视频项目</p>
          </header>

          <section aria-label="项目列表" className="ws-grid">
            <button
              className="ws-create-card"
              type="button"
              onClick={() => {
                window.location.hash = '#/create';
              }}
            >
              <span aria-hidden="true" className="ws-create-art">
                <span className="ws-create-tile ws-create-tile--lime" />
                <span className="ws-create-tile ws-create-tile--violet">
                  <svg fill="none" viewBox="0 0 40 40">
                    <path
                      d="M10 14h20M10 22h11"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="3.2"
                    />
                    <path
                      d="m25.5 17.7 8.3 5.3-8.3 5.3z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeLinejoin="round"
                      strokeWidth="1.5"
                    />
                  </svg>
                </span>
              </span>
              <span className="ws-create-button">创建新作品</span>
            </button>

            {PROJECTS.map((project) => (
              <ProjectCard key={project.id} project={project} onNotify={notify} />
            ))}
          </section>
        </div>

        {notice ? (
          <div className="ws-toast" role="status">
            {notice}
          </div>
        ) : null}
      </main>
    </div>
  );
}
