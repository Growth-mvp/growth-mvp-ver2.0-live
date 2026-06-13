// lib/autoModeRouter.ts
// Sprint 4: AutoMode Router - lastUserText からモードを自動判定

export type AutoMode = 'help' | 'advisor';

export interface AutoModeResult {
  mode: AutoMode;
  confidence: number;
  reasons: string[];
}

/**
 * 最後のユーザーテキストから、help（操作/機能Q&A）か advisor（戦略/示唆）を判定
 *
 * @param args.lastUserText - ユーザーの最後の発話
 * @param args.stageHint - 将来拡張用（現在は未使用）
 * @returns { mode, confidence, reasons }
 */
export function detectAutoMode(args: {
  lastUserText: string;
  stageHint?: string | null;
}): AutoModeResult {
  const { lastUserText } = args;

  // 空のテキスト → デフォルトは advisor
  if (!lastUserText || lastUserText.trim().length === 0) {
    return {
      mode: 'advisor',
      confidence: 0.55,
      reasons: ['empty text, default to advisor'],
    };
  }

  // ★ Sprint 5.1: 強制 help 判定（製品/ステージ説明質問）
  // GROWTH に関する説明質問は確実に help モードに落とす
  const forcedHelpPatterns = [
    /growth/i,                                    // A) GROWTH
    /stage\s*[1-6]/i,                            // B) STAGE1-6, stage 1 など
    /ステージ\s*[1-6]/,                            // C) ステージ1-6
    /どんなツール|何をする|できること|機能|使い方|操作|画面/i,  // D) 説明質問
  ];

  if (forcedHelpPatterns.some((pattern) => pattern.test(lastUserText))) {
    return {
      mode: 'help',
      confidence: 0.95,
      reasons: ['forced:product_or_stage_question'],
    };
  }

  // キーワード定義
  const helpKeywords = [
    '使い方',
    'どこ',
    '画面',
    'ボタン',
    '手順',
    'やり方',
    '操作',
    '保存',
    '読み込み',
    '復元',
    '反映',
    '同期',
    'アップロード',
    'CSV',
    'PDF',
    'Excel',
    'エラー',
    'できない',
    '動かない',
    'ログイン',
    '権限',
    'role',
    'RLS',
    'companyId',
    'strategyId',
    'バグ',
    '直らない',
    '表示されない',
  ];

  const advisorKeywords = [
    '勝ち筋',
    '企業価値',
    'ROIC',
    'WACC',
    'PBR',
    'KPI',
    'OKR',
    '部門戦略',
    '事業・部門別戦略',
    'ストーリー',
    '論点',
    '示唆',
    '改善',
    '優先順位',
    '戦略',
    'ポートフォリオ',
    '投下資本',
    '成長率',
    '利益率',
    '資本効率',
    '安全性',
    '評価',
    'シナリオ',
  ];

  // スコア計算（部分一致）
  const textLower = lastUserText.toLowerCase();
  const helpScore = helpKeywords.filter((kw) => textLower.includes(kw.toLowerCase())).length;
  const advisorScore = advisorKeywords.filter((kw) => textLower.includes(kw.toLowerCase())).length;

  // ヒットしたキーワード（debug用）
  const hitHelpKeywords = helpKeywords.filter((kw) => textLower.includes(kw.toLowerCase())).slice(0, 3);
  const hitAdvisorKeywords = advisorKeywords.filter((kw) => textLower.includes(kw.toLowerCase())).slice(0, 3);

  // モード決定（同点は advisor）
  const mode: AutoMode = helpScore > advisorScore ? 'help' : 'advisor';

  // confidence 計算
  const diff = Math.abs(helpScore - advisorScore);
  const confidence = Math.min(0.95, 0.55 + diff * 0.1);

  // reasons 構築
  const reasons: string[] = [];
  if (hitHelpKeywords.length > 0) {
    reasons.push(`help keywords: ${hitHelpKeywords.join(', ')}`);
  }
  if (hitAdvisorKeywords.length > 0) {
    reasons.push(`advisor keywords: ${hitAdvisorKeywords.join(', ')}`);
  }
  if (reasons.length === 0) {
    reasons.push('default: no keywords match');
  }

  return {
    mode,
    confidence,
    reasons,
  };
}
