import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupStaleExportWorkspaces,
  createExportTempWorkspace,
  EXPORT_WORKSPACE_MANIFEST_NAME,
  resolveExportWorkspaceRoot,
  type ExportTempArtifacts,
} from './temp-workspace';

let root: string;
let workspaceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'miaoma-export-temp-'));
  workspaceRoot = resolveExportWorkspaceRoot(root);
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function writeArtifacts(): ExportTempArtifacts {
  const target = path.join(root, '导出');
  mkdirSync(target, { recursive: true });
  const artifacts: ExportTempArtifacts = {
    partialPath: path.join(target, '成片.mp4.partial'),
    premixPath: path.join(target, '成片.mp4.partial.wav'),
    assPath: path.join(target, '.miaoma-export-run.ass'),
    fontsDirPath: path.join(target, '.miaoma-export-run-fonts'),
  };

  writeFileSync(artifacts.partialPath, 'partial');
  writeFileSync(artifacts.premixPath, 'premix');
  writeFileSync(artifacts.assPath as string, 'ass');
  mkdirSync(artifacts.fontsDirPath as string);
  writeFileSync(path.join(artifacts.fontsDirPath as string, 'font.otf'), 'font');

  return artifacts;
}

function createWorkspace(artifacts: ExportTempArtifacts, token = 'run-1') {
  return createExportTempWorkspace({
    artifacts,
    createdAt: Date.now(),
    root: workspaceRoot,
    token,
  });
}

describe('export temp workspace', () => {
  it('registers the artifacts and removes them together with the workspace on dispose', () => {
    const artifacts = writeArtifacts();
    const workspace = createWorkspace(artifacts);

    expect(existsSync(workspace.directory)).toBe(true);
    expect(
      JSON.parse(
        readFileSync(path.join(workspace.directory, EXPORT_WORKSPACE_MANIFEST_NAME), 'utf8'),
      ),
    ).toMatchObject({ pid: process.pid });

    workspace.dispose();
    workspace.dispose();

    expect(existsSync(workspace.directory)).toBe(false);
    expect(existsSync(artifacts.partialPath)).toBe(false);
    expect(existsSync(artifacts.premixPath)).toBe(false);
    expect(existsSync(artifacts.assPath as string)).toBe(false);
    expect(existsSync(artifacts.fontsDirPath as string)).toBe(false);
  });

  it('recovers a stale workspace whose owner process is gone', () => {
    const artifacts = writeArtifacts();
    const workspace = createWorkspace(artifacts);

    const removed = cleanupStaleExportWorkspaces({
      isProcessAlive: () => false,
      now: Date.now(),
      root: workspaceRoot,
    });

    expect(removed).toBe(1);
    expect(existsSync(workspace.directory)).toBe(false);
    expect(existsSync(artifacts.partialPath)).toBe(false);
    expect(existsSync(artifacts.assPath as string)).toBe(false);
    expect(existsSync(artifacts.fontsDirPath as string)).toBe(false);
  });

  it('keeps a fresh workspace whose owner is still running', () => {
    const artifacts = writeArtifacts();
    const workspace = createWorkspace(artifacts);

    const removed = cleanupStaleExportWorkspaces({
      isProcessAlive: () => true,
      now: Date.now(),
      root: workspaceRoot,
    });

    expect(removed).toBe(0);
    expect(existsSync(workspace.directory)).toBe(true);
    expect(existsSync(artifacts.partialPath)).toBe(true);
  });

  it('reclaims an aged workspace even when the pid was reused by another process', () => {
    const artifacts = writeArtifacts();
    const workspace = createWorkspace(artifacts);

    const removed = cleanupStaleExportWorkspaces({
      isProcessAlive: () => true,
      maxAgeMs: 60_000,
      now: Date.now() + 120_000,
      root: workspaceRoot,
    });

    expect(removed).toBe(1);
    expect(existsSync(workspace.directory)).toBe(false);
  });

  it('only removes a malformed workspace directory once it is old enough', () => {
    const young = path.join(workspaceRoot, 'young');
    const old = path.join(workspaceRoot, 'old');
    mkdirSync(young);
    mkdirSync(old);
    writeFileSync(path.join(young, EXPORT_WORKSPACE_MANIFEST_NAME), 'not-json');
    writeFileSync(path.join(old, EXPORT_WORKSPACE_MANIFEST_NAME), 'not-json');

    const removed = cleanupStaleExportWorkspaces({
      isProcessAlive: () => false,
      maxAgeMs: 0,
      now: Date.now() + 1_000,
      root: workspaceRoot,
    });

    expect(removed).toBe(2);
    expect(readdirSync(workspaceRoot)).toEqual([]);
  });

  it('is a no-op when the workspace root does not exist', () => {
    rmSync(workspaceRoot, { force: true, recursive: true });

    expect(
      cleanupStaleExportWorkspaces({
        isProcessAlive: () => false,
        now: Date.now(),
        root: workspaceRoot,
      }),
    ).toBe(0);
  });
});
