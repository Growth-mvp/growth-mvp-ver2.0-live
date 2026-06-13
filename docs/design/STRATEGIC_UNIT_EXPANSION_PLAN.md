# 事業・部門別戦略（StrategicUnit）拡張計画

作成日: 2026-06-12
対象: STAGE1〜4（STAGEは増やさない／企業版一本／departments 後方互換維持）

本ドキュメントは、STEP4〜7の「実装案の整理」をまとめたもの。**いずれも本書時点では未実装**。
STEP2（文言変更）・STEP3（StrategicUnit型追加）は実装済み。

---

## 前提：現状構造（調査結果サマリー）

- `Department`（types/strategy.ts:1192〜）が STAGE3〜6 の戦略単位。`StrategyData.departments: Department[]` として Supabase `strategy_data.departments`（JSONB）に保存。
- normalize（utils/supabase/normalize.ts `normalizeDepartment`）は `{ ...obj }` スプレッドで未知フィールドを保持するため、**Department への任意フィールド追加は保存・復元を壊さない**。
- stable ID は `ensureDepartmentId(strategyId, dept)`（utils/supabase/stableIdGenerator.ts）が name ベースで決定的に生成。
- STAGE3 生成は `/api/generate-cascade`（DepartmentSchema / ProjectSchema）。
- STAGE4 は `createBaselineFromStage3(dept)` で departments のスナップショットから `stage4Plans` を構築。
- STAGE1 には既に `BusinessSegment`（types/strategy.ts:740〜）と `segmentPL/segmentBS`（csvFinanceData）があり、事業単位の入力の土台が存在する。
- STEP3 で追加済み: `StrategicUnitType` / `StrategicUnit` 型（types/strategy.ts）、`Department.unitType?`、変換ユーティリティ `utils/strategicUnit.ts`。

---

## STEP4：STAGE1 入力項目の拡張案（**2026-06-12 実装済み**）

> 実装結果: BusinessSegment に unitType / mainProductsServices / revenue / profit /
> currentIssues / expectedRoleInMidtermPlan / existingKpis（すべて optional）を追加。
> UI は BusinessSegmentsPanel の各セグメントカード内に折りたたみ
> 「事業・部門情報（中計用・任意）」として追加。STAGE3/4 への接続は未実施。

### 目的
中計対応のため、STAGE1 で事業・部門の基礎情報（名称・種別・売上・利益・課題・期待役割・既存KPI）を収集し、STAGE3 生成の入力にする。

### 方針：BusinessSegment を拡張する（新パネルは作らない）
既存の `BusinessSegment` が「名称・scope・summary・keyCustomers」を持つため、ここに任意フィールドを追加するのが最小・後方互換。

```ts
// types/strategy.ts — BusinessSegment への追加案（すべて optional）
export type BusinessSegment = {
  id: string;
  name: string;
  scope?: string;
  summary?: string;
  keyCustomers?: string[];
  // ▼ 追加候補
  unitType?: StrategicUnitType;     // 種別（事業部/機能部門/拠点/子会社/セグメント…）
  mainProducts?: string[];          // 主要製品・サービス
  revenueYen?: number;              // 売上（segmentPL があればそちら優先）
  profitYen?: number;               // 利益（同上）
  keyIssues?: string[];             // 主な課題
  expectedRoleInMidtermPlan?: string; // 中計で期待される役割
  existingKpis?: string[];          // 既存KPI
};
```

### 対象ファイル
| ファイル | 変更内容 |
|---|---|
| types/strategy.ts | BusinessSegment にフィールド追加（optional のみ） |
| components/stage1/BusinessSegmentsPanel.tsx | 入力UI追加（折りたたみ「中計向け詳細」セクション推奨） |
| utils/supabase/normalize.ts | 変更不要（スプレッド保持）。明示正規化するなら追加分の型ガードのみ |
| app/api/generate-cascade/route.ts | プロンプトへセグメント詳細を注入（STEP5と同時に） |

### 留意点
- 売上・利益は `csvFinanceData.segmentPL` と二重入力になり得る。**segmentPL があればそちらを正とし、手入力は補完扱い**にする。
- DB migration 不要（JSONB 内の追加のみ）。

---

## STEP5：STAGE3 生成プロンプト拡張案（**2026-06-12 実装済み**）

> 実装結果:
> - generate-cascade の部門ブロックに「★事業・部門情報（STAGE1中計入力）」を注入（値がある項目のみ）
> - 売上・利益は segmentPL 等の財務データ優先、無い場合のみ BusinessSegment.revenue/profit を参考値として使用（コードコメントで明示）
> - DepartmentSchema / Department 型 / 返却マッピング / cascade page の patch に
>   currentPosition / strategicRole / keyIssues / alignmentRiskPoints（すべて optional・default なし）を追加
> - cascade の AIたたき台サマリーに「事業・部門別戦略の観点」ブロックを追加（値がある場合のみ表示）
> - requiredCrossFunctionalSupport は既存 intraDeptCollab / interDeptCollab で代替（追加せず）

### 目的
各事業・部門ごとに「現在の位置づけ／中計上の役割／主要課題／戦略方向性／重点施策／KPI案／必要な連携／実行リスク／認識のズレポイント」を生成する。

### 現状とのマッピング
| 生成したい項目 | 既存スキーマの対応 | 拡張 |
|---|---|---|
| 現在の位置づけ | mission（currentRole 相当） | △ 明示フィールド `currentRole` 追加 |
| 中計上の役割 | missionDraft / missionDescription | △ `strategicRole` 追加 |
| 主要課題 | なし | ★ `currentIssues: string[]` 追加 |
| 戦略方向性 | strategy | ○ 既存 |
| 重点施策 | projects / lanes | ○ 既存 |
| KPI案 | projects[].okrs | ○ 既存（部門直下KPIは `kpis: string[]` 追加検討） |
| 必要な連携 | intraDeptCollab / interDeptCollab / needsCollab | ○ 既存 |
| 実行リスク | riskNotes | ○ 既存 |
| 認識のズレポイント | reviewSummary.reconsiderationPoints | △ 専用 `misalignmentRisks: string[]` 追加 |

### 安全な拡張手順
1. `app/api/generate-cascade/route.ts` の DepartmentSchema（107〜138行付近）に **optional フィールドのみ追加**（currentRole / strategicRole / currentIssues / kpis / misalignmentRisks）。
2. プロンプト本文に項目定義と STAGE1 セグメント詳細（STEP4）を注入。
3. `Department` 型（types/strategy.ts）に同名 optional フィールドを追加。normalize は変更不要。
4. UI（app/cascade/page.tsx の部門カード）に新項目の表示ブロックを追加。**欠損時は非表示**にし、旧データでも壊れないようにする。
5. `utils/strategicUnit.ts` の変換で新フィールドを StrategicUnit へマップ。

### リスク
- 生成トークン増による応答時間・コスト増 → 項目ごとに文字数上限をプロンプトで指定。
- LLM が新フィールドを返さないケース → スキーマ optional + UI 欠損許容で吸収。

---

## STEP6：STAGE4 KPI体系表示案（未実装）

### 目的
```
全社KPI
  ├─ 事業・部門KPI
  ├─ 重点施策KPI
  └─ 横断機能KPI
```

### 接続箇所
- データ源: `departments[].projects[].okrs / okrsV2`（事業・部門KPI／重点施策KPI）、`stage4Plans[].baseline.kpiTargets`。
- 全社KPI: STAGE1 の5指標（ValueAnalysis）と STAGE2 の勝ち筋から導出（既存データに「全社KPI」エンティティは無い）。
- 横断機能KPI: `unitType === 'function'`（または departmentType あり）の部門の KPI を分類表示。

### 最小実装案
1. **新規コンポーネント** `components/stage4/KpiTreeView.tsx`（読み取り専用ツリー）。データ変更なし・表示のみ。
2. 入力は `departmentsToStrategicUnits(departments)` + okrs の集計関数（utils に `buildKpiTree.ts` を新設）。
3. app/stage4/page.tsx にタブまたは折りたたみセクションとして追加（既存編集UIは触らない）。
4. 全社KPIは当面「STAGE1 5指標の現状値」を表示し、編集機能は持たせない。

### リスク
- okrs（レガシー）と okrsV2 の併存 → 集計関数で両対応（normalizeProject と同じ優先順位）。

---

## STEP7：中計戦略書プレビュー案（未実装）

### 構成（最小版）
1. 全社戦略の方向性 — STAGE2（story / winPatterns / strategy）
2. 事業・部門ごとの中計上の役割 — STAGE3 departments（strategicRole / mission）
3. 事業・部門別の重点戦略 — STAGE3 projects / lanes / first90Days
4. 横断機能部門の支援戦略 — unitType==='function' の部門の戦略・連携
5. KPI体系のたたき台 — STEP6 の KPIツリー
6. 経営会議で確認すべき論点 — reviewSummary / misalignmentRisks / riskNotes の集約

### 必要データ
すべて既存 `StrategyData`（+ STEP4/5 の拡張フィールド）で賄える。**新テーブル・migration 不要**。

### 配置場所・画面構成案
- 既存のレポート基盤（components/export/StrategyReportView.tsx + utils/export/buildStrategyReportData.ts + hooks/useStage3PdfExport.ts と同型）を流用。
- 新規: `utils/export/buildMidtermPlanData.ts` / `components/export/MidtermPlanPreview.tsx` / `hooks/useMidtermPlanPdfExport.ts`。
- 入口は STAGE4 ページまたはホームに「中計戦略書プレビュー」ボタン（新STAGEは作らない）。

---

## STEP6：STAGE2 全社戦略の中計対応（**2026-06-12 実装済み**）

> 実装結果:
> - `MidtermStrategy` 型（9項目・すべて optional）を新設し、`StrategyData.midtermStrategy?` / store に追加
> - **永続化**: FIELD_MAP 方式（トップレベル項目=DBカラム1対1）のため、新カラムを増やさず
>   `swot_suggestions`（JSONB）内に `midtermStrategy` キーとしてパック保存
>   （buildDbRowFromState でパック、normalize で展開。保存は常に全状態なので上書き消失なし）
> - **生成**: generate-final-story に独立した第2パスを追加（4章生成プロンプトは不変。
>   失敗時は midtermStrategy なしで従来応答 → 既存生成を壊さない）
> - **UI**: STAGE2 最終確定タブに「中計設計」折りたたみパネル（データがある場合のみ表示）。
>   表示名を「STAGE2：全社戦略」に変更、サブコピー追加
>
> ### STAGE3への接続方針（今回は接続せず・整理のみ）
> STAGE3 生成が将来参照すべき STAGE2 項目:
> `midtermConcept` / `priorityStrategicThemes` / `portfolioPolicy` /
> `companyWideDecisionCriteria` / `deploymentPrinciplesForUnits` / `managementMeetingIssues`
>
> 接続案（最小実装）:
> 1. app/cascade/page.tsx の generate-cascade リクエスト payload に `midtermStrategy` を追加
> 2. generate-cascade の ReqSchema に `midtermStrategy: z.any().optional()` を追加
> 3. メインプロンプトの【STAGE2 最終ストーリー】の直後に
>    「【全社の中計設計（判断基準・展開軸）】」ブロックとして注入（値がある項目のみ）
> 4. 各部門の strategicRole / keyIssues / alignmentRiskPoints（STEP5追加）の生成根拠として参照させる
>
> 今回接続を見送った理由: STEP5 で generate-cascade プロンプトを変更したばかりであり、
> 同一リリースで二重にプロンプトを動かすと品質劣化時の切り分けが困難になるため。
> 接続自体は上記 1〜4 のみで完結し、リスクは低い（次STEPで実施可能）。

## 推奨実装順序

1. **STEP4**: BusinessSegment 拡張（型 + STAGE1 UI）— 他STEPの入力になるため最初
2. **STEP5**: generate-cascade スキーマ/プロンプト拡張 + Department optional フィールド + cascade UI 表示
3. **STEP6**: buildKpiTree + KpiTreeView（読み取り専用）
4. **STEP7**: 中計戦略書プレビュー（レポート基盤流用）
5. 最後に LLM 系プロンプト内の「部門戦略」文言（openaiClient.ts / generate-cascade / generate-final-story / ask-ceo-agent / org-alignment insights）を生成品質検証付きで更新

## 共通リスク・注意点

- `strategy_data.departments`（JSONB）への **optional フィールド追加のみ**で進める限り、migration・後方互換問題は発生しない。
- `ensureDepartmentId` は name ベースの決定的ID。**部門名の変更はID変更を意味する**ため、StrategicUnit 化でも name を主キー的に扱う現行挙動を維持すること。
- normalizeDepartment の「projects 空なら lanes から復元」ガードは絶対に壊さない。
- ルーティングのキーワードリスト（intentRouter / autoModeRouter / retriever）は旧語「部門戦略」を**削除せず追加**で対応済み。今後も同方針。
