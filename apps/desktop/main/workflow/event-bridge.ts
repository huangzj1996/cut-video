import { BrowserWindow } from 'electron';
import type { ChatMessage, ChatStreamEvent, RunEvent } from '@miaoma/video-project';
import {
  IPC_EVENT_CHANNELS,
  type ExportProgress,
  type ExportState,
} from '../../shared/ipc-contract';

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

export function broadcastWorkflowEvent(event: RunEvent): void {
  broadcast(IPC_EVENT_CHANNELS.workflowEvent, event);
}

export function broadcastChatMessage(message: ChatMessage): void {
  broadcast(IPC_EVENT_CHANNELS.chatMessage, message);
}

export function broadcastChatStream(event: ChatStreamEvent): void {
  broadcast(IPC_EVENT_CHANNELS.chatStream, event);
}

export function broadcastExportState(state: ExportState): void {
  broadcast(IPC_EVENT_CHANNELS.exportState, state);
}

export function broadcastExportProgress(progress: ExportProgress): void {
  broadcast(IPC_EVENT_CHANNELS.exportProgress, progress);
}
