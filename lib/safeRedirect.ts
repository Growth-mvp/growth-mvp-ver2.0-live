/**
 * ログイン後の遷移先として安全な「アプリ内パス」だけを返す。
 * `//host` や `/\host` は別オリジンへ飛ぶため拒否する。
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeInternalPath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (hasControlChar(value)) return null;
  return value;
}

/** ログイン後の戻り先。`redirect_to` を優先し、無ければ `next` を使う（どちらも安全判定を通す） */
export function postLoginDestination(search: { get(name: string): string | null } | null | undefined): string | null {
  return safeInternalPath(search?.get('redirect_to')) ?? safeInternalPath(search?.get('next')) ?? null;
}

/** 認証リンクのハッシュ（#error=…）から、エラーの種類を読む。エラーが無ければ null */
export function authErrorFromHash(hash: string): { code: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('error');
  if (!error) return null;
  return { code: params.get('error_code') || error };
}
