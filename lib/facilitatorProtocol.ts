/**
 * /lib/facilitatorProtocol.ts
 * ステージ別ファシリテーションプロトコル生成
 *
 * systemPrompt に追加される短いブロック（過剰な説明は避ける）
 * 現ステージでは "generic" のみで安定稼働を優先
 */

export type FacilStage = 'generic' | 'stage1' | 'stage2' | 'stage3' | 'stage4';

/**
 * ファシリテーターモード用の systemPrompt 追記ブロックを生成
 *
 * @param args.stage - ステージ名（現在は generic のみ実装）
 * @returns ファシリテーション指示テキスト
 */
export function buildFacilitatorBlock(args: { stage: FacilStage }): string {
  const { stage } = args;

  switch (stage) {
    case 'generic':
      return buildGenericFacilitator();
    case 'stage1':
      return buildStage1Facilitator();
    case 'stage2':
      return buildStage2Facilitator();
    case 'stage3':
      return buildStage3Facilitator();
    case 'stage4':
      return buildStage4Facilitator();
    default:
      return buildGenericFacilitator();
  }
}

/**
 * Generic ファシリテーター（すべてのユースケース）
 * 短く、実行可能な指示を提供
 */
function buildGenericFacilitator(): string {
  return `
【ファシリテーター モード】
あなたは経営層のファシリテーターです。以下の構造で応答してください：

1) 現状サマリー (1-2行)
   - ユーザーの質問から見える課題や背景を端的に述べる

2) ステータス判定 (1語)
   - pass: 推奨できる・進行OK
   - caution: 再検討・補足情報が必要
   - block: 実行不可・別アプローチを提案

3) 最小修正案 (箇条書き, 最大3件)
   - 今すぐできる→優先度順

4) 次アクション (最大3件, 形式: "対象 → どうする → 理由")
   - 例: "/cascade で部門OKR → 数値KRを追加 → 達成度測定のため"

5) 深掘り質問 (最大1つ, 任意)
   - 本質を掘る1問だけ

制約: 長文禁止・結論優先・根拠は簡潔に
`.trim();
}

/**
 * Stage1 ファシリテーター（戦略基本情報入力段階）
 * TODO: Sprint 2以降で実装
 */
function buildStage1Facilitator(): string {
  return `
【ステージ1: 基本情報入力 ファシリテーター】
（実装予定）
`.trim();
}

/**
 * Stage2 ファシリテーター（戦略ストーリー構築段階）
 * TODO: Sprint 2以降で実装
 */
function buildStage2Facilitator(): string {
  return `
【ステージ2: ストーリー構築 ファシリテーター】
（実装予定）
`.trim();
}

/**
 * Stage3 ファシリテーター（部門カスケード段階）
 * TODO: Sprint 2以降で実装
 */
function buildStage3Facilitator(): string {
  return `
【ステージ3: 部門カスケード ファシリテーター】
（実装予定）
`.trim();
}

/**
 * Stage4 ファシリテーター（進捗管理・実行段階）
 * TODO: Sprint 2以降で実装
 */
function buildStage4Facilitator(): string {
  return `
【ステージ4: 進捗管理 ファシリテーター】
（実装予定）
`.trim();
}
