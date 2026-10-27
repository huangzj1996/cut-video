import type { EditorTrackKind } from './timeline-geometry';

/**
 * 选中与播放头分离：播放头移动不进入这里，选中也不会自动 seek。
 * 视频/配音/字幕片段派生所属分镜；音乐片段不关联分镜，保留上一次分镜上下文。
 */
export interface EditorSelection {
  clip: { id: string; kind: EditorTrackKind } | null;
  sceneId: string | null;
}

export type SelectionAction =
  | { clipId: string; kind: EditorTrackKind; sceneId?: string; type: 'select-clip' }
  | { sceneId: string; type: 'select-scene' }
  | { type: 'playhead-moved' };

export function createSelection(sceneId: string | null): EditorSelection {
  return { clip: null, sceneId };
}

export function selectionReducer(state: EditorSelection, action: SelectionAction): EditorSelection {
  switch (action.type) {
    case 'select-scene':
      return { clip: null, sceneId: action.sceneId };
    case 'select-clip':
      return {
        clip: { id: action.clipId, kind: action.kind },
        sceneId: action.kind === 'music' ? state.sceneId : (action.sceneId ?? state.sceneId),
      };
    case 'playhead-moved':
      return state;
  }
}
