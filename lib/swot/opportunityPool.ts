import { z } from 'zod';
import { MAX_OPPORTUNITIES } from './opportunityAppend';
import { GROUP_DEFINITION_JA, OPPORTUNITY_GROUPS, isOpportunityGroup, type OpportunityGroup } from './opportunityGroups';
import { OPPORTUNITY_ITEM_SCHEMA, type OtItem } from './generateOt';

export { MAX_OPPORTUNITIES, appendOpportunitySuggestions, mergeOpportunities, DUPLICATE_THRESHOLD } from './opportunityAppend';

/** 1回の追加探索で増やす最大件数（一度に30件を生成しない） */
export const EXPANSION_BATCH_MAX = 8;
/** Web 検索の後、出典の本文確認を始めるための残り時間の条件（分析が完了できる時間を残す） */
export const ANALYSIS_RESERVE_MS = 20_000;
export const BODY_CHECK_MS = 8_000;

/** 残り時間が、出典の本文確認と分析の両方に足りるときだけ本文を確認する（足りなければ確認せず、確認済みにもしない） */
export function planBodyCheck(remainingMs: number): boolean {
  return remainingMs >= BODY_CHECK_MS + ANALYSIS_RESERVE_MS;
}

export type GroupCounts = Record<OpportunityGroup, number>;

export function groupCounts(items: ReadonlyArray<{ group?: OpportunityGroup }>): GroupCounts {
  const counts = Object.fromEntries(OPPORTUNITY_GROUPS.map((g) => [g, 0])) as GroupCounts;
  for (const item of items) {
    // 分類が記録されていない候補は、どの分類にも数えない（分類未設定として別に扱う）
    if (item.group) counts[item.group] += 1;
  }
  return counts;
}

/** 件数の少ないグループから順に選ぶ（同数なら A→D の順）。追加探索の重点にする */
export function focusGroups(items: ReadonlyArray<{ group?: OpportunityGroup }>, count = 2): OpportunityGroup[] {
  const counts = groupCounts(items);
  return [...OPPORTUNITY_GROUPS]
    .sort((a, b) => counts[a] - counts[b] || OPPORTUNITY_GROUPS.indexOf(a) - OPPORTUNITY_GROUPS.indexOf(b))
    .slice(0, count);
}

/** 追加探索の指示。既存の候補と重複させない・重点グループを中心にする、を明示する */
export function buildExpansionInstructions(args: { focus: readonly OpportunityGroup[]; existing: readonly string[] }): string {
  const focusLines = args.focus.map((g) => `- ${GROUP_DEFINITION_JA[g]}`);
  const existingLines = args.existing.slice(0, MAX_OPPORTUNITIES).map((t) => `- ${t}`);
  return [
    'あなたは経営者の発想を広げる戦略アナリストです。外部情報（[n]）と会社情報をもとに、これまで挙がっていない機会の候補を提示します。',
    '機会は確定した戦略ではなく、人間が比較・議論するための材料です。確からしさより、検討する価値のある具体的な可能性を優先してください。',
    '',
    '【今回の重点（件数の少ない探索グループ）】',
    ...focusLines,
    '上の重点を中心に、各候補の group を A〜D から選んでください。',
    '',
    '【既存の候補（これらと重複させない）】',
    ...(existingLines.length ? existingLines : ['- （なし）']),
    '同じ市場の言い換え、既存候補と同じ顧客・用途・地域・価値提供は書かないでください。異なる顧客・課題・用途・地域・価値提供を探してください。',
    '',
    '【各候補】',
    '- 1文で書く（60〜120字程度）。何が変わる可能性があり、どの顧客・事業に関係するかを書く',
    '- 具体的な戦略・施策（〜に取り組む、〜を導入する等）は書かない',
    '- 出典で確認できる内容は basis を fact、推論は hypothesis にする。出典が弱くても、発想として具体的なら候補にしてよい（事実として断定しない）',
    '- 事業や顧客を取り違えない。入力に無い事実を作らない',
    '- 外部情報（[n]）が無い場合は sourceIndex を null にし、basis は hypothesis にする。存在しない出典番号を書かない',
    '- 外部情報が無い候補は、evidence に「社内情報からの推論」と書く（事実として断定しない）',
    '',
    '【出力】JSONのみ。opportunities に、新しい候補を最大' + EXPANSION_BATCH_MAX + '件。各項目は text / group / basis / evidence / sourceIndex を持つ。',
  ].join('\n');
}

export const EXPANSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['opportunities'],
  properties: {
    opportunities: { type: 'array', minItems: 1, maxItems: EXPANSION_BATCH_MAX, items: OPPORTUNITY_ITEM_SCHEMA },
  },
} as const;

const ExpansionItem = z.object({
  text: z.string().transform((s) => s.trim().slice(0, 300)).refine((s) => s.length > 0),
  group: z.string().refine((g) => isOpportunityGroup(g)),
  basis: z.enum(['fact', 'hypothesis']),
  evidence: z.string().nullish().transform((s) => (s ?? '').trim().slice(0, 300)),
  sourceIndex: z.number().int().nullish().transform((v) => v ?? null),
});

/** 追加探索の出力を検査する。形式が不正な項目、グループが不明な項目、出典番号が無効な項目（出典だけ外す）を扱う */
export function parseExpansionItems(raw: unknown, sourceCount: number): OtItem[] {
  const list = z.object({ opportunities: z.array(z.unknown()) }).safeParse(raw);
  if (!list.success) return [];
  const out: OtItem[] = [];
  for (const item of list.data.opportunities) {
    const r = ExpansionItem.safeParse(item);
    if (!r.success) continue;
    const idx = r.data.sourceIndex;
    const sourceIndex = idx !== null && Number.isInteger(idx) && idx >= 1 && idx <= sourceCount ? idx : null;
    out.push({
      text: r.data.text,
      group: r.data.group as OpportunityGroup,
      // 追加探索は新しい Web 検索を行わないため、既存の出典を理由に事実とはしない
      basis: 'hypothesis',
      evidence: r.data.evidence,
      sourceIndex,
      origin: 'extension',
    });
    if (out.length >= EXPANSION_BATCH_MAX) break;
  }
  return out;
}
