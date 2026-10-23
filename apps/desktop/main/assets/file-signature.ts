import { open } from 'node:fs/promises';
import type { AssetContainer, AssetKind } from './extension-registry';

export interface MagicDetection {
  brand?: string;
  container: AssetContainer;
  kind: AssetKind;
}

export type MagicReadStatus = 'empty' | 'ok' | 'too-short' | 'unreadable';

export interface MagicReadResult {
  bytesRead: number;
  detection: MagicDetection | null;
  errorCode?: string;
  status: MagicReadStatus;
}

const MAGIC_READ_BYTES = 64;
const MIN_SIGNATURE_BYTES = 12;
const LOCK_RETRY_DELAY_MS = 300;
const LOCK_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const FTYP_IMAGE_BRANDS = new Set(['avif', 'heic', 'heix', 'mif1', 'msf1']);
const FTYP_AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ']);

function isMpegAudioFrame(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff) {
    return false;
  }

  const second = buffer[1]!;

  if ((second & 0xe0) !== 0xe0) {
    return false;
  }

  const version = (second >> 3) & 0x03;
  if (version === 1) {
    // reserved
    return false;
  }

  const layer = (second >> 1) & 0x03;
  if (layer === 0) {
    // reserved
    return false;
  }

  const third = buffer[2]!;
  const bitrateIndex = (third >> 4) & 0x0f;
  if (bitrateIndex === 0 || bitrateIndex === 15) {
    return false;
  }

  const sampleRateIndex = (third >> 2) & 0x03;
  return sampleRateIndex !== 3;
}

/**
 * 根据文件头识别格式。只做预检，最终仍以 ffprobe 为准。
 */
export function detectMagic(buffer: Buffer): MagicDetection | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { container: 'jpeg', kind: 'image' };
  }

  if (
    buffer.length >= PNG_SIGNATURE.length &&
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return { container: 'png', kind: 'image' };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return { container: 'wav', kind: 'audio' };
  }

  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return { container: 'mp3', kind: 'audio' };
  }

  if (isMpegAudioFrame(buffer)) {
    return { container: 'mp3', kind: 'audio' };
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);

    if (FTYP_IMAGE_BRANDS.has(brand)) {
      return { brand, container: 'heic', kind: 'image' };
    }

    if (FTYP_AUDIO_BRANDS.has(brand)) {
      return { brand, container: 'm4a', kind: 'audio' };
    }

    return {
      brand,
      container: brand === 'qt  ' ? 'mov' : 'mp4',
      kind: 'video',
    };
  }

  return null;
}

function isLockError(code: string | undefined): boolean {
  return code !== undefined && LOCK_ERROR_CODES.has(code);
}

/**
 * 只读取文件头（最多 64 字节），不把整个文件读入内存。
 * 被占用/权限问题会重试一次，给杀毒软件或索引器短暂释放的机会。
 */
export async function readMagic(filePath: string, fileSize: number): Promise<MagicReadResult> {
  if (fileSize === 0) {
    return { bytesRead: 0, detection: null, status: 'empty' };
  }

  if (fileSize < MIN_SIGNATURE_BYTES) {
    return { bytesRead: 0, detection: null, status: 'too-short' };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(filePath, 'r');
      const length = Math.min(MAGIC_READ_BYTES, fileSize);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);

      if (bytesRead === 0) {
        return { bytesRead, detection: null, status: 'empty' };
      }

      if (bytesRead < MIN_SIGNATURE_BYTES) {
        return { bytesRead, detection: null, status: 'too-short' };
      }

      return {
        bytesRead,
        detection: detectMagic(buffer.subarray(0, bytesRead)),
        status: 'ok',
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (attempt === 0 && isLockError(code)) {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        continue;
      }

      return {
        bytesRead: 0,
        detection: null,
        errorCode: code,
        status: 'unreadable',
      };
    } finally {
      await handle?.close().catch(() => {
        // 关闭失败不影响读取结果。
      });
    }
  }

  return { bytesRead: 0, detection: null, status: 'unreadable' };
}
