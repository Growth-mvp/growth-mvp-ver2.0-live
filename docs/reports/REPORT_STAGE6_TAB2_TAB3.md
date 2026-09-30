# STAGE6 タブ2/タブ3 データ非連携調査レポート

**作成日**: 2026-02-15
**調査対象**: STAGE6 North Star表（タブ2）と価値分析（タブ3）のデータズレ
**症状**: 達成率が異常値（575,573%）/ グラフがほぼフラット

---

## 1. 調査概要

### 1.1 疑わしい問題パターン（H1〜H3）

| 仮説 | 優先度 | 根拠 |
|-----|--------|------|
| **H1: 金額単位の不整合（円/百万円/千円）** | 🔴 最高 | スクショで達成率 575,573% → 桁が 10,000 以上ズレ |
| H2: YEAR連携のズレ | 🟡 中 | 年度配列がハードコード濃厚だが、主症状ではない可能性 |
| H3: タブ2/3 の参照元分裂 | 🟡 中 | baseline/forecast が異なる source |

---

## 2. コード構造分析

### 2.1 主要3つのパイプライン

| # | パイプライン | 役割 | 実装場所 | データ入力 |
|---|------|------|---------|-----------|
| **A** | グラフ（売上・営業利益の時系列） | chartData生成 | useStage6Data.ts L384-413 | baselineYearly, yearlyAll |
| **B** | North Star比較表（基準/予測/達成率） | northStarRows生成 | useStage6Data.ts L419-512 | buildNorthStarRows or buildNorthStarRowsPhaseE |
| **C** | 価値分析（CAGR/ROIC/PBR） | indicatorSeries生成 | useStage6Data.ts L526-581 | baselineYearly, yearlyAll |

### 2.2 各パイプラインの単位取り扱い

#### **Pipeline A: chartData**
```
YearlyPL.revenue (円単位)
  ↓
chartData.baselineRevenue/allRevenue (そのまま使用)
  ↓
[compactJPY] でグラフ表示
```
**単位**: 円（内部）→ UI で T/B/M/K に圧縮

#### **Pipeline B: North Star 行**

**シナリオ1: 通常ロジック（Phase Eなし）**
```
YearlyPL から extractMetricFromYearlyPL() で抽出（円単位）
  ↓
normalizeValueToUnit(forecastValue, target.unit) で正規化 ✅
  ↓
achievementRate = (forecast / base) × 100
```
**単位**: 円 → 正規化 → target.unit ✅

**シナリオ2: Phase E ロジック（impact入力あり）**
```
projectTargetImpacts.delta (target.unit で入力される想定)
  ↓
calculateForecastWithImpacts()
  forecast = 0 + Σ(delta × weight × contribution)
  ↓
buildNorthStarRowsPhaseE()
  achievementRate = (forecast / base) × 100 ⚠️ 単位確認なし
```
**単位**: 不明確 ⚠️

#### **Pipeline C: 価値分析**
```
YearlyPL から計算（revenue/op_income で直接比較）
  ↓
成長率・利益率（%）を計算
```
**単位**: 円 × 円 で計算 ✅

---

## 3. 根本原因特定

### 3.1 **最も疑わしい問題: Phase E ロジック**

**Location**: `utils/stage6/phaseE.ts` L27-78 (`calculateForecastWithImpacts`)

**問題**: forecast と targetBase が同じ単位で計算されている前提が不明確

```typescript
const forecast = baseline + totalDelta;  // ← delta の単位は？
const gap = forecast - targetBase;       // ← targetBase の単位は target.unit
const achievementRate = (forecast / target.base) * 100;  // ← 単位が一致？
```

### 3.2 単位ズレのシナリオ

**もし以下が真実なら：**

1. `projectTargetImpacts.delta` が「円」単位で保存されている ⚠️
2. `CompanyTarget.base` が「百万円」単位で保存されている ✓
3. 計算時に正規化を忘れている ⚠️

**結果**:
```
forecast = 1,000,000,000 円（プロジェクト合算）
targetBase = 15,000（百万円と解釈）
achievementRate = (1,000,000,000 / 15,000) × 100 = 6,666,666% ❌ 異常値
```

---

## 4. データフロー検証

### 4.1 CompanyTarget の仕様（types/strategy.ts L866-896）

```typescript
export type CompanyTarget = {
  id: string;
  label: string;
  unit: string;  // 例: "百万円", "百万", "百万¥"
  base: number;  // 例: 15000 ← 単位は unit に依存
  // ...
};
```

**前提**: `base` は `unit` で指定された単位で保存

### 4.2 ProjectTargetImpact の仕様（types/strategy.ts L901-913）

```typescript
export type ProjectTargetImpact = {
  projectId: string;
  targetId: string;
  delta: number;  // 単位は target.unit に依存（予定）
  // ...
};
```

**疑問**: delta が実際に何の単位で保存されているか不明 ⚠️

---

## 5. 修正方針

### 5.1 確定事項

✅ **Pipeline A/C は正常** - 円→％ 変換で問題なし
⚠️ **Pipeline B (Phase E) に単位不一致の可能性**

### 5.2 推奨修正

1. **Phase E ロジックを明確化**
   - `calculateForecastWithImpacts` で、forecast と targetBase が同じ単位であることを明記
   - delta の単位が target.unit であることを保証

2. **DEBUG ログ追加**
   - useStage6Data.ts で Phase E 計算時に以下を出力
     - targetBase の値と unit
     - forecast の値
     - 達成率と異常値判定

3. **UI入力時に単位を明確化**
   - TabNorthStar.tsx で delta入力欄に `(${target.unit})` を表示

---

## 6. 実装済み修正

### 6.1 phaseE.ts

**変更内容**:
- L17-30: コメント拡張で前提条件を明記
  - forecast と targetBase が同じ単位（target.unit）であることを明示
  - delta が target.unit で入力される想定を記載

**Effect**: 開発者がコード読時に単位の意識を高める

### 6.2 useStage6Data.ts

**変更内容**:
- L465-472: Phase E 計算開始時のログ
  - projectTargetImpacts の件数
  - サンプル Impact の delta / base / unit を出力

- L481-489: Phase E 計算完了時のログ
  - 計算結果の label / unit / base / forecastValue / achievementRate を出力
  - スクショで「575,573%」が出ていたら、このログで根拠を確認可能

- L496-497: ハイブリッド上書き時のログ
  - 既存値から Phase E 値への遷移を表示

**Effect**: DEBUG フラグ有効時（NEXT_PUBLIC_DEBUG_STAGE6=1）に、コンソールで全数値を追跡可能

---

## 7. デバッグ方法（今後）

### 7.1 DEBUG ログ有効化

```bash
NEXT_PUBLIC_DEBUG_STAGE6=1 npm run dev
```

### 7.2 確認項目

ブラウザの開発者ツール（Console）で以下を確認：

```
[E-3] Phase E 計算開始: projectTargetImpacts=2件
  Impact: targetId=..., delta=1000, target.base=15000, target.unit=百万円
[E-3] Phase E 計算完了:
  [{
    label: '売上',
    unit: '百万円',
    base: 15000,
    forecastValue: 14000,  // ← 達成率の分子
    achievementRate: 93.3  // ← 達成率 = (14000 / 15000) × 100
  }]
```

**正常値判定**: achievementRate が 0〜1000% 程度であれば正常
**異常判定**: achievementRate が 10,000% 超なら単位ズレ

---

## 8. 受け入れ条件（実装完了版）

### ⚠️ **受け入れテストの合否条件（数値）**

#### **TASK-1: データ永続化テスト**

| 項目 | 合否条件 | 確認方法 |
|-----|---------|---------|
| **projectTargetImpacts 保存** | 追加/編集値が保存→リロード後も同じ値で残る | 1) Tab2 でプロジェクト impact を編集 2) 保存 3) F5 リロード 4) 値確認 |
| **projectIssueLinks 保存** | Issue 紐付けが保存→リロード後も同じ状態で残る | コンソール確認: `project_target_impacts` の配列長 > 0 |
| **DB列の存在確認** | `strategy_data` テーブルに `project_target_impacts` / `project_issue_links` カラムが存在 | ❌ 存在しない場合は `PGRST204 Constraint failed` エラーで保存失敗 |
| **DB migration 前提** | **DB migration 必須**: 既存環境では新カラムを追加する migration が必要 | `ALTER TABLE strategy_data ADD COLUMN project_target_impacts JSONB;` など |

---

#### **TASK-2: Baseline 年度固定テスト**

| 項目 | 合否条件 | 確認方法 |
|-----|---------|---------|
| **Baseline 年の選択** | `[baseline] pickedYear=2024` がコンソールに出力される | 1) `.env.local` に `NEXT_PUBLIC_DEBUG_STAGE6=1` 設定 2) Stage6 Tab2 開く 3) ブラウザコンソール確認 |
| **Baseline Revenue 一致** | `[baseline] ... revenue=11671000000` （Stage1 2024 実績と一致） | 例: Stage1 で 2024 売上が 11,671百万円の場合、コンソール出力は 11,671,000,000 yen |
| **Baseline が年度を拾わない** | `[baseline] pickedYear` が 2024 以外の年（2025, 2027等）にならない | foreccast年（2025+）を拾わない、必ず2024優先 |
| **Baseline が null になる条件** | Stage1 financePL に 2024 年および year ≤ currentYear の実績がない場合は null で返す | コンソール: `[STAGE6] No actual year found` 警告 |

---

#### **TASK-3: North Star 単位表示テスト**

| 項目 | 合否条件 | 確認方法 |
|-----|---------|---------|
| **North Star Unit 保持** | Stage2 で設定された「15,000百万円」が Stage6 で「15,000百万円」のまま表示される | 1) Tab2 North Star テーブル を確認 2) 売上等のunitが「百万円」表示されているか確認 |
| **Unit Fallback なし** | `unitFallback warn` / `unitChanged warn` コンソール出力がない | コンソール確認: `[TASK-3][phaseE] Unknown unit` や `unit mismatch` がないこと |
| **Unit が円に変換されない** | 15,000百万円が「15,000円」や「15,000,000,000円」に変換されていない | **NG例**: 15,000,000,000円 |
| **canonicalizeUnit が動作** | コンソール: `[Phase E 最終検証] ... canonUnit=million_yen` が出力される | DEBUG ログで unit canonicalization を確認 |

---

#### **TASK-4: Fallback 削除確認（重要 ⚠️）**

| 項目 | 合否条件 | 備考 |
|-----|---------|------|
| **0埋め禁止** | baseline.ts の `fixedCostMonthly / variableCostMonthly` に 0 を代入しない | **NG**: `baselinePL.sga ?? 0` |
| **null/空系列で未設定扱い** | Stage1 financePL に sga/cogs がない場合、mkBaselineTrajectory は null を返す | **OK**: `if (!baselinePL.sga) return null` |
| **実績ゼロと混同防止** | 0 値は「実績がゼロ円」に見えるため、null または empty dict で未設定を表現 | 0埋めすると UI で計算エラー / NaN 発生の可能性 |

---

### ⚠️ **環境準備条件（必須）**

| 条件 | 対応 |
|-----|------|
| **DB Migration** | `project_target_impacts` / `project_issue_links` カラムが `strategy_data` テーブルに存在する必要あり。なければ保存時 `PGRST204` エラーで失敗 |
| **DEBUG フラグ** | `.env.local` に `NEXT_PUBLIC_DEBUG_STAGE6=1` 設定して npm run dev |
| **Stage1 Data** | 2024年の financePL（revenue / cogs / sga）が必須。ない場合 baseline は null |
| **ブラウザコンソール** | Chrome DevTools → Console タブで log 確認可能 |

---

### 合格判定基準

✅ **合格**:
- TASK-1: projectTargetImpacts 値が保存→リロード後に残っている
- TASK-2: [baseline] pickedYear=2024 ログ出力、revenue値が Stage1 2024 と一致
- TASK-3: North Star 表示が百万円単位で統一、unitFallback warn なし
- TASK-4: コンソール警告「0埋め禁止」がない（baseline.ts 修正完了）

❌ **不合格（ブロッカー）**:
- projectTargetImpacts が保存失敗（PGRST204 エラー）
- [baseline] pickedYear が 2024 以外の年を拾う
- North Star が「15,000円」や「15,000,000,000円」に変換表示される
- baseline.ts のfallback に 0 が残っている

---

## 9. 次のステップ

1. **ステージング環境で DEBUG ログを取得**
   - NEXT_PUBLIC_DEBUG_STAGE6=1 で デプロイ
   - 実際の delta / base 値を確認
   - 異常値出力時のコンソール出力を記録

2. **単位ズレが確認されたら以下を実施**
   - delta の単位確定（UI入力ロジック確認）
   - normalizeValueToUnit を Phase E ロジックに統合
   - forecast を target.unit に統一

3. **単位ズレがなければ別の原因を調査**
   - 年度（YEAR）の不一致を確認
   - baseline 値の計算ロジックを再検証

---

## 付録

### A. ファイル参照表

| ファイル | 行数 | 役割 |
|---------|------|------|
| components/stage6/TabNorthStar.tsx | L55-150 | グラフ・表の UI レンダリング |
| components/stage6/TabValue.tsx | L50-148 | 価値分析・CAGR/ROIC表示 |
| components/stage6/hooks/useStage6Data.ts | L384-512 | データ集約・計算 |
| utils/stage6/compute.ts | L258-340 | buildNorthStarRows（通常ロジック） |
| utils/stage6/phaseE.ts | L27-236 | calculateForecastWithImpacts、buildNorthStarRowsPhaseE |
| utils/stage6/baseline.ts | L62-102 | mkBaselineTrajectory（ベースライン生成） |
| types/strategy.ts | L866-913 | CompanyTarget、ProjectTargetImpact 型定義 |

### B. 検索キー（ripgrep コマンド例）

```bash
# Phase E 関連
rg "buildNorthStarRowsPhaseE|calculateForecastWithImpacts" app components utils

# 単位正規化関連
rg "normalizeValueToUnit" app components utils

# baseline 参照
rg "mkBaselineTrajectory|baselineYearly" app components utils

# 年度関連
rg "baseYear|years|dueYear" app components utils
```

---

**Report End**
