import { CANDIDATE_LIMITS, composeSwotSuggestions } from './candidatePool';
import type { OpportunityGroup } from './opportunityGroups';
import { isNearDuplicate } from './textSimilarity';

/** 機会の上限。保存側（candidatePool）と同じ値を使う */
export const MAX_OPPORTUNITIES = CANDIDATE_LIMITS.opportunity;
/** 候補の重複とみなす類似度。短い文の一語違い（地域と用途など）は別の候補として残す */
export const DUPLICATE_THRESHOLD = 0.85;

/** 候補として加える1件（サーバーの分析結果と同じ形） */
export type OpportunityItem = {
  text: string;
  group?: OpportunityGroup;
  basis: 'fact' | 'hypothesis';
  evidence: string;
  sourceIndex: number | null;
  need?: unknown;
  discoveryPath?: 'market';
  /** 追加探索で得た候補か（出典を理由に確認済みとしないため） */
  origin?: 'initial' | 'extension';
};

/**
 * 既存の候補を保ったまま、新しい候補を加える。
 * - 既存の候補は、順番・内容・件数を変えない（消さない）
 * - 既存と同じ、またはほぼ同じ文は重複として捨てる
 * - 上限（30件）を超える分は捨て、件数を数える
 * - 評価や根拠の強さで候補を削除しない（この関数は重複と上限だけを見る）
 */
export function mergeOpportunities<T extends OpportunityItem>(
  existing: readonly T[],
  incoming: readonly T[]
): { items: T[]; added: number; duplicates: number; capped: number } {
  const items: T[] = [...existing];
  let added = 0;
  let duplicates = 0;
  let capped = 0;
  for (const item of incoming) {
    const text = item.text.trim();
    if (!text) continue;
    if (items.some((prev) => prev.text.trim() === text || isNearDuplicate(prev.text, text, DUPLICATE_THRESHOLD))) {
      duplicates += 1;
      continue;
    }
    if (items.length >= MAX_OPPORTUNITIES) {
      capped += 1;
      continue;
    }
    items.push({ ...item, text, group: item.group ?? 'existing_market' });
    added += 1;
  }
  return { items, added, duplicates, capped };
}

type SuggestionsShape = {
  opportunity?: string[];
  threat?: string[];
  generatedAt?: string;
  sources?: unknown[];
  insights?: { opportunity?: unknown[]; threat?: unknown[] };
  [key: string]: unknown;
};

/**
 * 追加探索の結果を、既存の候補（AI提案）に加える。
 * 既存の候補と選択の記録はそのまま残し、重複と上限だけを見る。確定 SWOT には触れない。
 */
export function appendOpportunitySuggestions(prev: SuggestionsShape, items: readonly OpportunityItem[]): SuggestionsShape {
  const texts = [...(prev.opportunity ?? [])];
  const insights = [...(prev.insights?.opportunity ?? [])];
  let added = 0;
  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;
    if (texts.some((t) => t === text || isNearDuplicate(t, text, DUPLICATE_THRESHOLD))) continue;
    if (texts.length >= MAX_OPPORTUNITIES) break;
    texts.push(text);
    insights.push({ ...item, text, group: item.group ?? 'existing_market' });
    added += 1;
  }
  if (added === 0) return prev;
  const next: SuggestionsShape = {
    ...prev,
    opportunity: texts,
    insights: { ...(prev.insights ?? {}), opportunity: insights, threat: prev.insights?.threat ?? [] },
  };
  return composeSwotSuggestions(prev as never, next as never) as SuggestionsShape;
}
