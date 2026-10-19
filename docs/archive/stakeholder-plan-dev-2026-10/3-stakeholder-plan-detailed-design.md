# Growth MVP v2.0 - ステークホルダー別経営計画書生成機能
## 詳細設計案（3種類同時対応）

**作成日**: 2026-10-18  
**ステータス**: 設計案（実装前）  
**スコープ**: 銀行向け・株主向け・社員向けの3種類計画書自動生成機能

---

## 1. 基本アーキテクチャ

### 1.1 システム全体像

```
┌─────────────────────────────────────────────────────────────┐
│ フロントエンド                                                  │
├─────────────────────────────────────────────────────────────┤
│ /app/report/[audience]-plan/page.tsx (3種類の入口)            │
│  ├─ audience = 'bank' | 'shareholder' | 'employee'           │
│  └─ Dynamic routing: /report/bank-plan, /report/shareholder-plan, etc │
└──────────────────┬──────────────────────────────────────────┘
                   │ useEffect
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ データ取得・正規化レイヤー                                        │
├─────────────────────────────────────────────────────────────┤
│ getFullStrategyDataByCompany(companyId)                      │
│  ↓ (認証・RLS適用)                                             │
│ buildPlanData(state, audience)                               │
│  ↓ (audience別カスタマイズ)                                    │
│ validatePlanData(data, audience)                             │
│  ↓ (数値検証・不足情報チェック)                                 │
│ PlanData型（共通型）                                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ↓                     ↓
┌──────────────────┐  ┌──────────────────┐
│ プレビューレイヤー │  │ PDF出力レイヤー  │
├──────────────────┤  ├──────────────────┤
│ PlanPreview      │  │ downloadPlanPdf  │
│  (audience可変)   │  │  (audience別)    │
│                  │  │                  │
│ - 条件付き       │  │ 1. html2canvas  │
│   レンダリング   │  │ 2. jsPDF        │
│ - AudienceVariant│  │ 3. ファイル名生成│
│   コンポーネント │  │ 4. ダウンロード  │
└──────────────────┘  └──────────────────┘
```

### 1.2 既存システム保護の方針

- **読み取り専用**: STAGE1-6の既存データは変更しない
- **分離保存**: 生成結果は新規フィールド (`generated_business_plans`) に保存
- **フォールバックなし**: 計画書AI失敗時は「生成失敗」と表示（既存PDF統合は採用しない）
- **監査ログ**: 機密本文は記録しない（スカラー値・メタデータのみ）

---

## 2. 画面構成（UI設計）

### 2.1 ページ構成

```
/report/bank-plan
/report/shareholder-plan
/report/employee-plan

各ページ共通構成:
┌────────────────────────────────────────────┐
│ ツールバー                                  │
│ ├─ Back ボタン                              │
│ ├─ 計画書種別（読み取り専用）               │
│ ├─ 最終生成日時                            │
│ ├─ 検証状態インジケータ                    │
│ └─ PDF Download ボタン                      │
├────────────────────────────────────────────┤
│ バリデーションパネル                       │
│ ├─ 検証結果サマリー（OK/警告/エラー）      │
│ ├─ 不足情報リスト                         │
│ └─ 入力誘導リンク                         │
├────────────────────────────────────────────┤
│ プレビューコンテンツ                       │
│ ├─ 表紙                                    │
│ ├─ 第1章～第6章（audience別構成）         │
│ ├─ 附属資料（オプション）                 │
│ └─ 索引                                    │
├────────────────────────────────────────────┤
│ 生成管理パネル                             │
│ ├─ 「計画書を再生成」ボタン                │
│ ├─ 生成ログ・変更履歴                      │
│ └─ 承認ワークフロー（銀行向けのみ）       │
└────────────────────────────────────────────┘
```

### 2.2 Audience別ツールバーの違い

| 項目 | 銀行向け | 株主向け | 社員向け |
|-----|---------|--------|--------|
| **承認ボタン** | ✓（CFO署名） | ✗ | ✗ |
| **公開範囲** | 「社外秘」 | 「公開情報」 | 「社内秘密」 |
| **版管理** | v1.0 / v1.1 表示 | 最新版のみ | 最新版のみ |
| **出力形式** | PDF/Word選択 | PDF/Excel選択 | PDF/Slack共有 |

---

## 3. 章構成（Content Design）

### 3.1 銀行向け経営改善・事業計画書（全7章）

```
【表紙】
  ロゴ + 「経営改善計画書」
  融資額・期間・利率枠

【第1章：経営課題と分析（STAGE1-2）】
  1.1 企業概要・事業ポートフォリオ
  1.2 財務現況分析（CAGR・利益率・ROIC）
  1.3 経営課題と悪化要因分析（SWOT+論点）
  1.4 競合環境・ベンチマーク

【第2章：経営改善戦略（STAGE2-3）】
  2.1 成長戦略・勝ち筋
  2.2 利益向上・効率化施策
  2.3 部門別推進体制

【第3章：具体的実行計画（STAGE3-4）】
  3.1 部門別重点施策（プロジェクト一覧）
  3.2 期待インパクト（売上・営業利益・投資額）
  3.3 実行マイルストーン・責任者

【第4章：財務予測・キャッシュフロー計画（STAGE6）】
  4.1 3年財務予測（PL・BS・CF）
  4.2 月次キャッシュフロー（Year 1詳細）
  4.3 運転資本・設備投資計画

【第5章：借入返済計画（STAGE4+6）】
  5.1 返済スケジュール（月次）
  5.2 DBR（Debt Service Coverage Ratio）分析
  5.3 キャッシュ余裕度シミュレーション

【第6章：リスク・前提条件（STAGE2-3）】
  6.1 事業リスク・対応策
  6.2 財務リスク（為替・金利・市場）
  6.3 計画の前提条件・感度分析

【第7章：融資判定資料】
  7.1 必要融資額・使途
  7.2 担保・保証人情報
  7.3 重要契約・シナリオ分析

【附属資料】
  - 試算根拠資料
  - CFO署名ページ
```

### 3.2 株主向け中期経営計画書（全6章）

```
【表紙】
  ロゴ + 「2024-2026 中期経営計画」
  IR向けロゴ・日付

【第1章：経営環境と戦略方向（STAGE1-2）】
  1.1 市場機会と競争環境（SWOT）
  1.2 成長戦略のコンセプト
  1.3 勝ち筋・ビジョン

【第2章：中期経営方針（STAGE2-3）】
  2.1 KPI目標（売上・営業利益・ROIC等）
  2.2 事業ポートフォリオ戦略
  2.3 経営資源配分方針

【第3章：事業戦略別実行計画（STAGE3-4）】
  3.1 成長事業・利益牽引事業の施策
  3.2 部門別の期待寄与度
  3.3 M&A・提携方針（該当時）

【第4章：中期財務目標・シナリオ（STAGE6）】
  4.1 3年売上・営業利益予測
  4.2 セグメント別売上構成
  4.3 ベースケース・上振れ/下振れシナリオ

【第5章：株主価値創造戦略（STAGE4-6）】
  5.1 ROE/ROIC改善への取り組み
  5.2 配当政策・EPS目標
  5.3 資本配分方針

【第6章：リスク・不確実性（STAGE2-3）】
  6.1 重要経営リスク
  6.2 外部環境への感度分析
  6.3 計画達成への経営体制

【附属資料】
  - 業界分析・ベンチマーク
  - 過去3年実績推移
  - IR説明資料
```

### 3.3 社員向け経営方針・実行計画書（全5章）

```
【表紙】
  会社ロゴ + 「私たちの2024年経営方針」
  親しみやすいデザイン

【第1章：経営方針（STAGE2）】
  1.1 ミッション・ビジョン・バリュー
  1.2 経営課題と解決方向
  1.3 CEO からのメッセージ

【第2章：全社目標と重点施策（STAGE2-3）】
  2.1 本年度の経営目標（3-5個）
  2.2 全社重点施策（わかりやすく）
  2.3 部門別の役割と期待成果

【第3章：あなたの部門の計画（STAGE3-4）】
  3.1 部門ミッション・目指す姿
  3.2 部門の重点施策（プロジェクト一覧）
  3.3 部門OKR と個人への期待

【第4章：個人目標と育成計画（STAGE4-5）】
  4.1 あなたのOKR（Cascade）
  4.2 必要スキルと育成計画
  4.3 メンター・支援チーム

【第5章：実行と進捗管理（STAGE5-6）】
  5.1 実行スケジュール・マイルストーン
  5.2 進捗管理方法（月次・四半期）
  5.3 課題があるときの相談先

【パーソナルセクション（ユーザー別）】
  - あなたの部門：{{department.name}}
  - あなたのマネージャー：{{manager.name}}
  - 関連部門（連携先）：{{relatedDepts.join(', ')}}
```

---

## 4. データフロー（技術設計）

### 4.1 リクエスト〜レスポンスフロー

```
Request
  ↓
/app/report/[audience]-plan/page.tsx
  ├─ audience = 'bank' | 'shareholder' | 'employee'
  ├─ useEffect でマウント時に getData() 実行
  └─ StrategyGuard で認証確認
    ↓
API呼び出し: GET /api/plans/[audience]/build
  ├─ 認証：getAuthUserIdFromBearer(req)
  ├─ 認可：requireMembership(userId, companyId)
  ├─ Company Scope：assertCompanyScopeByStrategyId()
  └─ RLS自動適用（Supabase client）
    ↓
DB読み取り（RLS適用）
  └─ getFullStrategyDataByCompany(companyId)
    ├─ strategy_data テーブル（全STAGE）
    ├─ progress_logs テーブル（STAGE5進捗）
    └─ growth_strategies テーブル（STAGE6シミュレーション）
    ↓
データ正規化レイヤー
  ├─ buildPlanData(state, audience)
  │  └─ audience別フィルタリング・抽出
  ├─ validatePlanData(data, audience)
  │  └─ 数値検証・不足チェック
  └─ PlanData型（共通型）
    ↓
API応答: PlanData + ValidationResult[]
    ↓
UI レンダリング
  ├─ ValidationPanel で検証結果表示
  ├─ PlanPreview で プレビュー表示（audience可変）
  └─ StagePdfExportButton で PDF出力ボタン表示
    ↓
PDF出力（ユーザークリック時）
  ├─ downloadPlanPdf(data, audience)
  ├─ html2canvas → jsPDF
  └─ ブラウザダウンロード
```

### 4.2 計画書生成の内部フロー

```
【Step 1: 抽出（Extract）】
Phase 1A: 共通データ抽出
  buildMidtermPlanData(state)
    → STAGE1-4 の全STAGE統合データ取得

Phase 1B: Audience別フィルタリング
  filterDataByAudience(midtermPlanData, audience)
    → 不要フィールド削除（コスト削減）
    → 秘匿情報マスク（銀行は返済計画非表示など）

【Step 2: 正規化（Normalize）】
Phase 2A: 数値統一
  normalizeUnits(data)
    → 通年・月次・年度の統一
    → 百万円・千円の統一
    → 成長率%・倍率の統一

Phase 2B: 日付統一
  normalizeDates(data)
    → 会計年度基準に統一
    → マイルストーン日付の検証

【Step 3: 検証（Validate）】
Phase 3A: API層検証
  validatePlanConsistency(data, audience)
    ├─ STAGE4 impactXXX vs STAGE6 forecast
    ├─ 部門売上二重計上チェック
    ├─ CF返済可能性チェック
    └─ 寄与確度妥当性チェック

Phase 3B: 不足情報チェック
  identifyMissingInfo(data, audience)
    ├─ audience別必須フィールド確認
    ├─ 未実装STAGE の判定
    └─ IncompleteInfo[] 生成

【Step 4: 構成生成（Structure）】
Phase 4A: 章立て決定
  determineSectionStructure(audience)
    → audience別テンプレート選択
    → 条件付きセクション決定

Phase 4B: セクション順序付け
  orderSections(audience, sections)
    → 章の依存関係確認
    → ページ分割ポイント計算

【Step 5: コンポーネント化（Component）】
Phase 5A: AudienceVariant コンポーネント選択
  selectVariant(audience)
    ├─ BankPlanVariant
    ├─ ShareholderPlanVariant
    └─ EmployeePlanVariant

Phase 5B: セクションレンダリング
  renderSections(data, audience)
    ├─ 共通セクション（ReportLayout）
    └─ audience固有セクション（AudienceVariant）

【Step 6: PDF化（PDF Generation）】
Phase 6A: HTML確定
  finalizeHtml(componentHtml)
    → CSS印刷最適化
    → 画像インライン化

Phase 6B: Canvas変換
  html2canvas(elementId, options)
    ├─ scale: 2
    ├─ useCORS: true
    └─ 複数ページ分割

Phase 6C: PDF生成
  jsPDF(orientation, unit, format)
    ├─ A4縦・複数ページ
    └─ margin統一

【Step 7: ダウンロード（Download）】
Phase 7A: ファイル名生成
  generatePdfFileName(data, audience)
    → GROWTH_{audience}_{companyName}_{YYYYMMDD}.pdf

Phase 7B: ユーザーダウンロード
  pdf.save(fileName)
```

---

## 5. 再利用コード一覧

### 5.1 そのまま再利用可能（変更不要）

| コンポーネント | ファイルパス | 用途 | 再利用率 |
|------------|-----------|------|--------|
| `buildMidtermPlanData()` | `/utils/export/buildMidtermPlanData.ts` | STAGE1-4統合データ抽出 | 100% |
| `ReportLayout.tsx` | `/components/export/ReportLayout.tsx` | PDF共通スタイル | 100% |
| `downloadPdfFromElement()` | `/utils/export/downloadPdf.ts` | HTML→PDF変換 | 100% |
| `generatePdfFileName()` | `/utils/export/downloadPdf.ts` | ファイル名生成 | 100% |
| `formatDateForFileName()` | `/utils/dateUtils.ts` (推定) | 日付フォーマット | 100% |
| `StagePdfExportButton.tsx` | `/components/export/StagePdfExportButton.tsx` | PDF出力ボタン | 100% |
| `strategyStore.getState()` | `/store/strategyStore.ts` | 全STAGE状態取得 | 100% |
| `getFullStrategyDataByCompany()` | `/utils/supabase/strategy.ts` | API統合データ取得 | 100% |
| `requireMembership()` | `/lib/server/rbacGuard.ts` | 認可チェック | 100% |
| `assertMinRole()` | `/lib/server/rbacGuard.ts` | 権限チェック | 100% |

### 5.2 カスタマイズで再利用可能（一部修正）

| コンポーネント | ファイルパス | 修正内容 | 再利用率 |
|------------|-----------|--------|--------|
| `buildStage1ReportData()` | `/utils/export/buildStage1ReportData.ts` | audience別フィルタリング追加 | 80% |
| `buildStage2ReportData()` | `/utils/export/buildStage2ReportData.ts` | audience別ハイライト切り替え | 80% |
| `buildStage3ReportData()` | `/utils/export/buildStage3ReportData.ts` | 部門データのfeature別抽出 | 80% |
| `buildStage4ReportData()` | `/utils/export/buildStage4ReportData.ts` | audience別インパクト詳細度 | 80% |
| `MidtermPlanPreview.tsx` | `/components/export/MidtermPlanPreview.tsx` | audience条件付きレンダリング | 75% |
| `useAutoSave()` | `/hooks/useAutoSave.ts` | 計画書生成結果の保存処理追加 | 85% |

### 5.3 新規実装が必要（新規作成）

| コンポーネント | ファイルパス | 機能 | 工数 |
|------------|-----------|------|------|
| `buildPlanData()` | `/utils/export/buildPlanData.ts` (新) | audience統合ビルダー | 3-5日 |
| `PlanPreview.tsx` | `/components/export/PlanPreview.tsx` (新) | audience可変プレビュー | 2-3日 |
| `BankPlanVariant.tsx` | `/components/export/BankPlanVariant.tsx` (新) | 銀行向け固有セクション | 3-4日 |
| `ShareholderPlanVariant.tsx` | `/components/export/ShareholderPlanVariant.tsx` (新) | 株主向け固有セクション | 3-4日 |
| `EmployeePlanVariant.tsx` | `/components/export/EmployeePlanVariant.tsx` (新) | 社員向け固有セクション | 3-4日 |
| `ValidationPanel.tsx` | `/components/export/ValidationPanel.tsx` (新) | 検証結果表示パネル | 2-3日 |
| `IncompleteSection.tsx` | `/components/export/IncompleteSection.tsx` (新) | 不足情報表示 | 1-2日 |
| `/api/plans/[audience]/build` | `/app/api/plans/[audience]/route.ts` (新) | 計画書API | 5-7日 |
| `/api/validate/plan-consistency` | `/app/api/validate/plan-consistency/route.ts` (新) | 検証API | 3-5日 |
| `usePlanPdfExport()` | `/hooks/usePlanPdfExport.ts` (新) | audience別PDF出力フック | 2-3日 |
| `validatePlanData.ts` | `/utils/validation/validatePlanData.ts` (新) | 計画書検証ロジック | 5-7日 |
| `planDataValidators.ts` | `/utils/validation/planDataValidators.ts` (新) | 検証ロジック集合 | 3-5日 |

---

## 6. 追加ファイル一覧（新規作成予定）

### 6.1 ページ・ルート

```
新規ファイル:
  /app/report/bank-plan/page.tsx           (銀行向けページ)
  /app/report/shareholder-plan/page.tsx    (株主向けページ)
  /app/report/employee-plan/page.tsx       (社員向けページ)
  /app/api/plans/[audience]/route.ts       (計画書生成API)
  /app/api/validate/plan-consistency/route.ts (検証API)
```

### 6.2 コンポーネント

```
新規作成:
  /components/export/PlanPreview.tsx
  /components/export/BankPlanVariant.tsx
  /components/export/ShareholderPlanVariant.tsx
  /components/export/EmployeePlanVariant.tsx
  /components/export/ValidationPanel.tsx
  /components/export/IncompleteSection.tsx
  /components/export/SectionRenderer.tsx
  /components/export/PdfOptionsModal.tsx
```

### 6.3 ユーティリティ

```
新規作成:
  /utils/export/buildPlanData.ts
  /utils/export/downloadPlanPdf.ts
  /utils/validation/validatePlanData.ts
  /utils/validation/impactValidator.ts
  /utils/validation/unitValidator.ts
  /utils/validation/segmentValidator.ts
  /utils/validation/dateValidator.ts
  /utils/validation/cashFlowValidator.ts
  /utils/export/planDataTransform.ts
  /utils/export/audienceDataFilter.ts
```

### 6.4 フック

```
新規作成:
  /hooks/usePlanPdfExport.ts
  /hooks/usePlanValidation.ts
  /hooks/usePlanPreview.ts
  /hooks/usePlanData.ts
```

### 6.5 型定義

```
修正・拡張:
  /types/strategy.ts
    → 新型追加: PlanData, ValidationResult, IncompleteInfo, AudienceType
```

---

## 7. 実装フェーズ（段階的実装計画）

### Phase 0: 準備（1週）

**目標**: 基本アーキテクチャと共通部分の準備

| 作業 | 期間 | 成果物 |
|------|------|--------|
| API仕様書作成 | 2日 | `/api/plans/[audience]/route.ts` の入出力仕様 |
| データ型定義 | 1日 | PlanData, ValidationResult 等の TypeScript型 |
| テンプレート用CSS | 2日 | audience別のスタイル定義 |
| 既存コード確認 | 2日 | 再利用可能コンポーネントの検証 |

**完成チェック**:
- ✓ PlanData型が確定
- ✓ API仕様書が承認済み
- ✓ CSS基盤が整備済み

---

### Phase 1: 共通基盤実装（2週）

**目標**: 全3種類で使用する共通コンポーネント・ロジック

| 作業 | 期間 | ファイル | 再利用性 |
|------|------|--------|--------|
| `buildPlanData()` | 3-5日 | `/utils/export/buildPlanData.ts` | ★★★★★ |
| 検証ロジック（5モジュール） | 5-7日 | `/utils/validation/*` | ★★★★★ |
| `ValidationPanel` コンポーネント | 2-3日 | `/components/export/ValidationPanel.tsx` | ★★★★★ |
| `IncompleteSection` コンポーネント | 1-2日 | `/components/export/IncompleteSection.tsx` | ★★★★★ |
| 検証API実装 | 3-5日 | `/app/api/validate/plan-consistency/route.ts` | ★★★★ |
| `usePlanValidation` フック | 2-3日 | `/hooks/usePlanValidation.ts` | ★★★★ |

**完成チェック**:
- ✓ buildPlanData() が全3種類対応
- ✓ 検証ロジックが動作確認済み
- ✓ API テストが通過

---

### Phase 2A: 銀行向け計画書実装（2週）

**目標**: 銀行向け計画書の全機能実装

| 作業 | 期間 | ファイル |
|------|------|--------|
| ページ実装 | 2-3日 | `/app/report/bank-plan/page.tsx` |
| `BankPlanVariant` | 3-4日 | `/components/export/BankPlanVariant.tsx` |
| 計画書API | 3-5日 | `/app/api/plans/bank/route.ts` |
| PDF出力フック | 2-3日 | `/hooks/usePlanPdfExport.ts` |
| テスト・微調整 | 2-3日 | 画面表示・PDF生成確認 |

**完成チェック**:
- ✓ 銀行向けページが表示可
- ✓ PDF出力可能
- ✓ 検証パネルが機能

---

### Phase 2B: 株主向け計画書実装（2週）（Phase 2A と並行可）

**目標**: 株主向け計画書の全機能実装

| 作業 | 期間 | ファイル |
|------|------|--------|
| ページ実装 | 2-3日 | `/app/report/shareholder-plan/page.tsx` |
| `ShareholderPlanVariant` | 3-4日 | `/components/export/ShareholderPlanVariant.tsx` |
| 計画書API | 2-3日 | `/app/api/plans/shareholder/route.ts` |
| テスト・微調整 | 2-3日 | 画面表示・PDF生成確認 |

**完成チェック**:
- ✓ 株主向けページが表示可
- ✓ PDF出力可能
- ✓ IR資料フォーマット確認

---

### Phase 2C: 社員向け計画書実装（2週）（Phase 2A/2B と並行可）

**目標**: 社員向け計画書の全機能実装

| 作業 | 期間 | ファイル |
|------|------|--------|
| ページ実装 | 2-3日 | `/app/report/employee-plan/page.tsx` |
| `EmployeePlanVariant` | 3-4日 | `/components/export/EmployeePlanVariant.tsx` |
| パーソナルセクション機能 | 2-3日 | ユーザー別カスタマイズ |
| テスト・微調整 | 2-3日 | 個人別表示・PDF生成確認 |

**完成チェック**:
- ✓ 社員向けページが表示可
- ✓ ユーザー別カスタマイズ動作
- ✓ PDF出力可能

---

### Phase 3: 統合テスト・品質保証（1週）

**目標**: 全3種類の統合テスト・セキュリティ確認

| 作業 | 期間 | 確認内容 |
|------|------|--------|
| 機能テスト | 2日 | 全3種類のページ・API・PDF出力 |
| セキュリティテスト | 2日 | 他社データ混入防止・RLS確認 |
| パフォーマンステスト | 1日 | 大規模計画書（100p+）の動作 |
| ユーザビリティテスト | 1日 | 画面操作・ボタン配置確認 |

**完成チェック**:
- ✓ 全3種類の計画書が正常動作
- ✓ セキュリティ要件合致
- ✓ 100ページ以上対応確認

---

### Phase 4: デプロイ・運用準備（1週）

**目標**: 本番デプロイ・ドキュメント完成

| 作業 | 期間 | 成果物 |
|------|------|--------|
| 環境構築 | 2日 | Vercel デプロイ設定 |
| ドキュメント作成 | 2日 | ユーザーガイド・API仕様書 |
| 監視・ロギング設定 | 1日 | 生成失敗時のアラート |
| リリース準備 | 2日 | リリースノート・説明資料 |

**完成チェック**:
- ✓ 本番環境でデプロイ可能
- ✓ ドキュメント整備完了
- ✓ 運用体制確立

---

### 全体スケジュール

```
Week 1: Phase 0 (準備)
Week 2-3: Phase 1 (共通基盤) + Phase 2A 開始
Week 4-5: Phase 2B + Phase 2C 並行 + Phase 2A 完成
Week 6: Phase 3 (統合テスト)
Week 7: Phase 4 (デプロイ・運用準備)

総計：7週 ≈ 35営業日 ≈ 1.5ヶ月
```

---

## 8. 検証項目（テスト計画）

### 8.1 機能テスト

| 項目 | テスト内容 | 確認方法 |
|-----|----------|--------|
| **ページ表示** | 3種類のページが正常に表示される | ブラウザで各URL訪問 |
| **データ取得** | StrategyData が正常に読み込まれる | ネットワークタブで API応答確認 |
| **プレビュー表示** | 各audience別プレビューが表示される | 画面で6章構成確認 |
| **PDF出力** | 3種類のPDFが正常に生成される | ダウンロード・内容確認 |
| **検証パネル** | 警告・エラーが正常に表示される | 不足データ時の表示確認 |
| **不足情報表示** | 「このセクションは準備中」が表示される | STAGE6未実装時の表示確認 |
| **リンク動作** | 入力フォームへのリンクが機能する | リンククリック→別ページ遷移 |

### 8.2 セキュリティテスト

| 項目 | テスト内容 | 確認方法 |
|-----|----------|--------|
| **他社データ混入防止** | 別会社のStrategyIdでアクセス不可 | 他社companyId で 403 Forbidden確認 |
| **RLS適用確認** | DB層で company_id フィルタが動作 | Supabase RLS ポリシーで制限確認 |
| **権限チェック** | VIEWER権限では編集不可 | VIEWER→ 403 Forbidden確認 |
| **監査ログ記録** | 生成操作が audit_logs に記録される | DB audit_logs テーブル確認 |
| **機密データ非記録** | CEO意図などが audit_logs に記録されない | ログデータ確認・スカラー値のみ確認 |
| **プロンプトインジェクション** | 悪意のあるCEO意図でAI破壊なし | `checkSuspiciousKeywords()` 動作確認 |

### 8.3 パフォーマンステスト

| 項目 | テスト内容 | 目標 |
|-----|----------|------|
| **API応答時間** | 計画書データ取得 | < 3秒 |
| **PDF生成時間** | 50ページ PDF化 | < 10秒 |
| **PDF生成時間** | 100ページ PDF化 | < 20秒 |
| **メモリ使用量** | 100ページ Canvas→PDF | < 500MB |
| **DB クエリ時間** | getFullStrategyDataByCompany() | < 1秒 |

### 8.4 ユーザビリティテスト

| 項目 | テスト内容 | 確認方法 |
|-----|----------|--------|
| **ボタン配置** | PDF出力ボタンが見やすい位置 | UI/UXレビュー |
| **章構成の分かりやすさ** | 6章構成が理解しやすい | ユーザーヒアリング |
| **エラーメッセージ** | 不足情報メッセージが明確 | メッセージ内容確認 |
| **PDF品質** | フォント・レイアウトが適切 | PDF内容チェック |
| **レスポンシブ対応** | モバイル・タブレットで問題なし | 複数デバイスで確認 |

### 8.5 データ検証テスト

| 項目 | テスト内容 | 確認方法 |
|-----|----------|--------|
| **インパクト整合性** | STAGE4 vs STAGE6 売上が±15%以内 | 検証API で確認 |
| **売上二重計上防止** | 部門売上合計 ≤ 全社売上×1.05 | ValidationResult で確認 |
| **単位統一** | 月次合計 = 年間（±5%） | validateUnitConsistency() |
| **CF返済可能性** | 営業CF ≥ 利息返済額 | validateCashFlowCoverage() |
| **日付依存関係** | マイルストーン順序が矛盾なし | validateDependencies() |
| **寄与確度合計** | confidence 合計 が1.0超過なし | validateConfidenceSum() |

---

## 9. リスク管理

### 9.1 主要リスク

| リスク | 発生確率 | 影響度 | 対策 |
|------|--------|--------|------|
| **STAGE6未実装による機能不足** | 中 | 高 | 不足情報表示ルール事前策定 |
| **AI生成品質の不確実性** | 中 | 中 | 検証パネルで根拠不足を明示 |
| **大規模計画書PDF化失敗** | 低 | 中 | html2canvas制限対応・Lite版オプション |
| **他社データ混入** | 低 | 高 | RLS二重チェック・監査ログ監視 |
| **パフォーマンス低下** | 低 | 中 | 段階的実装・キャッシング検討 |
| **ユーザー混乱** | 中 | 低 | UI/UX テスト・ドキュメント充実 |

### 9.2 本番リリース前チェックリスト

- [ ] 全3種類の計画書が正常生成される
- [ ] セキュリティテスト合格（他社データ混入なし）
- [ ] パフォーマンステスト合格（応答時間基準達成）
- [ ] ドキュメント完成・レビュー済み
- [ ] 運用チームのトレーニング完了
- [ ] 不具合報告体制構築
- [ ] ロールバック計画策定

---

## 10. 今後の拡張予定（Phase 5+）

### Phase 5: 高度な機能拡張（2-3週）
- STAGE6 NPV/IRR/感度分析統合
- 返済計画スケジューリング機能
- マルチシナリオ自動生成（上振れ/下振れ）
- 部門別計画書自動展開

### Phase 6: ワークフロー・承認機能（2-3週）
- CFO署名プロセス
- 承認ワークフロー
- バージョン管理・変更履歴

### Phase 7: 外部連携（1-2週）
- Word/Excel出力オプション
- Slack/メール共有機能
- IR資料自動生成

---

## 付録：ファイル一覧（参考）

### 新規作成ファイル（17個）

```
ページ・ルート（3個）:
  1. /app/report/bank-plan/page.tsx
  2. /app/report/shareholder-plan/page.tsx
  3. /app/report/employee-plan/page.tsx

API（2個）:
  4. /app/api/plans/[audience]/route.ts
  5. /app/api/validate/plan-consistency/route.ts

コンポーネント（6個）:
  6. /components/export/PlanPreview.tsx
  7. /components/export/BankPlanVariant.tsx
  8. /components/export/ShareholderPlanVariant.tsx
  9. /components/export/EmployeePlanVariant.tsx
  10. /components/export/ValidationPanel.tsx
  11. /components/export/IncompleteSection.tsx

ユーティリティ（9個）:
  12. /utils/export/buildPlanData.ts
  13. /utils/export/downloadPlanPdf.ts
  14. /utils/validation/validatePlanData.ts
  15. /utils/validation/impactValidator.ts
  16. /utils/validation/unitValidator.ts
  17. /utils/validation/segmentValidator.ts

フック（3個）:
  18. /hooks/usePlanPdfExport.ts
  19. /hooks/usePlanValidation.ts
  20. /hooks/usePlanData.ts
```

### 修正・拡張ファイル（3個）

```
1. /types/strategy.ts (新型追加)
2. /models.json (新process key追加)
3. /lib/server/rbacGuard.ts (assertCompanyScopeByStrategyId確認)
```

---

**設計案作成完了**
本設計案は実装前のプロトタイプです。実装時にはさらなる詳細化・調整が必要です。
