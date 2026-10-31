export type SuggestionSource = {
  index: number;
  url: string;
  title: string;
  retrievedAt: string;
};

/**
 * 候補の根拠の区分。本文を確認した出典はまだ無いため、出典は「本文未確認」として扱い、確認済みとは表示しない。
 * - source: 事実として書かれ、実在する出典に紐づく（本文未確認）
 * - input: 入力情報（強み・弱みなど）に基づく
 * - hypothesis_source: 仮説で、実在する出典に紐づく（本文未確認）
 * - hypothesis_rationale: 仮説で、出典は無いが根拠の記載がある
 * - hypothesis: 出典も根拠の記載も無く、追加調査が必要
 */
export type SuggestionBasis =
  | { kind: 'source'; index: number }
  | { kind: 'input' }
  | { kind: 'hypothesis' }
  | { kind: 'hypothesis_rationale' }
  | { kind: 'hypothesis_source'; index: number };

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 保存データは信頼しない。https の URL と整数の index を持つものだけを表示対象にする */
export function toSafeSources(raw: unknown): SuggestionSource[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestionSource[] = [];
  for (const item of raw) {
    const s = asRecord(item);
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (typeof s.index !== 'number' || !Number.isInteger(s.index) || s.index < 1) continue;
    if (!isHttpsUrl(url)) continue;
    const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 200) : url;
    const retrievedAt = typeof s.retrievedAt === 'string' ? s.retrievedAt : '';
    out.push({ index: s.index, url, title, retrievedAt });
  }
  return out;
}

/**
 * 候補ごとの根拠表示。出典を裏付けにできるのは、fact かつ実在する出典 index のときだけ。
 * 出典が指す先が無い fact は AI 推論として扱い、事実として表示しない。
 */
export function basisOf(insight: unknown, sources: SuggestionSource[]): SuggestionBasis | null {
  if (!insight || typeof insight !== 'object') return null;
  const i = asRecord(insight);
  const hasEvidence = typeof i.evidence === 'string' && i.evidence.trim() !== '';
  if (i.basis !== 'fact') {
    const idx = i.sourceIndex;
    if (typeof idx === 'number' && sources.some((s) => s.index === idx)) return { kind: 'hypothesis_source', index: idx };
    return hasEvidence ? { kind: 'hypothesis_rationale' } : { kind: 'hypothesis' };
  }
  const sourceIndex = i.sourceIndex;
  if (typeof sourceIndex === 'number') {
    return sources.some((s) => s.index === sourceIndex)
      ? { kind: 'source', index: sourceIndex }
      : { kind: 'hypothesis' };
  }
  return hasEvidence ? { kind: 'input' } : { kind: 'hypothesis' };
}
