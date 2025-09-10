// /utils/supabase/client.ts
import { supabase } from '@/lib/supabaseClient';

export { supabase };

/** UUID v1–v5 を許容 */
export function isValidUUID(v?: string | null): v is string {
  return (
    !!v &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

/** SSR安全：ブラウザ環境でのみ Cookie を読む */
export function getCompanyIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)company_id=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * company_id Cookie を設定
 * - Path=/, SameSite=Lax はデフォルト
 * - https 環境では Secure を自動付与
 * - 有効期限は 30 日（必要なら変更可）
 */
export function setCompanyIdCookie(companyId: string) {
  if (typeof document === 'undefined') return;
  try {
    const maxAgeDays = 30;
    const maxAge = 60 * 60 * 24 * maxAgeDays; // 30日
    const isHttps =
      typeof location !== 'undefined' &&
      typeof location.protocol === 'string' &&
      location.protocol === 'https:';

    // Cookie 属性を動的に組み立て
    const attrs = [
      `Path=/`,
      `SameSite=Lax`,
      `Max-Age=${maxAge}`,
      isHttps ? `Secure` : ``,
    ]
      .filter(Boolean)
      .join('; ');

    document.cookie = `company_id=${encodeURIComponent(companyId)}; ${attrs}`;
  } catch (e) {
    // Cookie ブロックやサードパーティ制限などの環境でも落ちない
    console.warn('setCompanyIdCookie failed:', e);
  }
}

/** 明示的に company_id Cookie を消す（必要に応じて使用） */
export function clearCompanyIdCookie() {
  if (typeof document === 'undefined') return;
  try {
    const isHttps =
      typeof location !== 'undefined' &&
      typeof location.protocol === 'string' &&
      location.protocol === 'https:';
    const attrs = [`Path=/`, `SameSite=Lax`, isHttps ? `Secure` : ``]
      .filter(Boolean)
      .join('; ');
    // 期限切れにして削除
    document.cookie = `company_id=; Max-Age=0; ${attrs}`;
  } catch (e) {
    console.warn('clearCompanyIdCookie failed:', e);
  }
}
