# Phase 2 データ抽出確認レポート

**目的**: AI 生成時に STAGE5・6 の具体的な数値が含まれているか確認  
**実施日**: 2026-10-18  

---

## 🔍 現在の実装課題

### 問題 1: extractNorthStarRevenue の二重計上リスク

```typescript
// 現在の実装（buildPlanData.ts:316-340）
function extractNorthStarRevenue(state, projectImpacts) {
  // STAGE4 の期待インパクト合計
  let totalImpact = 0;
  projectImpacts.forEach((p) => {
    const impact = p.impactRevenue?.replace(/[¥M]/g, '');
    if (impact && !isNaN(parseFloat(impact))) {
      totalImpact += parseFloat(impact);  // ← STAGE4値を合算
    }
  });
  
  if (totalImpact > 0) return `¥${totalImpact.toFixed(0)}M`;
  
  // 代替：companyTargets から売上目標を抽出
  if (Array.isArray(state?.companyTargets)) {
    const salesTarget = state.companyTargets.find(t => t?.label?.includes('売上'));
    if (salesTarget) return salesTarget.base;  // ← STAGE2目標を使用
  }
  
  return undefined;
}
```

**問題**:
- STAGE4 の期待インパクト（プロジェクト群の売上増）を「北極星収益」として扱っている
- 但し、STAGE6 の財務シミュレーション結果（実績予測）とは異なる可能性がある
- 両者の関係（STAGE4→STAGE6 への統合 or 並立）が不明確

### 問題 2: extractNorthStarMetrics が companyTargets を使用

```typescript
// 現在の実装（buildPlanData.ts:342-359）
function extractNorthStarMetrics(state) {
  const metrics = [];
  
  if (Array.isArray(state?.companyTargets)) {
    state.companyTargets.slice(0, 5).forEach((t) => {
      if (t?.label && t?.base) {
        metrics.push({
          label: t.label,
          value: `${t.base}${t.unit || ''}`,  // ← STAGE2 目標値
        });
      }
    });
  }
  
  return metrics;
}
```

**問題**:
- companyTargets は STAGE2 で設定された中期計画の目標（例：売上目標、利益率目標）
- STAGE5 の実行状況（現状進捗）や STAGE6 の財務シミュレーション（実績予測）ではない
- 名称（「northStarMetrics」）との意味的な乖離

### 問題 3: evaluateProjectionCompleteness が状態情報のみ

```typescript
// 現在の実装（buildPlanData.ts:361-383）
function evaluateProjectionCompleteness(state, audience) {
  const hasStage6 = !!(state as any)?.simulationResult;
  const hasProjection = (state as any)?.financeSummary?.length > 0;
  
  // audience別に簡易判定のみ
  // 実際の財務数値は返さない
}
```

**問題**:
- projectionStatus の値は 'complete' / 'partial' / 'incomplete' のみ
- 具体的な STAGE6 財務数値（売上予測値、利益予測値など）は含まれていない

---

## 📊 StrategyData における STAGE5・6 データの格納形式

### 現在判明しているフィールド

| フィールド | 格納内容 | 型 | 備考 |
|-----------|--------|-----|------|
| `financeSummary` | 財務サマリ | any[] | STAGE1-2 で入力 |
| `simulationResult` | STAGE6 シミュレーション結果 | unknown | 型定義が曖昧 |
| `companyTargets` | 中期目標（売上、利益率など） | array | STAGE2 |
| `csvFinanceData` | 財務明細（CSV形式） | CsvFinanceData | STAGE1 |

### データモデルの不明確さ

現在のコードから、以下が不明確：

1. **STAGE5 の実行状況データの格納場所**
   - progressLogs テーブルとの連携？
   - strategy_data の何フィールド？

2. **STAGE6 財務シミュレーション結果の詳細**
   - simulationResult の内部構造？
   - 何をシミュレートしたのか？（売上？利益？CF？）

3. **STAGE4 と STAGE6 の数値の関係**
   - STAGE4：プロジェクト群の個別期待インパクト
   - STAGE6：全社財務シミュレーション
   - 両者の統合ロジックは？それとも並立？

---

## ✅ 推奨される修正方針

### 選択肢 A: 状態情報に徹する（リスク最小）

**方針**: PlanData には「状態」のみを格納し、具体的な数値は AI プロンプトで「利用可能な場合」のみ含める

**実装**:
```typescript
const stage56 = {
  projectionStatus: 'complete' | 'partial' | 'incomplete',
  projectionNote: string,  // 「STAGE6未実施」「試算段階」など
  // 具体的な財務数値は含めない
};

// AI プロンプト側
【STAGE5/6: 進捗状況】
${planData.stage56.projectionStatus}
${planData.stage56.projectionNote}
```

**メリット**:
- 二重計上のリスクゼロ
- AI は「データ不足」を理解し、「要確認」を自動記載
- 既存コード変更が最小限

**デメリット**:
- 銀行向け・株主向けで財務数値が不足
- 計画書の説得力が低下

---

### 選択肢 B: 具体的な数値を段階的に導入（推奨）

**方針**: STAGE5・6 データモデルを明確にしてから、段階的に具体的な数値を導入

**Step 1（Phase 2 修正）**:
- simulationResult の内部構造を文書化
- financeSummary の実際の格納形式を確認
- progressLogs テーブルから STAGE5 実行状況を取得

**Step 2（Phase 2 修正、追加作業）**:
- extractStage6FinancialForecast() 新規関数で STAGE6 具体的数値を抽出
- extractStage5ExecutionStatus() 新規関数で STAGE5 進捗を抽出
- STAGE4 と STAGE6 の数値関係を明示（合算 or 並立）

**Step 3（Phase 3 以降）**:
- AI プロンプトで STAGE4 と STAGE6 の数値を明確に区別
- 単位・期間・前提条件を明示的に記載

**メリット**:
- 最終的には正確で有用なデータが利用可能
- 銀行向け・株主向けの説得力向上

**デメリット**:
- 実装工数増加
- データモデルの理解が必要

---

## 🎯 Phase 2 / Phase 3 の判定

### 現状評価

| 項目 | 状態 | 評価 |
|------|------|------|
| STAGE1-4 データ抽出 | ✅ 完全実装 | 問題なし |
| STAGE5・6 データ抽出 | ⚠️ 部分実装 | 改善推奨 |
| AI プロンプトに数値をいくつ含めるか | ❓ 未決定 | 要判定 |
| セキュリティ | ✅ 完全実装 | 問題なし |
| モデル設定（Luna） | ✅ 実装完了 | 問題なし |

### 推奨アクション

#### 選択肢 1: Phase 3 に進み、実装しながら検証

**判定**: Phase 3 進行可能（選択肢 A：状態情報に徹する）

**理由**:
- STAGE5・6 データは未着工のため、詳細な数値は不要
- 銀行向け・株主向けの基本的なテンプレート（表紙、本文、ページ番号）を先に実装
- PDF の品質を確認してから、財務数値の詳細化を検討

**実装内容**:
```typescript
// buildPlanData.ts: 状態情報のみ
const stage56 = {
  projectionStatus: evaluateProjectionCompleteness(...),
  projectionNote: getProjectionNote(...),
};

// API プロンプト
【STAGE5/6: 進捗状況】
財務シミュレーション: ${planData.stage56.projectionStatus}
${planData.stage56.projectionNote}
```

---

#### 選択肢 2: Phase 2 を拡張し、STAGE5・6 データモデルを完全実装後に Phase 3 進行

**判定**: Phase 3 遅延（選択肢 B を先行実装）

**理由**:
- 銀行向けでは返済可能性が最重要（STAGE6 財務が必須）
- AI 生成の説得力が大きく変わる

**実装内容**:
1. StrategyData で simulationResult / financeSummary の実装詳細を確認
2. 新規 extract 関数を追加実装
3. AI プロンプトで STAGE4 / STAGE6 の数値を明確に区別
4. テスト実施後 Phase 3 進行

**工数**: +1-2 日

---

## 🚀 推奨される判定

**→ 選択肢 1：Phase 3 進行可能（状態情報に徹する）**

**理由**:
1. 現在のデータモデルで完全な STAGE5・6 数値を抽出するには、先行調査が必要
2. PDF テンプレート実装（表紙、本文、改ページ）は独立した作業
3. Phase 3 進行中に STAGE5・6 データモデルを並行調査可能
4. AI 生成結果の実際の品質を見てから、数値詳細化を判定

**ただし Phase 3 実装時の注意**:
- AI プロンプトで「STAGE5・6 データ不足」を明示
- 銀行向けでは「返済根拠が未確認」と記載するよう指示
- PDF で「要確認」「準備中」ラベルを目立たせる

---

## ✅ 次のステップ

### Phase 2 側の確定事項

- [x] AIモデル（Luna）設定完了
- [x] STAGE1-4 データ抽出完全実装
- [x] セキュリティ層完全実装
- ⚠️ STAGE5・6 データ抽出は「状態情報のみ」で進行

### Phase 3 開始前に

- [ ] prompt.txt の「セキュリティ実動作確認」を実施
  - 未認証 → 401
  - 他社 companyId → 403
  - 他社 strategyId → 拒否

- [ ] 実企業データを使用しない開発環境を確認
  - ローカル開発のみ
  - テスト用ダミーデータで検証

---

**この調査結果に基づき、Phase 3 の PDF 実装を進めてください。**
**STAGE5・6 の詳細数値化は Phase 3 後の改善として検討します。**
