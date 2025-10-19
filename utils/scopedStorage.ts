// /utils/scopedStorage.ts

/**
 * 会社スコープ付き Storage ユーティリティ
 * すべてのキーは `growth::<companyId>::<name>` で管理します。
 */

/** スコープキー生成 */
export const scopedKey = (companyId: string | null, name: string) =>
  `growth::${companyId ?? 'none'}::${name}`;

/** 現在の companyId 以外のキーを削除（sessionStorage / localStorage 両方） */
export function clearCompanyScopedStorage(activeCompanyId: string | null) {
  if (typeof window === 'undefined') return;

  const prefix = 'growth::';

  // sessionStorage
  for (const k of Object.keys(window.sessionStorage)) {
    if (!k.startsWith(prefix)) continue;
    if (activeCompanyId && k.includes(`::${activeCompanyId}::`)) continue;
    window.sessionStorage.removeItem(k);
  }

  // localStorage
  for (const k of Object.keys(window.localStorage)) {
    if (!k.startsWith(prefix)) continue;
    if (activeCompanyId && k.includes(`::${activeCompanyId}::`)) continue;
    window.localStorage.removeItem(k);
  }
}
