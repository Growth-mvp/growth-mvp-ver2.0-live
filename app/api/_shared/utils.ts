// /app/api/_shared/utils.ts
import { openai } from '@/lib/openai';

/**
 * Call OpenAI API with JSON response format and automatic retry on network errors
 * Retries up to 2 times with exponential backoff on socket/network errors
 */
export async function callOpenAIJsonWithRetry(
  prompt: string,
  systemMessage: string,
  retryKey?: string,
  temperature?: number,
  maxTokens?: number
): Promise<string> {
  const MAX_RETRIES = 2; // 2回リトライ = 最大3回試行
  const BACKOFFS = [300, 600]; // ms
  const temp = temperature ?? 0.2;
  const tokens = maxTokens ?? 1000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: temp,
        max_tokens: tokens,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt },
        ],
      });

      return completion.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        errMsg.includes('fetch failed') ||
        errMsg.includes('UND_ERR_SOCKET') ||
        errMsg.includes('SocketError') ||
        errMsg.includes('socket');

      if (isNetworkError && attempt < MAX_RETRIES) {
        const backoffMs = BACKOFFS[attempt];
        console.warn(
          `[cascade][openai][retry] ${retryKey ?? 'call'} attempt=${attempt + 1} backoff=${backoffMs}ms error="${errMsg.slice(0, 80)}"`
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // リトライ不可またはリトライ回数超過
      throw err;
    }
  }

  throw new Error('callOpenAIJsonWithRetry: max retries exceeded');
}

export function toTextStory(story: unknown): string {
  try {
    // ★TASK 3: 複数の形式に対応

    // 1) string 形式
    if (typeof story === 'string') {
      return story;
    }

    // 2) Array 形式（ChapterStory[] または StoryChapter[]）
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
      const result = parts.join('\n\n');
      return result.length > 0 ? result : '';
    }

    // 3) object形式で .text プロパティ
    if (story && typeof story === 'object' && 'text' in story) {
      const txt = (story as any).text;
      if (typeof txt === 'string') return txt;
    }

    // 4) object形式で .chapters プロパティ
    if (story && typeof story === 'object' && 'chapters' in story) {
      const chapters = (story as any).chapters;
      if (Array.isArray(chapters)) {
        const parts = chapters
          .map((c: any, i: number) => {
            const title = typeof c?.title === 'string' ? c.title.trim() : (c?.title ? String(c.title) : '');
            const body = typeof c?.body === 'string' ? c.body : (c?.body ? String(c.body) : '');
            if (!title && !body) return null;
            return `【第${i + 1}章】${title}\n${body}`;
          })
          .filter(Boolean) as string[];
        const result = parts.join('\n\n');
        return result.length > 0 ? result : '';
      }
    }

    // 5) ネストされた .finalStory や .final_story プロパティ
    if (story && typeof story === 'object') {
      const nested = (story as any).finalStory ?? (story as any).final_story ?? (story as any).storyDraft;
      if (nested) {
        return toTextStory(nested); // 再帰的に処理
      }
    }

  } catch (e) {
    console.warn('[toTextStory] unexpected error:', e);
  }

  return '';
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
