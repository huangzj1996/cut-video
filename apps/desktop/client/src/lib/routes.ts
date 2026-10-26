const EDITOR_HASH = '#/editor';
const CREATE_CHAT_HASH = '#/create-chat';
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const WORKSPACE_HASH = '#/workspace';

export function editorHash(projectId: string): string {
  return `${EDITOR_HASH}/${projectId}`;
}

export function createChatHash(projectId: string): string {
  return `${CREATE_CHAT_HASH}/${projectId}`;
}

export type EditorRoute =
  { kind: 'editor'; projectId: string } | { kind: 'invalid' } | { kind: 'other' };

export function isValidProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value);
}

/**
 * 编辑器使用项目级 hash 路由：`#/editor/<projectId>`。
 * 裸 `/editor`、非法 id 与子路径都视为无效；其他路由交回 App 继续匹配。
 */
export function parseEditorRoute(hash: string): EditorRoute {
  const path = hash.split('?', 1)[0] ?? '';

  if (path === EDITOR_HASH) {
    return { kind: 'invalid' };
  }

  if (!path.startsWith(`${EDITOR_HASH}/`)) {
    return { kind: 'other' };
  }

  const projectId = path.slice(EDITOR_HASH.length + 1);

  if (!isValidProjectId(projectId)) {
    return { kind: 'invalid' };
  }

  return { kind: 'editor', projectId };
}

/** 工作台打开工程：草稿回创作消息页，已完成工程进项目级编辑器。 */
export function projectOpenHash(projectId: string, isDraft: boolean): string {
  return isDraft ? createChatHash(projectId) : editorHash(projectId);
}
