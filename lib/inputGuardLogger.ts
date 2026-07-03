/**
 * 入力充足度ログ（ブロック処理なし、観測のみ）
 * 目的：入力が少ない状態でOpenAIが呼ばれていないかを可視化
 */

export type InputGuardLogArgs = {
  requestId: string;
  apiName: string;
  companyId?: string;
  strategyId?: string;
  meaningfulInputScore: number; // 0-100
  hasCompanyInfo: boolean;
  hasStage1Context: boolean;
  hasStage2Answers: boolean;
  hasStage2Story: boolean;
  hasStage3Context: boolean;
  hasStage4Context: boolean;
  promptLength: number;
  suspiciousKeywordFlags: {
    autoMotive: boolean;
    exhaust: boolean;
    ceramic: boolean;
    oem: boolean;
  };
};

/**
 * 入力充足度ログを出力（デバッグ用、本番は抑制）
 */
export function logInputGuard(args: InputGuardLogArgs): void {
  // 本番環境で NODE_ENV=production かつ DEBUG_STAGE_INPUT_GUARD なし → ログ出力しない
  const isProduction = process.env.NODE_ENV === 'production';
  const debugEnabled = process.env.DEBUG_STAGE_INPUT_GUARD === '1';

  if (isProduction && !debugEnabled) {
    return;
  }

  const log = {
    '[input-guard]': true,
    requestId: args.requestId,
    apiName: args.apiName,
    companyId: args.companyId?.slice(0, 8) ?? 'unknown',
    strategyId: args.strategyId?.slice(0, 8) ?? 'unknown',
    meaningfulInputScore: args.meaningfulInputScore,
    dataAvailability: {
      hasCompanyInfo: args.hasCompanyInfo,
      hasStage1Context: args.hasStage1Context,
      hasStage2Answers: args.hasStage2Answers,
      hasStage2Story: args.hasStage2Story,
      hasStage3Context: args.hasStage3Context,
      hasStage4Context: args.hasStage4Context,
    },
    promptLength: args.promptLength,
    suspiciousKeywords: args.suspiciousKeywordFlags,
  };

  console.log('[input-guard]', JSON.stringify(log, null, 2));
}

/**
 * テキスト内に疑わしいキーワードがあるか確認（プロンプト検査用）
 */
export function checkSuspiciousKeywords(text: string): {
  autoMotive: boolean;
  exhaust: boolean;
  ceramic: boolean;
  oem: boolean;
} {
  const lower = (text || '').toLowerCase();
  return {
    autoMotive: /自動車|automobile|automotive|車/.test(lower),
    exhaust: /排ガス|exhaust|emission/.test(lower),
    ceramic: /セラミック|ceramic/.test(lower),
    oem: /oem|original equipment/.test(lower),
  };
}
