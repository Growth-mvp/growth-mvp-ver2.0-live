import { detectOperationIntent } from '@/lib/operationKnowledge/guidance';
import { buildStrategyRationaleBlock } from './strategyRationale';
import { buildFinanceSummaryBlock, buildValueAnalysisBlock } from './stage1Blocks';
import { buildStage3BridgeBlock } from './stage3Context';

const FINANCE_CUE = /業績|財務|売上|利益|収益|損益|キャッシュ|数字|資金|投資|原価|費用|借入|\b(ROIC|ROE|ROA|WACC|PBR|PER|CAGR)\b|5指標/i;
const RATIONALE_CUE = /なぜ|理由|選ん|選択|狙い|意図|重視|考え|課題|解決|困り|顧客|お客|勝ち筋|根拠|戦略|ストーリー|社長|経営者|優先|事業|深掘り|12問|強み|危機|参入|撤退|採用|対立|解消|原因|調整/;
const ALIGNMENT_CUE = /橋渡し|戦略展開|展開|部門|全社|現場|行動|役割|整合|落とし込|落と|営業|製造|生産|販売|対立|調整/;
const COMPANY_REFERENCE = /当社|弊社|わが社|我が社|自社|御社|うちの|うちは|この会社|社長|経営者|経営陣/;
const GENERAL_KNOWLEDGE_CUE = /とは|って何|意味|定義|一般的|一般論|違い|種類|仕組み|手法|フレームワーク|基礎/;

export function hasCompanyReference(query: string): boolean {
  return COMPANY_REFERENCE.test(query ?? '');
}

export function isGeneralKnowledgeQuestion(query: string): boolean {
  const q = query ?? '';
  return GENERAL_KNOWLEDGE_CUE.test(q) && !COMPANY_REFERENCE.test(q);
}

export type ContextSelection = {
  operation: boolean;
  finance: boolean;
  rationale: boolean;
  alignment: boolean;
  unclear: boolean;
};

/**
 * 質問ごとに、回答に必要な企業情報の種類を選ぶ。一般論の判定には依存しない。
 */
export function selectContextSources(query: string): ContextSelection {
  const q = query ?? '';
  const operation = detectOperationIntent(q);
  const finance = FINANCE_CUE.test(q);
  const rationale = RATIONALE_CUE.test(q);
  const alignment = ALIGNMENT_CUE.test(q);
  return { operation, finance, rationale, alignment, unclear: !operation && !finance && !rationale && !alignment };
}

const PROGRESS_CUE = /進捗|遅れ|遅延|未達|障害|実行|進み|滞|達成できない/;
const PLAN_CUE = /利益|資金|キャッシュ|借入|返済|DSCR|現預金|設備投資|来年度|来期|年度|3年後|業績|シミュレーション|予測|営業CF|投資CF/i;
const BROAD_CUE = /優先|経営課題|全体|全般|全社|今後/;

export type StageSources = { progress: boolean; plan: boolean };

export function selectStage56Sources(query: string): StageSources {
  const q = query ?? '';
  const broad = BROAD_CUE.test(q);
  return { progress: PROGRESS_CUE.test(q) || broad, plan: PLAN_CUE.test(q) || broad };
}

const CASH_CUE = /現預金|運転資金|キャッシュ|資金繰り|資金|借入|返済/;
const TALENT_CUE = /人材|人員|人手|人不足|育成|採用|教育|スキル|技能|保守人材/;

export type SupplementSources = { cash: boolean; talent: boolean };

/** 質問に応じて、現預金の実績や人材に関する登録回答を追加する（すべては入れない）。 */
export function selectSupplementSources(query: string): SupplementSources {
  const q = query ?? '';
  return { cash: CASH_CUE.test(q), talent: TALENT_CUE.test(q) };
}

export function buildSelectedContextBlock(args: {
  selection: ContextSelection;
  strategy: Record<string, any> | null | undefined;
  companyDataIncluded: boolean;
}): string {
  const { selection, strategy, companyDataIncluded } = args;
  const parts: string[] = [];

  if (selection.unclear) {
    parts.push('【情報の選択】質問の対象が特定できない場合は、推測で回答せず、確認の質問を1つだけしてください。');
  }

  if (!strategy) return parts.join('\n\n');

  if (selection.rationale) {
    parts.push(
      buildStrategyRationaleBlock(strategy, { storyInAgentPrompt: companyDataIncluded }).text
    );
  }

  if (selection.finance && !companyDataIncluded) {
    const financeBlock = buildFinanceSummaryBlock(strategy.financeSummary);
    if (financeBlock) parts.push(financeBlock);
    parts.push(buildValueAnalysisBlock(strategy.valueAnalysis, strategy.stage1Benchmarks));
  }

  if (selection.alignment && !selection.operation) {
    parts.push(buildStage3BridgeBlock(strategy).text);
  }

  return parts.join('\n\n');
}
