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
