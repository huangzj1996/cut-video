import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type IpcChannel,
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

const api: MiaomaApi = {
  ping: () => invoke(IPC_CHANNELS.app.ping),
  getAppInfo: () => invoke(IPC_CHANNELS.app.getInfo),
  getSettings: () => invoke(IPC_CHANNELS.settings.get),
  getMediaInfo: () => invoke(IPC_CHANNELS.media.getInfo),
};

contextBridge.exposeInMainWorld('miaoma', api);
