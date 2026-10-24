export function ChatLoading() {
  return (
    <div className="cc-loading" role="status">
      <span className="cc-loading-dot" aria-hidden="true" />
      正在加载创作消息…
    </div>
  );
}

export function ChatMissingContext({ onBack }: { onBack: () => void }) {
  return (
    <div className="cc-missing">
      <h1>缺少工程上下文</h1>
      <p>请从创作页或工作台重新进入创作消息页。</p>
      <button className="cc-confirm" type="button" onClick={onBack}>
        返回工作台
      </button>
    </div>
  );
}

export function ChatEmpty() {
  return (
    <div className="cc-empty">
      <p>还没有创作消息。</p>
      <p>返回创作页填写文稿并创建项目后，智能体会在这里生成简报、分镜和成片。</p>
    </div>
  );
}

export function ChatErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="cc-error-banner" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button className="cc-retry" type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}
