import path from 'node:path';

export type AssetKind = 'audio' | 'image' | 'video';

/**
 * 文件签名识别出的容器。除首批支持的格式外，也保留 m4a/heic 用于诊断
 * 「扩展名与内容不一致」，但它们不在扩展名白名单中。
 */
export type AssetContainer = 'heic' | 'jpeg' | 'm4a' | 'mov' | 'mp4' | 'mp3' | 'png' | 'wav';

export interface ExtensionInfo {
  containers: readonly AssetContainer[];
  kind: AssetKind;
  mime: string;
}

const REGISTRY: Readonly<Record<string, ExtensionInfo>> = {
  jpeg: {
    containers: ['jpeg'],
    kind: 'image',
    mime: 'image/jpeg',
  },
  jpg: {
    containers: ['jpeg'],
    kind: 'image',
    mime: 'image/jpeg',
  },
  mov: {
    // QuickTime 与 ISO BMFF 经常互相错标，同一视频类目内都接受。
    containers: ['mov', 'mp4'],
    kind: 'video',
    mime: 'video/quicktime',
  },
  mp3: {
    containers: ['mp3'],
    kind: 'audio',
    mime: 'audio/mpeg',
  },
  mp4: {
    containers: ['mov', 'mp4'],
    kind: 'video',
    mime: 'video/mp4',
  },
  png: {
    containers: ['png'],
    kind: 'image',
    mime: 'image/png',
  },
  wav: {
    containers: ['wav'],
    kind: 'audio',
    mime: 'audio/wav',
  },
};

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze(Object.keys(REGISTRY));

/**
 * 取小写、不带点的扩展名；无扩展名时返回空字符串。
 */
export function getFileExtension(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

export function getExtensionInfo(extension: string): ExtensionInfo | undefined {
  return REGISTRY[extension.toLowerCase()];
}
