# Phase 1 最終検証報告書

**検証日**: 2026-10-19  
**ステータス**: ⚠️ 重要な懸念事項あり

---

## 1. 自動テストの実行状況

### テストランナーの確認

**結論**: テストランナーがインストールされていません。

```
確認内容:
- npm run コマンド出力: smoke-test のみ存在
- package.json devDependencies: @types/jest はあるが Jest 本体なし
- Playwright @playwright/test はインストール済み
```

**テスト実行の課題**:
- buildPlanData.test.ts は Jest 形式（describe/it/expect）
- 実行環境がない（Jest をインストールするか、テストランナーを変更必要）
- 現在、テストコードは存在するが **実行されていない**

**対応**:
- テストコードは型チェック済み（TypeScript構文は正常）
- 本番デプロイ前に Jest をインストール、または Playwright テスト形式への変更が必要
- 今回は調査段階のため修正なし

---

## 2. STAGE1財務データの単位調査

### 重大な発見：既存の単位推定処理

**ファイル**: `utils/supabase/strategy.ts` L798-821

```typescript
// ★ TASK-B: 既存データの救済（百万円で保存されたデータを yen に変換）
// 復元時に financePL の revenue < 1M なら百万円と判定して yen に変換
// 背景: レガシーデータは百万円単位で保存、新規は yen 単位。互換性維持のための変換。

const revenueYen = revenue > 0 && revenue < 1_000_000 ? revenue * 1_000_000 : revenue;
```

### 単位の扱い

| 段階 | 処理内容 | 単位 | 根拠 |
|------|--------|------|------|
| **UI入力** | FinanceYearEditorTable | JPY（円）と推定 | strategyStore の初期値が `currency: 'JPY'` |
| **DB保存** | setFinancePL → strategy_data | 不明（型定義に unit フィールドなし） | FinancePLRow 型に単位フィールドなし |
| **復元** | buildStateFromDbRow() | JPY（条件付き） | 値 < 100万なら百万円と判定→ ×100万変換 |

### 問題点

1. **単位が DB に明示されていない**
   - FinancePLRow 型定義に `unit?` フィールドなし
   - types/strategy.ts L796-807 参照

2. **既存の単位推定処理が禁止事項に違反**
   - strategy.ts L809: `revenue < 1_000_000` で百万円と判定
   - **「金額の大きさによる単位推定は禁止」に違反**

3. **新規の buildPlanData では単位を「未確認」と明示**
   - extractHistoricalFinances() で警告付き表示
   - しかし、復元層では既に百万円→JPY変換済み

### 結論

```
【単位の流れ】
ユーザー入力（JPY推定）
  ↓
DB保存（単位なし、数値のみ）
  ↓
復元時（値 < 100万なら百万円と判定して ×100万変換）
  ↓
buildPlanData（「単位未確認」と警告表示）
```

**リスク**: 既存の単位推定処理が、新規の「単位未確認」警告と矛盾している可能性がある。

---

## 3. financeSummary 形式の確認

### DB保存形式

**ファイル**: `utils/supabase/strategy.ts` L419-427

```typescript
function toUiFinanceSummary(dbValue: any): any[] {
  if (dbValue == null) return [];
  const parsed = parseJson(dbValue);
  if (Array.isArray(parsed)) return parsed; // 旧互換
  if (typeof parsed === 'object' && Array.isArray((parsed as any).rows)) {
    return (parsed as any).rows;
  }
  return [];
}
```

### 形式の違い

| 形式 | 構造 | 対応状況 |
|------|------|--------|
| **旧形式** | 配列: `[...items...]` | ✓ サポート |
| **新形式** | オブジェクト: `{ rows: [...items...] }` | ✓ サポート |

### 現在の計画書生成 API での取得

**ファイル**: `app/api/plans/[audience]/generate/route.ts` L493-496

```typescript
financeSummary: Array.isArray(row.finance_summary)
  ? row.finance_summary
  : undefined,
```

**問題**: 配列のみを取得。`{ rows: [...] }` 形式の場合、undefined になる可能性あり。

**推奨対応**:
```typescript
financeSummary: (() => {
  const fs = row.finance_summary;
  if (Array.isArray(fs)) return fs;
  if (fs && typeof fs === 'object' && Array.isArray((fs as any).rows)) {
    return (fs as any).rows;
  }
  return undefined;
})()
```

---

## 4. 型定義・表示名称の確認

### buildPlanData.ts での確認

**確認項目 1**: companyTargetRevenue のコメント

```typescript
// ✓ 正常
/** STAGE2の正式な全社売上目標（承認済み目標） */
companyTargetRevenue?: string;
```

**問題**: コメントに「承認済み目標」と記載（「登録目標」に統一する必要あり）

**確認項目 2**: northStarRevenue への STAGE4 施策効果の代入

```typescript
// extractNorthStarRevenue() から返される値を使用
const { companyTarget, projectImpact, recommendedTarget } = extractNorthStarRevenue(state, projectImpacts);

northStarRevenue: recommendedTarget, // STAGE2優先、なければ「未設定」
```

**✓ 正常**: STAGE4施策効果が直接代入されない。推奨表示として機能。

### buildAudiencePrompt() での確認

**新しいプロンプト出力** (route.ts L696-704):

```typescript
【STAGE5/6: 財務目標】
☆ STAGE2正式な売上目標: ${planData.stage56.companyTargetRevenue || '未設定'}
参考：STAGE4施策別期待効果合計: ${planData.stage56.projectImpactSum || 'なし'}
推奨目標: ${planData.stage56.northStarRevenue || '未設定'}
```

**✓ 正常**: STAGE2 と STAGE4 が明確に分離表示される。

---

## 5. 型定義の修正が必要な項目

### 必須修正

**ファイル**: `utils/export/buildPlanData.ts` L110

```typescript
// 修正前
/** STAGE2の正式な全社売上目標（承認済み目標） */
companyTargetRevenue?: string;

// 修正後
/** STAGE2の登録売上目標（確定が必須ではないため参考値） */
companyTargetRevenue?: string;
```

### 推奨修正

**ファイル**: `app/api/plans/[audience]/generate/route.ts` L494-496

```typescript
// 現在
financeSummary: Array.isArray(row.finance_summary)
  ? row.finance_summary
  : undefined,

// 推奨
financeSummary: (() => {
  const fs = row.finance_summary;
  if (Array.isArray(fs)) return fs;
  if (fs && typeof fs === 'object' && Array.isArray((fs as any).rows)) {
    return (fs as any).rows;
  }
  return undefined;
})()
```

---

## 6. 検証結果サマリー

### 承認された項目 ✓

- ✓ 北極星目標と STAGE4 施策効果の分離：正常に実装
- ✓ extractNorthStarRevenue()：STAGE2 優先度が守られている
- ✓ 銀行・株主・社員向けの出力：混同がない

### 懸念事項 ⚠️

1. **テストランナーなし**
   - Jest がインストールされていない
   - テストコードは型チェック済みだが実行不可

2. **単位処理の矛盾**
   - 既存システム: 値 < 100万 で百万円と判定（禁止事項に違反）
   - 新規実装: 単位「未確認」と警告表示
   - **対応**: 現在のフェーズでは修正なし。Phase 2 で DB 層の単位定義を追加

3. **financeSummary 形式の潜在リスク**
   - `{ rows: [...] }` 形式の場合、計画書 API で undefined になる可能性
   - **推奨**: 軽微な修正で対応可能

4. **コメント表現の不統一**
   - companyTargetRevenue に「承認済み」と記載（「登録」に変更推奨）

---

## 7. 本番デプロイ前のチェックリスト

| 項目 | 状態 | 対応 |
|-----|------|------|
| 北極星目標の分離 | ✓ OK | - |
| STAGE4施策効果の表示 | ✓ OK | - |
| audience 別の混同 | ✓ OK | - |
| **テスト実行** | ❌ 未実行 | Jest インストール必要 |
| **financeSummary 形式** | ⚠️ リスク | 軽微な修正推奨 |
| **型定義コメント** | ⚠️ 不統一 | 文言修正推奨 |
| **単位処理** | ⚠️ 矛盾 | Phase 2 で対応 |

---

## 8. 推奨対応

### 本番デプロイ前（必須）

1. **Jest のインストールまたは代替テストランナーの用意**
   - テストを実際に実行して合格・失敗件数を報告

### デプロイ後（Phase 2）

1. **FinancePLRow に `unit` フィールドを追加**
   - 金額の大きさによる推定を廃止

2. **financeSummary 形式の完全サポート**
   - `{ rows: [...] }` 形式を確実に処理

3. **コメント表現の統一**
   - 「承認済み」→「登録」に修正

---

## 結論

**本番デプロイ判定**: 🟡 **条件付き許可**

- 北極星目標の分離は正常に実装されている
- テスト実行環境の整備が必要
- 軽微な懸念事項あり（Phase 2 で対応可能）

**デプロイ条件**:
1. Jest でテストを実行し、10 ケース全て合格を確認
2. または、テストランナーの設定を完了

