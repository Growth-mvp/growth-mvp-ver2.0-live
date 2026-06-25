# 04. ステージ別機能仕様（Stage 1〜6）

> ルートとステージ番号の対応（`components/Sidebar.tsx`）:
> Stage1=`/stage1`, Stage2=`/stage2`, **Stage3=`/cascade`**, **Stage4=`/okr`**, Stage5=`/execution`, Stage6=`/stage6`。
> `/stage3` は `/cascade` への互換リダイレクト。`/stage4` は旧実装が残置（後述）。`/strategy`・`/story-process`・`/review` も関連する補助/レガシー導線。

---

## Stage 1：企業価値分析（`/stage1`）

### 目的
財務データから企業価値の状態を定量化し、改善領域（論点）を抽出する。

### 入力
- 会社プロフィール（業種・規模・事業内容・顧客セグメント等）
- 会計・期間設定（決算期 `fiscalYearEnd`、通貨 `currency`、計画開始/終了年度）
- 全社 PL/BS（過去 2〜3 年、CSV インポート可）: `financePL[]` / `financeBS[]`
- 事業部別 PL/BS（任意）: `segmentPL{}` / `segmentBS{}`、本社調整 `hqAdjustmentPL/BS`
- 上場情報（`isListed` / `ticker` / `pbrManual`）
- 外部ベンチマーク（任意）: `stage1Benchmarks`

### 画面コンポーネント（`components/stage1/`）
`CompanyAndBusinessPanel` / `CompanyScopePanel` / `BusinessSegmentsPanel` / `FinanceInputPanel` / `FinanceDataPanel` / `FinanceYearEditorTable` / `ListingInfoPanel` / `WaccPanel` / `MetricsPanel` / `IssueBlockPanel` / `Stage1BenchmarkPanel` / `DocumentImportPanel` / `Stage1ToStage2Panel` / `Stage2Bridge`。

### 処理
- 財務データから 5 指標を計算: `utils/valueAnalysis.ts` の `computeValueAnalysis` / `computeValueAnalysisBundle`。結果は `valueAnalysis`（全社）・`segmentValueAnalysis`（事業部別）。
  - **ROIC** = 営業利益 × (1 − 実効税率) / (純資産 + 有利子負債)
  - **WACC** = 資本コスト×資本比率 + 負債コスト×(1−税率)×負債比率（簡易入力/業界平均可）
  - **PBR** = 時価総額 / 純資産
  - **成長率** = 売上 CAGR、**利益率** = 営業利益 / 売上
  - 新形式では `roe` / `roa` / `per` / `debtEquityRatio` も保持（`ValueAnalysis` 型）。
- 年度の CRUD（追加/改名/削除）はストアの `addFinanceYear` / `renameFinanceYear` / `removeFinanceYear`（事業部別は `*SegmentFinanceYear`）。
- 論点抽出: `stage1Issues[]`（`IssueBlock`）。
- ドキュメント取込: `POST /api/stage1/import`（PDF/CSV → 財務抽出。`pdf-parse` / `papaparse`）。
- ダミーデータ投入（開発用）: `loadStage1DummyData()`、スナップショット保存: `saveStage1Snapshot()`（localStorage）。

### 出力
- 5 指標の計算結果と改善領域の示唆 → Stage 2 へ接続（`Stage1ToStage2Panel` / `Stage2Bridge`）。

### 関連 API
`/api/stage1/import`, `/api/market/pbr`（上場企業の PBR 取得）, `/api/knowledge`。

---

## Stage 2：全社戦略策定（`/stage2`）

### 目的
Stage 1 の論点を踏まえ、全社の「勝ち筋」を言語化し、AI との 12 問仮説検証を経て 1 つの統合戦略ストーリーへ落とす。

### 入力
- MVV: `mission` / `vision` / `value` / `thought` / `ceoIntent`
- SWOT: `strength` / `weakness` / `opportunity` / `threat`（AI 補完候補 `swotSuggestions`）
- 勝ち筋候補: `winPatternsCandidate[]`、確定: `winPatterns[]` / `winPatternPrimary` / `winPatternSecondary`
- 12 問への回答: `answers12[]`（`Stage2Answer`）

### 処理（戦略生成パイプライン）
1. 勝ち筋カタログ（`lib/strategyPatterns.catalog.ts` / `.top.ts` / `.exec.ts` / `.map.ts`、`lib/winPatterns.ts`）から候補提示。
2. **12 問の仮説検証**: `app/api/generate-question/`（`helpers.ts` の `TEMPLATE12` / `clampStepDyn` / `maxStepsForChapter`）。章ごとにステップ生成。質問ストアは `store/questionStore.ts`、ステッパー UI は `components/guide/QuestionStepper.tsx`。
3. **たたき台生成**: `storyDraft[]`（`StoryChapter[]`）を `POST /api/generate-story-draft` / `generate-story-draft-v2`。
4. **最終ストーリー（3 段階）**: `finalStoryDraft` → `finalStoryEdited` → `finalStoryFinal`（`commitFinalStory()` で確定）、`finalStory[]` に反映。生成は `POST /api/generate-final-story`。
5. **North Star（会社数値目標）**: `companyTargets[]`（`CompanyTarget`）。
6. **中計設計（任意・第 2 パス）**: `midtermStrategy`（`swot_suggestions` JSONB にパック保存）。

### 画面コンポーネント
`components/StrategyInput.tsx` / `StrategyBlock.tsx` / `SummaryResult.tsx`、`components/stage2/StrategyStoryPreview.tsx`、`components/steps/Step2SWOT.tsx` / `Step4MVV.tsx`、`components/pages/StrategyClient.tsx`、`components/story/StorySubnav.tsx`。

### 出力
統合戦略ストーリー（`finalStory`）／重要ポイント／12 問の要約／勝ち筋確定 → Stage 3 へ。

### 関連 API
`/api/generate-question`, `/api/generate-story-draft(-v2)`, `/api/generate-final-story`, `/api/generate-hint`, `/api/generate-example`, `/api/generate-advice`, `/api/generate-strategy`, `/api/recommend-top-patterns`, `/api/recommend-exec-patterns`, `/api/stage2/generate-draft`, `/api/stage2/generate-final`。

---

## Stage 3：部門カスケード（`/cascade`）

### 目的
確定した全社戦略を **部門 → プロジェクト → OKR** に展開し、全社〜現場の一貫性をつくる。

### 入力単位
1. **部門**（`Department`）: `name` / `mission`（担当する戦略要素）/ 勝ち筋・レバー
2. **プロジェクト**（`Project`）: 部門ミッションを実現する活動のまとまり（目安 2〜4 本）
3. **OKR**: `objective`（定性ゴール）＋ `keyResults[]`（定量基準 3〜5）＋ `owner`

### 処理
- 全社戦略 → カスケード生成: `POST /api/generate-cascade`（`lib/openaiClient.ts` `generateCascateFromStrategy` 系。ルート構造 JSON を生成）。
- 部門質問の生成（バックグラウンド）: `app/cascade/hooks/useDepartmentQGenListener.ts` + `/api/generate-department-question`。部門ミッション/サマリ/たたき台: `/api/generate-department-summary`, `/api/generate-department-draft`。
- 整合性チェック: CEOChat（advisor/facilitator）で「この部門ミッション/OKR は Stage2 勝ち筋のどこに効くか」を確認。
- **OKR の保存は `okrs` テーブルへ正本化**（[02-data-model.md](./02-data-model.md) §4）。`strategy_data.departments` 内はスナップショット。
- 戦略ブリッジ: `POST /api/stage3/generate-strategy-bridge` → `strategy_data.stage3_strategy_bridge`。

### 画面コンポーネント（`components/stage3/`）
`CascadeHeader` / `CascadeControlBar` / `DepartmentAddForm` / `NoticeDisplay` / `ReflectionCandidatesSection`。質問ステッパー部門版は `components/guide/QuestionStepper.dept.tsx`。

### 出力
部門別の戦略カスケード（全社戦略 → 部門ミッション → プロジェクト → OKR）。Stage 4/5/6 に接続。

### スモークテスト
`npm run stage3:smoke`（`scripts/stage3.smoke.mjs`）。

---

## Stage 4：実行計画策定（`/okr`）

### 目的
Stage 3 の OKR/プロジェクトを「誰が・いつまでに・何を・どうやって・どれだけ財務に効くか」の実行計画に落とす。

### 入力・データ（`Project` / `Stage4Plan`）
- **財務ロール**: `role`（`REVENUE` / `COST` / `FUTURE`）、`roleDetail`（`ACQ`/`CHURN`/`ARPU`/`PERSONNEL`/`FIXED`/`VARIABLE`）
- **財務ゴール**: `impactRevenueMJPY`（売上寄与）/ `impactOpIncomeMJPY`（営業利益寄与）/ `impactInvestmentMJPY`（投資額）/ `impactConfidence`（確度）/ `impactRationale`
- **計画ステータス**: `planStatus`（`draft`/`review`/`approved`）、`approvedAt` / `approvedBy`
- **オーナー**: `ownerUserId`
- **マイルストーン**: `Milestone` / `ProjectPlanMilestone`
- **人的投資・スキル**: `HumanInvestment` / `SkillPlan` / `ExecutionHumanInvestment`
- **計画スナップショット**: `stage4Plans[]`（`Stage4Plan`: `status: 'Draft'|'Review'|'Approved'`、`baseline`/`current`）、`executionPlanBaseline`

### 処理
- ベースライン: Stage 3 の部門から `createBaselineFromStage3(dept)` で `Stage4Baseline` を生成。`baseline` と `current` の **差分（DiffViewer）**で変更を可視化。
- 実行ドラフト生成: `POST /api/stage4/generate-execution-draft`。
- OKR から実行（exec）パターン: `POST /api/okr-from-exec`, `/api/recommend-exec-patterns`, `lib/okrTemplates.exec.ts` / `strategyPatterns.exec.ts`。
- KPI ツリー表示: `components/stage4/KpiTreePanel.tsx`。OKR 編集は `app/okr/_hooks/useOkrEditor.ts` + `app/okr/_lib/okrModels.ts`。

### 画面コンポーネント（`components/stage4/`）
`OKRHeader` / `ProjectListHeader` / `DepartmentListItem` / `ProjectSelectionPrompt` / `ProjectEditor` / `KpiTreePanel` / `AlignmentPreview` / `DiffViewer` / `StatusBadge` / `ReflectionCandidatesSection`。

### 出力
タイムライン/担当/予算/財務インパクト/承認ステータスが揃った実行計画 → Stage 5/6。

### ルートに関する注意
- 現行ナビは **`/okr`** が Stage 4 本体。
- `app/stage4/page.tsx` にも Stage 4 相当の実装（`Stage4Plan`/`DiffViewer` 等）が残っており、**並存している**。新規導線は `/okr` を使用する。

---

## Stage 5：実行計画支援（`/execution`）

### 目的
実行計画を定期的な進捗入力とレビューで回し続ける。進捗の可視化と AI 支援。

### 入力（`ProgressLog` / `progress_logs`）
- `progressText`（直近の進展）、`rating`（達成度・評価）、`ratingComment`、`helpRequest`（支援依頼）、`department` / `project` / `okrId` / `userId`。
- Member もここは入力可（`progress:write` は全ロール true）。

### 処理
- 進捗ログを `progress_logs` に書込（`okrId` 単位）。OKR ID 解決は stable ID（`db_okr_id`）に依存。
- AI 支援: `POST /api/stage5/assist-execution`（要点要約・リスク言語化・次アクション提案・上位戦略整合チェック）、`POST /api/stage5/execution-summary`。
- ホーム/ピラミッド連携: `components/home/ExecutionPanel.tsx` / `PyramidNavigator.tsx`、`components/stage5/`（`ExecutionHeader` / `EmptyExecutionMessage` / `EmptyPyramidMessage`）、`components/execution/ProjectCard.tsx`。

### 出力
- 進捗ログ履歴／実行の見える化／月次・四半期のレビュー材料。
- Stage 6 の見立て材料・CEOChat のコンテキストに供給。

> Stage 5 の OKR ID 解決は調整履歴が多い（`docs/reports/STAGE5_*`, `docs/investigation/STAGE5_*`）。実装変更時は併読。

---

## Stage 6：業績シミュレーション（`/stage6`）

### 目的
プロジェクト/OKR が業績（PL・ROIC 等）にどれだけ効くかを試算。複数シナリオ比較と感度分析で計画の妥当性を検証。

### 入力・データ
- **North Star 寄与（Phase E）**: `projectTargetImpacts[]`（`ProjectTargetImpact`: project × target の `delta`）、`okrTargetScores{}`（OKR → 進捗インパクトスコア 0〜5）、`projectIssueLinks[]`（`ProjectIssueLink`: project × issue × strength 1〜3）。
- 前提（単価・数量・継続率・原価率・固定/変動費・投資額・効果タイミング）、シナリオ（楽観/基本/悲観）。
- シミュレーション結果: `simulationResult`（`projection.points[]`: year/sales/op/opMargin、`finalProb`）。

### 処理
- シナリオ試算と感度分析。寄与の入力サニタイズはストアの `sanitizeProjectTargetImpacts` / `sanitizeProjectIssueLinks`（保存前に NaN/0/不正値除去）。
- 財務サマリ: `components/finance/FinanceSummaryPanel.tsx`、`types/financeSummary.ts`。

### 画面コンポーネント（`components/stage6/`）
`TabValue` / `TabValue.dashboard` / `TabImpact` / `TabNorthStar`、フック `useStage6Data.ts` / `useProjectFilters.ts`。シミュレーション本体は `components/simulation/SimulationDashboard.tsx`。

### 出力
- 3 シナリオの業績見通し（売上・利益・ROIC 等）、重要前提の影響度、計画の妥当性の論点。

---

## レポート（`/report`）

各ステージの成果を PDF 等で出力する。

- 出力ビュー: `components/export/`（`Stage1ReportView` / `Stage2ReportView` / `Stage2StrategyPreview` / `Stage3ReportView` / `Stage4ReportView` / `StrategyReportView` / `MidtermPlanPreview` / `ReportLayout`）。
- PDF ボタン: `ExportPdfButton` / `StagePdfExportButton`。フック: `hooks/useStage{1,2,3,4}PdfExport.ts` / `useFullStrategyPdfExport.ts`。
- レポートページ: `/report`, `/report/stage2-strategy`, `/report/midterm-plan`, `/report/execution-report`。
- 実装は `jspdf` / `html2pdf.js` / `html2canvas` / `xlsx`。
