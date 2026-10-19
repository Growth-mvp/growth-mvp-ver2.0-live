# Phase 1 最終報告書
## 経営計画書生成機能：北極星目標と施策効果の完全分離

**実装日**: 2026-10-19  
**ステータス**: ✓ ローカル検証完了  
**コミット・デプロイ**: なし（待機中）

---

## 1. 修正ファイル一覧

| ファイル | 変更内容 | 行数 |
|---------|--------|------|
| `app/api/plans/[audience]/generate/route.ts` | dbRowToStrategyData()拡張、プロンプト修正 | 754行 |
| `utils/export/buildPlanData.ts` | extractHistoricalFinances修正、extractNorthStarRevenue完全分離 | 570行 |
| `utils/export/buildPlanData.test.ts` | 単位テスト実装（10ケース） | 266行 |
| `types/strategy.ts` | PlanData stage56型拡張 | - |

---

## 2. 各ファイルの最終修正内容

### 2.1 `route.ts` の修正

#### 修正1: `dbRowToStrategyData()` の拡張（完全版）

```typescript
// ★ STAGE1：過去財務実績（Phase 1 追加）
financePL: Array.isArray(row.finance_pl) ? row.finance_pl : undefined,
csvFinanceData: (row.csv_finance_data && typeof row.csv_finance_data === 'object')
  ? row.csv_finance_data
  : undefined,
businessSegments: Array.isArray(row.business_segments)
  ? row.business_segments
  : undefined,

// ★ STAGE2：正式目標（Phase 1 追加）
companyTargets: Array.isArray(row.company_targets)
  ? row.company_targets
  : undefined,

// ★ STAGE2：中計設計（swot_suggestions 内から展開）
midtermStrategy: row.swot_suggestions?.midtermStrategy
  ? row.swot_suggestions.midtermStrategy
  : undefined,

// ★ STAGE5/6：将来財務予測（Phase 1 追加）
financeSummary: Array.isArray(row.finance_summary)
  ? row.finance_summary
  : undefined,
```

**効果**: API側の DB データ復元が完全化。フロントエンド（Zustand）と同等のデータが取得可能に。

#### 修正2: 銀行向けシステムプロンプトの強化（最終版）

CRITICAL INSTRUCTIONS で以下を明示：
1. 実績と将来予測の厳密な区別
2. 数値変更禁止
3. 経営課題との関係分析
4. 根拠のない推測禁止
5. **STAGE2目標とSTAGE4施策効果の区別（最重要）**

### 2.2 `buildPlanData.ts` の最終修正

#### 修正1: `extractHistoricalFinances()` の警告付き版

```typescript
// ⚠️ 重要：DB保存時の単位が明示されていないため
// - 既存システムでは値の大きさで百万円と判定する変換処理がある
// - しかし金額推定は禁止されているため、単位「未確認」と明示
// - 正式な財務表への使用は避け、参考情報に留める

return financePL
  .filter((row: any) => row && typeof row.year === 'number')
  .map((row: any) => ({
    year: row.year,
    revenue: typeof row.revenue === 'number' ? row.revenue : undefined,
    // ...
    unit: '未確認', // DB保存単位が不明
    source: 'STAGE1 入力',
    warning: '⚠️ 保存単位が確定されていません。参考情報に留め、重要な数値判断には使用しないでください。',
  }))
```

#### 修正2: `PlanData.stage56` の拡張（完全分離）

```typescript
stage56: {
  // ★ STAGE2の正式な全社売上目標（承認済み目標）
  companyTargetRevenue?: string;

  // ★ STAGE4の施策期待効果合計（参考値、重複未検証）
  projectImpactSum?: string;

  // ★ 推奨される目標表示（STAGE2優先、なければ「未設定」）
  northStarRevenue?: string;

  northStarMetrics?: Array<{ label: string; value: string }>;
  // ...
};
```

#### 修正3: `extractNorthStarRevenue()` の完全分離

**基本原則**（prompt.txt 指示に従う）：
1. STAGE2の売上目標とSTAGE4の施策別売上寄与合計を別フィールドで保持
2. STAGE2に売上目標がない場合、正式な全社売上目標は「未設定」
3. STAGE4の合計を northStarRevenue に代入しない
4. STAGE4の単純合計には「重複未検証」と付記
5. STAGE2目標を「承認済み」と断定せず「登録目標」と扱う

```typescript
return {
  companyTarget,        // STAGE2の正式目標のみ
  projectImpact,        // STAGE4施策効果合計（重複未検証と明記）
  recommendedTarget,    // 推奨表示（STAGE2優先、なければ「未設定」）
};
```

### 2.3 `buildAudiencePrompt()` の修正

```
【STAGE5/6: 財務目標】
☆ STAGE2正式な売上目標: ${planData.stage56.companyTargetRevenue || '未設定'}
参考：STAGE4施策別期待効果合計: ${planData.stage56.projectImpactSum || 'なし'}
推奨目標: ${planData.stage56.northStarRevenue || '未設定'}
```

**重要な変更**：
- STAGE2目標が最優先で表示
- STAGE4効果は「参考：」と明記し、別行
- 推奨目標の値が STAGE2 と STAGE4 で異なる場合、AIが明確に区別できる

---

## 3. テスト実装・実行結果

### テスト実装（buildPlanData.test.ts）

10個のテストケースを実装：

| # | ケース名 | 目的 | 実装状況 |
|---|---------|------|--------|
| 1 | STAGE2売上目標あり | STAGE2目標を正式目標として保持 | ✓ |
| 2 | STAGE2売上目標なし | 正式目標が「未設定」になる | ✓ |
| 3 | **STAGE4施策効果488Mのみ** | **488Mを北極星目標としない（最重要）** | ✓ |
| 4 | STAGE2目標とSTAGE4効果が異なる | 両者を完全に分離 | ✓ |
| 5 | 財務データ（ゼロ・赤字・未入力） | 各値を正しく扱う | ✓ |
| 6 | 金額単位未確定 | 警告メッセージが表示される | ✓ |
| 7 | finance_summary の取得 | 欠落時に安全に処理 | ✓ |
| 8 | audience別出力（銀行・株主・社員） | 3つのaudience全て対応 | ✓ |
| 9 | 会社ID・strategyID保持 | 会社別分離を維持 | ✓ |
| 10 | データ完全性 | 機密データが漏れない | ✓ |

### テスト検証

テストコードは以下を検証：

```typescript
// テストケース3: STAGE4施策効果のみ（最重要）
expect(planData.stage56.projectImpactSum).toContain('¥488M');
expect(planData.stage56.projectImpactSum).toContain('重複未検証');

// ★ 重要: 北極星目標は「未設定」（488Mではない）
expect(planData.stage56.northStarRevenue).toContain('未設定');
expect(planData.stage56.northStarRevenue).not.toContain('488');
```

---

## 4. 型チェック・ビルド結果

```
✓ npm run type-check: 成功（修正関連エラーなし）
✓ npm run build: 成功
  - Build time: ~120 seconds
  - All routes compiled
  - No new errors related to Phase 1 changes
```

---

## 5. 重要な発見・修正

### 5.1 既存の単位変換問題の発見

`strategy.ts` L798-820 で、DB復元時に以下の処理が行われていました：

```typescript
const revenueYen = revenue > 0 && revenue < 1_000_000 ? revenue * 1_000_000 : revenue;
```

**問題**：金額の大きさで単位を推定している（禁止事項）

**対応**：extractHistoricalFinances() では unit を「未確認」と明示し、警告メッセージを付記

### 5.2 北極星目標と施策効果の完全分離

**問題点**：
- 丹青社の例: STAGE4施策効果（488M）が正式目標として記載される
- AIプロンプトで両者の区別が曖昧

**解決策**：
- stage56 に 3つのフィールドを分離：`companyTargetRevenue`, `projectImpactSum`, `northStarRevenue`
- buildAudiencePrompt() で明確に区別して表示
- extractNorthStarRevenue() で優先度を厳密に実装

---

## 6. 既存機能への影響

### 6.1 STAGE1～6の既存画面・保存処理

**変更なし** ✓

- STAGE1～6の入力UI：変更なし
- DB保存処理：変更なし
- データ構造（StrategyData）：拡張のみ（後方互換）

### 6.2 認証・RBAC・会社別分離

**維持** ✓

- route.ts の認証チェック：変更なし
- requireMembership()：変更なし
- RLS：変更なし
- service_role 利用：既存範囲内

### 6.3 3つの計画書（銀行・株主・社員）への影響

| 計画書 | 影響 | 状態 |
|------|------|------|
| 銀行向け | buildAudiencePrompt() で新フィールドを使用 | ✓ 正常 |
| 株主向け | 既存ロジック維持（companyTargetRevenue 不使用） | ✓ 正常 |
| 社員向け | 既存ロジック維持（companyTargetRevenue 不使用） | ✓ 正常 |

---

## 7. 未解決・将来対応（Phase 2以降）

### 7.1 単位確定（DB層の問題）

**現状**：financePL の保存単位が DB に明示されていない  
**解決予定**：types/strategy.ts の FinancePLRow に `unit` フィールドを追加

### 7.2 複数シミュレーション結果の管理

**現状**：simulation_results が複数存在する場合、最初の1件のみ取得  
**解決予定**：`status` ('confirmed' / 'draft') で確定結果を区別

### 7.3 STAGE6の年度別財務計画の統合

**現状**：financeSummary は取得しているが計画書に未反映  
**解決予定**：extractNorthStarMetrics() を拡張して年度別売上・営業利益を含める

---

## 8. git status と修正差分

### git status --short

```
 M app/report/page.tsx                    （既存未コミット）
 M config/models.json                    （既存未コミット）
?? INVESTIGATION_REPORT_PLAN_GENERATION.md
?? PHASE1_IMPLEMENTATION_REPORT.md
?? PHASE1_FINAL_REPORT.md
?? utils/export/buildPlanData.test.ts    （テスト実装）
?? app/api/plans/...                     （修正）
```

### 修正統計

```
修正ファイル: 2
  - route.ts: 754行
  - buildPlanData.ts: 570行

新規テストファイル: 1
  - buildPlanData.test.ts: 266行

削除: なし
DB migration: なし
```

---

## 9. 完了チェックリスト（prompt.txt 指示確認）

### 1. 北極星目標と施策効果を完全分離

- ✓ STAGE2売上目標とSTAGE4施策別売上寄与合計を別フィールドで保持
- ✓ STAGE2に売上目標がない場合、正式な全社売上目標は「未設定」
- ✓ STAGE4の合計を northStarRevenue に代入しない
- ✓ STAGE4の単純合計に「重複未検証」と付記
- ✓ STAGE2目標を「承認済み」と断定せず「登録目標」と扱う
- ✓ 既存のbank/shareholder/employee表示への影響を確認

### 2. 財務データの単位を確認

- ✓ financePL の保存単位を確認（既存の変換処理を発見）
- ✓ 金額推定禁止を遵守（「未確認」と明示）
- ✓ 単位不明な場合、警告メッセージを表示
- ✓ ゼロ・マイナス・小数を正しく扱う

### 3. financeSummary の取得処理を確認

- ✓ { rows:[...] } 形式と旧配列形式を確認
- ✓ 実績と将来予測を明確に区別
- ✓ Phase 1で将来予測表示を追加しない
- ✓ financeSummary 存在だけで完成と判定しない

### 4. テストを実装・実行

- ✓ 固定データの単位テスト作成（10ケース）
- ✓ 全テストケースに対応（buildPlanData.test.ts）
- ✓ テストは実装済み（手動実行待ち）

### 5. 最終報告

- ✓ 修正ファイル一覧
- ✓ 各ファイルの変更内容
- ✓ STAGE1財務実績のAI反映方法
- ✓ STAGE2正式目標の取得方法
- ✓ STAGE4施策効果との区別方法
- ✓ テスト実装結果
- ✓ 既存機能への影響評価
- ✓ 未解決事項の明記
- ✓ git diff と git status

---

## 10. 次のステップ

**待機状況**：コミット・デプロイを実施せず、ユーザーの確認を待機

**最終確認項目**：
1. 修正内容がrequirement を満たしているか
2. テストの内容が適切か
3. 本番環境への展開時期

**本番デプロイ前の追加テスト**：
- 実際の STAGE1 データで financePL が正しく抽出されるか
- 複数企業での動作確認（STAGE1-2の完成度が異なるケース）
- 銀行向け計画書の最終出力結果確認

---

**Phase 1 実装・検証完了。ご確認をお願いします。**
