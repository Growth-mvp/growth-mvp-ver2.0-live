// /utils/stage1/importers/cache.ts
/**
 * ファイルインポートのキャッシュ管理
 * - sha256(file bytes) + file size でキャッシュキーを生成
 * - 初期はローカルファイルシステム（/tmp または .cache）
 * - 将来 Supabase Storage に差し替え可能な設計
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// キャッシュディレクトリ（Windows対応）
const CACHE_DIR = process.env.STAGE1_CACHE_DIR || path.join(process.cwd(), '.cache', 'stage1-import');

// キャッシュ有効期限（15分）
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * ファイルからキャッシュキーを生成
 */
export function generateCacheKey(buffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const size = buffer.length;
  return `${hash}_${size}`;
}

/**
 * キャッシュディレクトリを確保
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * キャッシュファイルのパスを取得
 */
function getCacheFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

/**
 * キャッシュからデータを取得
 * @returns キャッシュされたデータ、または null（キャッシュミス/期限切れ）
 */
export function getFromCache<T>(cacheKey: string): T | null {
  try {
    ensureCacheDir();
    const filePath = getCacheFilePath(cacheKey);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stat = fs.statSync(filePath);
    const age = Date.now() - stat.mtimeMs;

    // 有効期限チェック
    if (age > CACHE_TTL_MS) {
      // 期限切れなので削除
      fs.unlinkSync(filePath);
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (e) {
    console.warn('[cache] getFromCache error:', e);
    return null;
  }
}

/**
 * キャッシュにデータを保存
 */
export function saveToCache<T>(cacheKey: string, data: T): void {
  try {
    ensureCacheDir();
    const filePath = getCacheFilePath(cacheKey);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch (e) {
    console.warn('[cache] saveToCache error:', e);
  }
}

/**
 * キャッシュを削除
 */
export function clearCache(cacheKey: string): void {
  try {
    const filePath = getCacheFilePath(cacheKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn('[cache] clearCache error:', e);
  }
}

/**
 * 古いキャッシュを一括削除（クリーンアップ）
 */
export function cleanupExpiredCache(): void {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(CACHE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > CACHE_TTL_MS) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ファイル単位のエラーは無視
      }
    }
  } catch (e) {
    console.warn('[cache] cleanupExpiredCache error:', e);
  }
}
