// 実行計画書の画面で使う判定（描画には依存しない純粋な関数）。
// 計画案の採用（画面内の仮状態）と、実行開始の条件を分けて判定する。

export type RegulatoryDecision = 'NOT_APPLICABLE' | 'APPLICABLE_PROCEDURE_CONFIRMED' | 'UNCONFIRMED';

/** 規制・安全の確認の記録。チェックだけでなく、判断内容・確認者・確認日・根拠を残す */
export type RegulatoryRecord = {
  decision: RegulatoryDecision | null;
  judgement: string;
  confirmer: string;
  confirmedOn: string;
  basis: string;
};

export const EMPTY_REGULATORY: RegulatoryRecord = { decision: null, judgement: '', confirmer: '', confirmedOn: '', basis: '' };

export const REGULATORY_DECISION_LABEL: Record<RegulatoryDecision, string> = {
  NOT_APPLICABLE: '適用なし',
  APPLICABLE_PROCEDURE_CONFIRMED: '適用あり（必要な手続きを確認した）',
  UNCONFIRMED: '未確認',
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 規制の記録が、確認済みとして揃っているか。「未確認」は完了としない（開始は止めない）。
 * 確認事項が無い案件（required=false）は、利用者が「未確認」と明示した時だけ保留する。確認事項が無いことを理由に、判断を勝手に決めない */
export function regulatoryComplete(r: RegulatoryRecord, required = true): boolean {
  if (!required) return r.decision !== 'UNCONFIRMED';
  return (
    r.decision !== null &&
    r.decision !== 'UNCONFIRMED' &&
    r.judgement.trim() !== '' &&
    r.basis.trim() !== '' &&
    r.confirmer.trim() !== '' &&
    DATE_PATTERN.test(r.confirmedOn)
  );
}

export type StartInput = { responsibleConfirmed: boolean };

/* 実行開始の条件は、実行責任者が設定されていること。採用・KPIの整合・規制の記録は、開始の処理の中で扱い、ここでは止めない */
export function startGate(input: StartInput): { startable: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!input.responsibleConfirmed) blockers.push('実行責任者を確定してください');
  return { startable: blockers.length === 0, blockers };
}


export type FinanceStatus = 'CONFIRMED' | 'AI_ESTIMATE' | 'NOT_CALCULATED';

/** 財務効果の区分の表示名。未算定は 0 円と表示しない */
export const FINANCE_STATUS_LABEL: Record<FinanceStatus, string> = {
  CONFIRMED: '確認済みの計画数値',
  AI_ESTIMATE: 'AIによる参考試算（未確認）',
  NOT_CALCULATED: '未算定',
};

/** 金額の表示。金額が無い（未算定）の場合は「未算定」を返し、0 円にはしない */
export function financeAmountText(status: FinanceStatus, amountDisplay: string | null | undefined): string {
  if (status === 'NOT_CALCULATED' || !amountDisplay) return '未算定';
  return amountDisplay;
}

/** 規制・安全に関わる確認事項（タイトルと、障害から補われたものの両方を含む） */
const REGULATORY_WORDS = /規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/;

export function isRegulatoryTask(task: { title: string; hold?: boolean; gate: string }): boolean {
  return task.gate === 'START' && (task.hold === true || REGULATORY_WORDS.test(task.title));
}
