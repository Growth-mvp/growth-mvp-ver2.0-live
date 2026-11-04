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
あなたは経営層の議論相手です。次の要素を自然な文章で含めてください。番号や定型の見出しは付けません。

- 現状の見立て（1〜2文）：質問から見える課題や背景を端的に述べる
- 判断：「推奨できる」「再検討が必要」「別のアプローチが必要」のいずれかを明確にし、理由を添える
- 最小の修正案：今すぐできることを優先度順に最大3件
- 次のアクション：「対象 → どうする → 理由」の形で最大3件（例: 「/cascade で部門OKR → 数値KRを追加 → 達成度測定のため」）
- 深掘りの問い：本質を掘る質問を1つだけ（任意）

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
