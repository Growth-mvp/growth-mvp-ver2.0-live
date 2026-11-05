import { toPublicSourceUrl, type CeoFact } from './search';

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]）】」。、，]+/g;
const TRAILING_PUNCTUATION = /[。、，,.;:!?]+$/;
const UNVERIFIED_MARK = '（未確認のURLを除外）';

/** 回答本文に含まれるURLの件数（診断用。URL自体は返さない） */
export function countUrls(content: string): number {
  return [...content.matchAll(URL_PATTERN)].length;
}

/** 検索結果の出典URL（正規化済み）の許可リスト */
export function allowedSourceUrls(facts: CeoFact[]): string[] {
  const urls = new Set<string>();
  for (const f of facts) {
    for (const s of f.sources) {
      const normalized = toPublicSourceUrl(s.url, '');
      if (normalized) urls.add(normalized);
    }
  }
  return [...urls];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 回答本文のURLを許可リストと照合する。
 * - 許可リストにあるURLは正規化した形に置き換える。
 * - 自社サイト（環境変数の公開URLのホスト）へのリンクは削除しない。
 * - それ以外で許可リストにないURLは、出典として表示しないよう除外する。
 */
export function verifyAnswerUrls(
  content: string,
  allowed: readonly string[],
  internalBaseUrls: readonly string[] = []
): { content: string; removed: number } {
  const allowSet = new Set(allowed);
  const internalHosts = new Set(
    internalBaseUrls.map((u) => hostOf(u)).filter((h): h is string => !!h)
  );
  let removed = 0;

  const checked = content.replace(URL_PATTERN, (raw) => {
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const core = trailing ? raw.slice(0, -trailing.length) : raw;
    const host = hostOf(core);
    if (host && internalHosts.has(host)) return raw;

    const normalized = toPublicSourceUrl(core, '');
    if (normalized && allowSet.has(normalized)) return normalized + trailing;

    removed += 1;
    return UNVERIFIED_MARK + trailing;
  });

  return { content: checked, removed };
}
