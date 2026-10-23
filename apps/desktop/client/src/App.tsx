import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, AppSettings, MediaInfo } from '../../shared/ipc-contract';
import { IpcClientError, unwrapIpc } from './lib/ipc';
import { CreateChatScreen } from './screens/CreateChatScreen';
import { CreateVideoScreen } from './screens/CreateVideoScreen';
import { EditorVideoScreen } from './screens/EditorVideoScreen';
import { WorkspaceScreen } from './screens/WorkspaceScreen';

function formatPlatform(platform: string): string {
  const labels: Record<string, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };

  return labels[platform] ?? platform;
}

function formatError(caught: unknown): string {
  if (caught instanceof IpcClientError) {
    return `${caught.payload.code}: ${caught.message}`;
  }

  return caught instanceof Error ? caught.message : String(caught);
}

function StatusScreen() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [pingResult, setPingResult] = useState('未测试');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        if (!window.miaoma) {
          throw new Error('Preload 桥接未加载：window.miaoma 不存在');
        }

        const [infoResponse, settingsResponse, mediaResponse] = await Promise.all([
          window.miaoma.getAppInfo(),
          window.miaoma.getSettings(),
          window.miaoma.getMediaInfo(),
        ]);

        const info = unwrapIpc(infoResponse);
        const nextSettings = unwrapIpc(settingsResponse);
        const media = unwrapIpc(mediaResponse);

        if (!cancelled) {
          setAppInfo(info);
          setSettings(nextSettings);
          setMediaInfo(media);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(formatError(caught));
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePing = useCallback(async (): Promise<void> => {
    setPingResult('请求中…');

    try {
      const result = unwrapIpc(await window.miaoma.ping());
      setPingResult(result);
    } catch (caught) {
      setPingResult(formatError(caught));
    }
  }, []);

  const refreshMedia = useCallback(async (): Promise<void> => {
    setRefreshing(true);

    try {
      const media = unwrapIpc(await window.miaoma.getMediaInfo());
      setMediaInfo(media);
      setError(null);
    } catch (caught) {
      setError(formatError(caught));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const mediaReady = mediaInfo?.ffmpegExists === true && mediaInfo.ffprobeExists === true;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            剪
          </div>
          <div>
            <div className="brand-name">妙剪</div>
            <div className="brand-sub">Magicut</div>
          </div>
        </div>

        <nav className="nav" aria-label="主导航">
          <button className="nav-item" type="button" disabled title="后续任务">
            首页
            <span className="nav-badge">后续</span>
          </button>
          <button className="nav-item nav-item-active" type="button" aria-current="page">
            创作
            <span className="nav-dot" aria-hidden="true" />
          </button>
          <button className="nav-item" type="button" disabled title="后续任务">
            项目
            <span className="nav-badge">后续</span>
          </button>
        </nav>

        <div className="sidebar-note">
          <span className="status-dot status-dot-ok" aria-hidden="true" />
          T01 脚手架运行中
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">花生AI · 妙剪 Magicut</p>
            <h1>桌面创作工具</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="button button-ghost"
              type="button"
              onClick={() => {
                window.location.hash = '#/create';
              }}
            >
              创作页
            </button>
            <button
              className="button button-ghost"
              type="button"
              onClick={() => {
                window.location.hash = '#/editor';
              }}
            >
              编辑器画面
            </button>
            <button className="button button-ghost" type="button" onClick={() => void handlePing()}>
              测试 IPC
            </button>
            <button
              className="button"
              type="button"
              onClick={() => void refreshMedia()}
              disabled={refreshing}
            >
              {refreshing ? '检测中…' : '重新检测 FFmpeg'}
            </button>
          </div>
        </header>

        {error ? (
          <div className="alert" role="alert">
            {error}
          </div>
        ) : null}

        <section className="hero">
          <div className="hero-copy">
            <span className="pill">T01 · 工程脚手架</span>
            <h2>
              从文稿到成片，
              <br />
              <span>先把地基搭稳。</span>
            </h2>
            <p>
              Electron + React + TypeScript + Vite + Forge，pnpm workspace 已就绪。下一步进入
              LangGraph 技术验证，再开始十节点工作流。
            </p>
          </div>

          <div className="hero-panel" aria-label="当前进度">
            <div className="hero-panel-title">当前进度</div>
            <div className="progress-row">
              <span>Monorepo / workspace</span>
              <span className="tick">已完成</span>
            </div>
            <div className="progress-row">
              <span>Electron 主进程 / Preload</span>
              <span className="tick">已完成</span>
            </div>
            <div className="progress-row">
              <span>React 渲染进程</span>
              <span className="tick">已完成</span>
            </div>
            <div className="progress-row">
              <span>LangGraph 运行时</span>
              <span className="muted">T02 验证</span>
            </div>
            <div className="progress-row">
              <span>业务工作流</span>
              <span className="muted">M2 开始</span>
            </div>
          </div>
        </section>

        <section className="card-grid" aria-label="运行信息">
          <article className="card">
            <h3>运行环境</h3>
            {appInfo ? (
              <dl className="data-list">
                <div>
                  <dt>应用</dt>
                  <dd>
                    {appInfo.name} · v{appInfo.version}
                  </dd>
                </div>
                <div>
                  <dt>Electron</dt>
                  <dd className="mono">{appInfo.electron}</dd>
                </div>
                <div>
                  <dt>Node</dt>
                  <dd className="mono">{appInfo.node}</dd>
                </div>
                <div>
                  <dt>Chromium</dt>
                  <dd className="mono">{appInfo.chrome}</dd>
                </div>
                <div>
                  <dt>平台</dt>
                  <dd className="mono">
                    {formatPlatform(appInfo.platform)} / {appInfo.arch}
                  </dd>
                </div>
                <div>
                  <dt>默认工程目录</dt>
                  <dd className="mono">{settings?.defaultProjectDirectory ?? '读取中…'}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">读取中…</p>
            )}
          </article>

          <article className="card">
            <h3>IPC 桥接</h3>
            <p className="muted">Preload 通过 contextBridge 只暴露白名单方法。</p>
            <div className="ping-row">
              <span className="mono">app:ping</span>
              <span
                className={`status-pill ${pingResult === 'pong' ? 'status-pill-ok' : ''}`}
                aria-live="polite"
              >
                {pingResult}
              </span>
            </div>
            <p className="hint">
              {pingResult === 'pong'
                ? '主进程与渲染进程通信正常。'
                : '点击“测试 IPC”验证主进程通道。'}
            </p>
          </article>

          <article className="card card-wide">
            <div className="card-heading">
              <h3>媒体工具</h3>
              <span className={`status-pill ${mediaReady ? 'status-pill-ok' : 'status-pill-warn'}`}>
                {mediaReady ? '已就绪' : '待配置'}
              </span>
            </div>
            <p className="muted">
              开发态回退系统 PATH；打包前把 ffmpeg.exe / ffprobe.exe 放入
              <span className="mono"> apps/desktop/resources/ffmpeg/</span>。
            </p>
            <dl className="data-list">
              <div>
                <dt>ffmpeg</dt>
                <dd className="mono">{mediaInfo?.ffmpegPath ?? '—'}</dd>
              </div>
              <div>
                <dt>ffprobe</dt>
                <dd className="mono">{mediaInfo?.ffprobePath ?? '—'}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  {mediaInfo
                    ? `ffmpeg ${mediaInfo.ffmpegExists ? '可用' : '未找到'} · ffprobe ${
                        mediaInfo.ffprobeExists ? '可用' : '未找到'
                      }`
                    : '读取中…'}
                </dd>
              </div>
            </dl>
          </article>

          <article className="card card-wide">
            <h3>下一步</h3>
            <ol className="next-list">
              <li>
                <span className="next-id">T02</span>
                LangGraph + Electron 技术验证：StateGraph、JSON
                checkpointer、interrupt/resume、打包。
              </li>
              <li>
                <span className="next-id">T03</span>
                Zod 契约与 IPC：10 节点、ChatMessage、ProductionSpec、EditIntent、VideoProject。
              </li>
              <li>
                <span className="next-id">T04</span>
                工程仓库、自动保存、备份、素材重定位与项目锁。
              </li>
            </ol>
          </article>
        </section>

        <footer className="footer">妙剪 Magicut · T01 工程脚手架 · 2026-10-23</footer>
      </main>
    </div>
  );
}

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const handleHashChange = () => {
      setHash(window.location.hash);
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  return hash;
}

function App() {
  const hash = useHashRoute();

  if (hash === '#/status') {
    return <StatusScreen />;
  }

  if (hash === '#/workspace') {
    return <WorkspaceScreen />;
  }

  if (hash === '#/create-chat') {
    return <CreateChatScreen />;
  }

  if (hash === '#/editor') {
    return <EditorVideoScreen />;
  }

  return <CreateVideoScreen />;
}

export default App;
