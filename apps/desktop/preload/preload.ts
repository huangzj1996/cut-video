import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcParams,
  type IpcResponse,
  type IpcResult,
  type MiaomaApi,
} from '../shared/ipc-contract';

function invoke<C extends IpcChannel>(
  channel: C,
  ...params: IpcParams<C>
): Promise<IpcResponse<IpcResult<C>>> {
  return ipcRenderer.invoke(channel, ...params) as Promise<IpcResponse<IpcResult<C>>>;
}

function subscribe<C extends IpcEventChannel>(
  channel: C,
  listener: (payload: IpcEventContract[C]) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, payload: IpcEventContract[C]): void => {
    listener(payload);
  };

  ipcRenderer.on(channel, handler);

  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: MiaomaApi = {
  ping: () => invoke(IPC_CHANNELS.app.ping),
  getAppInfo: () => invoke(IPC_CHANNELS.app.getInfo),
  getSettings: () => invoke(IPC_CHANNELS.settings.get),
  getMediaInfo: () => invoke(IPC_CHANNELS.media.getInfo),
  project: {
    create: (input) => invoke(IPC_CHANNELS.project.create, input),
    delete: (projectId) => invoke(IPC_CHANNELS.project.delete, projectId),
    get: (projectId) => invoke(IPC_CHANNELS.project.get, projectId),
    list: () => invoke(IPC_CHANNELS.project.list),
    selectAssets: (projectId) => invoke(IPC_CHANNELS.project.selectAssets, projectId),
    update: (input) => invoke(IPC_CHANNELS.project.update, input),
  },
  llm: {
    chat: (messages) => invoke(IPC_CHANNELS.llm.chat, messages),
  },
  chat: {
    list: (projectId) => invoke(IPC_CHANNELS.chat.list, projectId),
    start: (projectId) => invoke(IPC_CHANNELS.chat.start, projectId),
    send: (input) => invoke(IPC_CHANNELS.chat.send, input),
    retry: (projectId) => invoke(IPC_CHANNELS.chat.retry, projectId),
    onMessage: (listener) => subscribe(IPC_EVENT_CHANNELS.chatMessage, listener),
    onStream: (listener) => subscribe(IPC_EVENT_CHANNELS.chatStream, listener),
  },
  workflow: {
    getState: (projectId) => invoke(IPC_CHANNELS.workflow.getState, projectId),
    resume: (input) => invoke(IPC_CHANNELS.workflow.resume, input),
    cancel: (input) => invoke(IPC_CHANNELS.workflow.cancel, input),
    getArtifact: (input) => invoke(IPC_CHANNELS.workflow.getArtifact, input),
    onEvent: (listener) => subscribe(IPC_EVENT_CHANNELS.workflowEvent, listener),
  },
};

contextBridge.exposeInMainWorld('miaoma', api);
