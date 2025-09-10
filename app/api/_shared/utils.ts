// /app/api/_shared/utils.ts
export function toTextStory(story: unknown): string {
  try {
    if (Array.isArray(story)) {
      const parts = (story as any[])
        .map((c: any, i: number) => {
          const title =
            typeof c?.title === 'string' ? c.title.trim() :
            c?.title != null ? String(c.title) : '';
          const body =
            typeof c?.body === 'string' ? c.body :
            c?.body != null ? String(c.body) : '';
          if (!title && !body) return null; // 両方空は除外
          return `【第${i + 1}章】${title}\n${body}`;
        })
        .filter(Boolean) as string[];
      return parts.join('\n\n');
    }
  } catch {}
  return typeof story === 'string' ? story : '';
}

/**
 * 文字列から安全に JSON オブジェクトを抽出してパースする。
 * - まずは直パース
 * - ```json ... ``` のコードフェンス
 * - 最初に現れる「波括弧のバランスが取れた」ブロック
 * - 最後のフォールバックとして “最短一致” の { ... } を試す
 */
export function extractJsonObject<T = any>(raw: string): T | null {
  if (!raw) return null;

  // 1) そのまま JSON として
  try {
    return JSON.parse(raw) as T;
  } catch {}

  // 2) ```json ... ``` のフェンス
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1]) as T; } catch {}
  }

  // 3) 最初に出現する「バランスの取れた」オブジェクトをスキャン
  const firstBrace = raw.indexOf('{');
  for (let i = firstBrace; i >= 0 && i < raw.length; i = raw.indexOf('{', i + 1)) {
    let depth = 0;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (let j = i; j < raw.length; j++) {
      const ch = raw[j];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { depth++; continue; }
      if (ch === '}') {
        depth--;
        if (depth === 0) { end = j + 1; break; }
      }
    }
    if (end !== -1) {
      const cand = raw.slice(i, end);
      try { return JSON.parse(cand) as T; } catch {}
    }
  }

  // 4) フォールバック：最短一致の { ... }（複数ある場合の取りこぼし対策）
  const m = raw.match(/\{[\s\S]*?\}/);
  if (m) {
    try { return JSON.parse(m[0]) as T; } catch {}
  }

  return null;
}

export function sanitizeText(s?: string, max = 4000) {
  const t = String(s ?? '').replace(/\u0000/g, ''); // ヌル文字を除去
  return t.length > max ? t.slice(0, max) : t;
}
