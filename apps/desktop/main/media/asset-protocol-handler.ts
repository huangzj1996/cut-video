import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import type { StoredProject } from '@miaoma/video-project';
import {
  ASSET_SCHEME,
  ASSET_SCHEME_PRIVILEGES,
  parseAssetUrl,
  planAssetResponse,
  type AssetFileStat,
} from './asset-protocol';

function statFile(filePath: string): AssetFileStat | null {
  try {
    const stat = statSync(filePath);

    return { isFile: stat.isFile(), size: stat.size };
  } catch {
    return null;
  }
}

function toResponse(plan: ReturnType<typeof planAssetResponse>, method: string): Response {
  const headers = new Headers(plan.headers);

  // HEAD 只回响应头，不发送 GET 会返回的正文。
  if (method === 'HEAD') {
    return new Response(null, { headers, status: plan.status });
  }

  if (plan.body) {
    const stream = Readable.toWeb(
      createReadStream(plan.body.filePath, { end: plan.body.end, start: plan.body.start }),
    ) as ReadableStream;

    return new Response(stream, { headers, status: plan.status });
  }

  return new Response(plan.text ?? null, { headers, status: plan.status });
}

/**
 * 必须在 app ready 之前调用一次。
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { privileges: ASSET_SCHEME_PRIVILEGES, scheme: ASSET_SCHEME },
  ]);
}

/**
 * 接管 `asset://` 协议。工程读取失败一律按 404 处理，不向渲染进程暴露路径。
 */
export function registerAssetProtocol(getProject: (projectId: string) => StoredProject): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const parsed = parseAssetUrl(request.url);
    let project: StoredProject | null = null;

    if (parsed) {
      try {
        project = getProject(parsed.projectId);
      } catch {
        project = null;
      }
    }

    const plan = planAssetResponse({
      method: request.method,
      project,
      rangeHeader: request.headers.get('range'),
      rawUrl: request.url,
      stat: statFile,
    });

    return toResponse(plan, request.method);
  });
}
