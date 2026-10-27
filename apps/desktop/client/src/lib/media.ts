/**
 * 渲染进程加载工程媒体的唯一入口：`asset://<projectId>/<assetId>`。
 * 真实文件路径与白名单校验都留在主进程，渲染进程不直接读取文件系统。
 */
export function assetUrl(projectId: string, assetId: string): string {
  return `asset://${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
}
