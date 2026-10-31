import { existsSync as fsExistsSync } from 'node:fs';
import path from 'node:path';

/** ASS 的 Fontname 与预览 CSS 的 font-family 都使用随包字族名。 */
export const EXPORT_FONT_FAMILY = 'Noto Sans SC';

/** 随包的单字重字体文件；需求只要求 Regular。 */
export const EXPORT_FONT_FILE_NAME = 'NotoSansSC-Regular.otf';

/** 导出可直接使用的随包字体：目录 + 字体文件绝对路径。 */
export interface ExportFonts {
  directory: string;
  files: string[];
}

export interface ResolveExportFontsOptions {
  appPath: string;
  existsSync?: (candidate: string) => boolean;
  isPackaged: boolean;
  resourcesPath: string;
}

/**
 * 解析随包字体路径，与 FFmpeg 二进制保持同一套开发态/打包态约定：
 * - 打包态：`<resources>/fonts`（forge extraResource）；
 * - 开发态：`<appPath>/resources/fonts`。
 *
 * 字体缺失返回 null，由前置校验报 EXPORT_FONT_MISSING 并阻止导出。
 */
export function resolveExportFonts(options: ResolveExportFontsOptions): ExportFonts | null {
  const existsSync = options.existsSync ?? fsExistsSync;
  const directory = options.isPackaged
    ? path.join(options.resourcesPath, 'fonts')
    : path.join(options.appPath, 'resources', 'fonts');
  const fontPath = path.join(directory, EXPORT_FONT_FILE_NAME);

  return existsSync(fontPath) ? { directory, files: [fontPath] } : null;
}
