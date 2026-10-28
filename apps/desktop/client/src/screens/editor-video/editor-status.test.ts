import { describe, expect, it } from 'vitest';
import { describeReadonlyBanner, describeSaveStatus } from './editor-status';

describe('describeSaveStatus', () => {
  it('shows the conflict state ahead of any other status', () => {
    expect(describeSaveStatus('conflict', true)).toEqual({ kind: 'conflict', label: '保存冲突' });
    expect(describeSaveStatus('conflict', false)).toEqual({ kind: 'conflict', label: '保存冲突' });
  });

  it('distinguishes saving, failed and pending states', () => {
    expect(describeSaveStatus('saving', true)).toEqual({ kind: 'saving', label: '保存中' });
    expect(describeSaveStatus('error', true)).toEqual({ kind: 'error', label: '保存失败' });
    expect(describeSaveStatus('idle', true)).toEqual({ kind: 'dirty', label: '待保存' });
  });

  it('reports a clean document as saved', () => {
    expect(describeSaveStatus('idle', false)).toEqual({ kind: 'saved', label: '已保存' });
    expect(describeSaveStatus('saved', false)).toEqual({ kind: 'saved', label: '已保存' });
  });

  it('keeps the pending state when a save finished but newer edits landed', () => {
    expect(describeSaveStatus('saved', true)).toEqual({ kind: 'dirty', label: '待保存' });
  });
});

describe('describeReadonlyBanner', () => {
  it('explains why the editor is locked while the workflow runs', () => {
    expect(describeReadonlyBanner('running')).toContain('AI 工作流正在运行');
  });

  it('explains the waiting-for-approval lock separately', () => {
    expect(describeReadonlyBanner('waiting_user')).toContain('等待审批');
  });

  it('returns no banner for editable workflow states', () => {
    expect(describeReadonlyBanner(null)).toBeNull();
    expect(describeReadonlyBanner('pending')).toBeNull();
    expect(describeReadonlyBanner('succeeded')).toBeNull();
    expect(describeReadonlyBanner('failed')).toBeNull();
    expect(describeReadonlyBanner('cancelled')).toBeNull();
    expect(describeReadonlyBanner('interrupted')).toBeNull();
  });
});
