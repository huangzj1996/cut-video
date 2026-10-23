import type { ScanCandidateStatus, ScanDetected, ScanIssue } from './asset-scanner';
import type { AssetKind } from './extension-registry';

export const ASSET_MANIFEST_VERSION = 1;

export interface AssetManifestItem {
  detected: ScanDetected;
  extension: string;
  fileName: string;
  issues: ScanIssue[];
  itemId: string;
  kind: AssetKind | null;
  mtimeMs: number;
  path: string;
  pathKey: string;
  sizeBytes: number;
  status: ScanCandidateStatus;
}

/**
 * 创建页素材选择的持久化清单。
 *
 * 写入 `<project>/inputs/assets.json`，包含主进程内部路径；
 * 不通过 IPC 返回给渲染进程。
 */
export interface AssetSelectionManifest {
  items: AssetManifestItem[];
  issues: ScanIssue[];
  manifestVersion: typeof ASSET_MANIFEST_VERSION;
  projectId: string;
  roots: string[];
  scannedAt: string;
}
