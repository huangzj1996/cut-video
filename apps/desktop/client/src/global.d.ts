import type { MiaomaApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    miaoma: MiaomaApi;
  }
}

export {};
