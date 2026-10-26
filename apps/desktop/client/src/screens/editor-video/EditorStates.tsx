import type { ReactNode } from 'react';
import { WORKSPACE_HASH } from '../../lib/routes';
import '../editor-video.css';

function EditorFallbackFrame({
  children,
  role,
}: {
  children: ReactNode;
  role: 'alert' | 'status';
}) {
  return (
    <div className="editor-screen ed-fallback">
      <section className="ed-fallback-card" role={role}>
        <span className="ed-fallback-kicker">妙剪 Magicut · 编辑器</span>
        {children}
      </section>
    </div>
  );
}

export function EditorLoading({
  message = '正在读取最新的工程文件…',
  title = '正在加载工程',
}: {
  message?: string;
  title?: string;
}) {
  return (
    <EditorFallbackFrame role="status">
      <h1>{title}</h1>
      <p>{message}</p>
    </EditorFallbackFrame>
  );
}

export function EditorEmpty({ message }: { message: string }) {
  return (
    <EditorFallbackFrame role="status">
      <h1>工程还没有分镜</h1>
      <p>{message}</p>
      <button
        className="ed-fallback-action"
        type="button"
        onClick={() => {
          window.location.hash = WORKSPACE_HASH;
        }}
      >
        返回工作台
      </button>
    </EditorFallbackFrame>
  );
}

export function EditorUnavailable({ message }: { message: string }) {
  return (
    <EditorFallbackFrame role="alert">
      <h1>无法打开工程</h1>
      <p>{message}</p>
      <button
        className="ed-fallback-action"
        type="button"
        onClick={() => {
          window.location.hash = WORKSPACE_HASH;
        }}
      >
        返回工作台
      </button>
    </EditorFallbackFrame>
  );
}
