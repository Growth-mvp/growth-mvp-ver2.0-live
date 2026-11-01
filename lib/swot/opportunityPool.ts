import { z } from 'zod';
import { MAX_OPPORTUNITIES } from './opportunityAppend';
import {
  GROUP_DEFINITION_JA,
  VIEWPOINT_DEFINITION_JA,
  isDiscoveryViewpoint,
  isOpportunityGroup,
  type OpportunityGroup,
} from './opportunityGroups';
import { OPPORTUNITY_ITEM_SCHEMA, type OtItem } from './generateOt';
import {
  EXISTING_AND_NEW_SCOPE_RULE,
  EXISTING_SERVICE_RULE,
  NEW_CANDIDATE_GROUNDING_RULE,
  REGION_REFERENCE_RULE,
  REPHRASE_RULE,
} from './discoveryRules';

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

/**
 * 追加探索の指示。既存の候補と重複させない。
 * 件数の少ない分類を埋める指示は出さず、顧客の未挙出の悩みや望む成果を重点にする。
 */
export function buildExpansionInstructions(args: { existing: readonly string[] }): string {
  const existingLines = args.existing.slice(0, MAX_OPPORTUNITIES).map((t) => `- ${t}`);
  return [
    'あなたは経営者の発想を広げる戦略アナリストです。外部情報（[n]）と会社情報をもとに、これまで挙がっていない機会の候補を提示します。',
    '機会は確定した戦略ではなく、人間が比較・議論するための材料です。確からしさより、検討する価値のある具体的な可能性を優先してください。',
    '',
    '【今回の重点】',
    `- ${VIEWPOINT_DEFINITION_JA.customer_need}`,
    '既存の候補にまだ挙がっていない、顧客や利用者の悩み、まだ言葉にできていない不満や願い、本当に実現したい成果を重点的に考えてください。',
    `- ${EXISTING_AND_NEW_SCOPE_RULE}`,
    '① 世の中の変化、③ 業界や競争の変化の候補も含めてかまいません。件数の少ない分類を埋めるために探すことはしないでください。',
    '',
    '【発見の3つの視点（viewpoint）】',
    `- ${VIEWPOINT_DEFINITION_JA.world_change}`,
    `- ${VIEWPOINT_DEFINITION_JA.customer_need}`,
    `- ${VIEWPOINT_DEFINITION_JA.industry_competition}`,
    '',
    '【事業展開の方向（group・内部の探索範囲）】',
    `- ${GROUP_DEFINITION_JA.existing_market}`,
    `- ${GROUP_DEFINITION_JA.new_customer_use}`,
    `- ${GROUP_DEFINITION_JA.new_region}`,
    `- ${GROUP_DEFINITION_JA.new_business}`,
    '',
    '【既存の候補（これらと重複させない）】',
    ...(existingLines.length ? existingLines : ['- （なし）']),
    '同じ市場の言い換え、既存候補と同じ顧客・用途・地域・価値提供は書かないでください。異なる顧客・課題・用途・地域・価値提供を探してください。',
    '',
    '【各候補】',
    '- 1文で書く（60〜120字程度）。何が変わる可能性があり、どの顧客・事業に関係するかを書く',
    '- 誰が困っているか（購入者・意思決定者・利用者・最終顧客を区別する）と、どの場面で困っているかを具体的に書く',
    '- 具体的な戦略・施策（〜に取り組む、〜を導入する等）は書かない',
    `- ${REPHRASE_RULE}`,
    `- ${EXISTING_SERVICE_RULE}`,
    `- ${NEW_CANDIDATE_GROUNDING_RULE}`,
    `- ${REGION_REFERENCE_RULE}`,
    '- 出典で確認できる内容は basis を fact、推論は hypothesis にする。出典が無くても、社内情報から具体的に考えられる顧客の困りごとは候補にしてよい（事実として断定しない）',
    '- 事業や顧客を取り違えない。入力に無い事実や、架空の出典・数値を作らない',
    '- 外部情報（[n]）が無い場合は sourceIndex を null にし、basis は hypothesis にする。存在しない出典番号を書かない',
    '- 外部情報が無い候補は、evidence に「社内情報からの推論」と書く（事実として断定しない）',
    '',
    `【出力】JSONのみ。opportunities に、新しい候補を最大${EXPANSION_BATCH_MAX}件。各項目は text / group / viewpoint / basis / evidence / sourceIndex を持つ。`,
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
  viewpoint: z.unknown(),
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
      ...(isDiscoveryViewpoint(r.data.viewpoint) ? { viewpoint: r.data.viewpoint } : {}),
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
