import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 解析 CLI 套件本身的根目錄（不論是 git+url 安裝或本地 dev） */
export function getPackageRoot(): string {
  // dist/utils/paths.js → ../../
  return path.resolve(__dirname, '..', '..');
}

export function getAssetsDir(): string {
  return path.join(getPackageRoot(), 'assets');
}
