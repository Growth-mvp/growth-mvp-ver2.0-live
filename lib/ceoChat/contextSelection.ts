import { detectOperationIntent } from '@/lib/operationKnowledge/guidance';
import { buildStrategyRationaleBlock } from './strategyRationale';
import { buildFinanceSummaryBlock, buildValueAnalysisBlock } from './stage1Blocks';
import { buildStage3BridgeBlock } from './stage3Context';

const FINANCE_CUE = /業績|財務|売上|利益|収益|損益|キャッシュ|数字|\b(ROIC|ROE|ROA|WACC|PBR|PER|CAGR)\b|5指標/i;
const RATIONALE_CUE = /なぜ|理由|選ん|選択|狙い|意図|重視|考え|課題|解決|困り|顧客|お客|勝ち筋|根拠|戦略|ストーリー|社長|経営者|優先|事業|深掘り|12問|強み|危機/;
const ALIGNMENT_CUE = /橋渡し|戦略展開|展開|部門|全社|現場|行動|役割|整合|落とし込|落と/;

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
