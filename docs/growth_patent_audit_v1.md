# GROWTH 実装事実監査レポート v1

## 0. 調査対象と前提

### 調査対象ディレクトリ
- `app/` - Next.js ページ・レイアウト
- `app/api/` - API routes
- `components/` - React コンポーネント
- `store/` - Zustand ストア
- `types/` - TypeScript 型定義
- `utils/` - ロジック・ヘルパー関数
- `lib/` - テンプレート・ナレッジ・RBAC定義

### 除外対象
- `.next/` - Next.js ビルド出力
- `node_modules/` - 外部パッケージ
- `docs/` - ドキュメント（調査対象外）
- その他バックアップ・一時ディレクトリ

### 調査方針
- **事実のみ記載**：コード上で確認できた内容のみを記述
- **推測なし**：「～と思われる」「～の可能性がある」は使用しない
- **不明な点**：実装が確認できない場合は「不明」と明記
- **特許判断なし**：「進歩性がある」「似ている」などの評価は記載しない
- **完全な関連ファイル記載**：ファイルパス、関数名、hook名、state名、型名、テーブル名を可能な限り明記

---

## 1. 全体概要サマリー

### STAGE1：企業価値分析
- **入力**：財務資料（PDF/Excel/CSV）、企業基本情報
- **処理**：`/api/stage1/import` で MATRIX/LONG形式の財務データ抽出、ベンチマーク診断（`calculateBenchmarkIssues()`）
- **出力**：`financePL`, `financeBS`, `segmentPL`, `segmentBS`, `financeSummary`, `stage1Issues`, `stage1Benchmarks`
- **保存**：Supabase `strategy_data` テーブル → `strategyStore` （自動保存：`useAutoSave` hook, debounce 1200ms）

### STAGE2：戦略ストーリー化
- **入力**：STAGE1 財務分析 + CEO意図 + SWOT + 12問回答（`answers12`）+ 勝ち筋候補選択
- **処理**：
  - `/api/stage2/generate-draft` ：`issueBlocks` + `mvv` + `swot` + `ceoIntent` + `companyTargets` → 4章ドラフト + 勝ち筋候補（`winPatternsCandidate`）
  - `/api/stage2/generate-final` ：`storyDraft` + `answers12` + `companyTargets` + `selectedWinPatternId` → 熱量版最終ストーリー（North Star 整合確保）
- **出力**：`finalStory[]` (4章), `winPatterns` (2-3案), `companyTargets` (North Star Metrics)
- **保存**：Supabase → `strategyStore` （`saveWithAudit()` による監査付き保存）

### STAGE3：実行計画策定（CASCADE）
- **入力**：STAGE2 戦略ストーリー + 部門数
- **処理**：
  - `/api/generate-cascade` ：`issueBlocks` + `storyDraft` + `selectedWinPattern` + `revenue` + `industry` → 部門×Lane×Project×OKR 体系生成
  - 部門別ドラフト・質問・サマリー生成（`/api/generate-department-xxx`）
  - OKR 目標値計算（`extractBaseAndLevers()` + `financeModel()` 連携）
- **出力**：`departments[]{projects[], okrs[], missions}`, `stage4Plans` (人的投資・スキル要件含む)
- **保存**：Supabase `departments`, `projects`, `okrs` テーブル → `strategyStore`

### STAGE4：計画の整合性確認
- **入力**：STAGE3 カスケード結果
- **処理**：部門×プロジェクト×OKR の baseline vs current 比較、ステータス管理（`planned`/`ready`/`active` など）
- **出力**：`stage4Plans` (status, revision history)
- **保存**：Supabase → `strategyStore`

### STAGE5：実行追跡
- **実装状況**：`/api/stage5/execution-summary` エンドポイント存在（読み取りのみ）だが、`/stage5` ページ実装なし
- **機能**：直近7日の OKR チェックイン率取得、Stale Projects 検出

### STAGE6：業績シミュレーション・結果分析
- **入力**：STAGE2 `finalStory` + OKR + プロジェクト実績（進捗ログ）+ 財務予測
- **処理**：
  - `useStage6Data` hook で自動計算：`buildNorthStarRows()`, `buildProjectContributions()`, `calculateAchievementRate()`
  - `stage6/compute.ts` で達成率・貢献度・予測を自動計算
  - 実行パターンと結果の整合性検証
- **出力**：`dashboardSummary`, `northStarRows[]`, `projectContributions`, `fourMetricCards`
- **参照**：読み取り専用（自動保存なし）

### ステージ間の主要データ連結

| 上流 | 下流 | 連結内容 | 実装 |
|-----|-----|--------|------|
| STAGE1 `financeSummary` | STAGE2 `generate-draft` | 論点（`issueBlocks`）の入力、指標サマリ反映 | `/api/stage2/generate-draft` 入力 |
| STAGE2 `finalStory` + `winPatterns` | STAGE3 `generate-cascade` | 全社戦略・勝ち筋から部門戦略・OKRカスケード | `/api/generate-cascade` 呼び出し |
| STAGE2 `companyTargets` | STAGE2 `generate-final` | North Star Metrics の整合性強制チェック | `generate-final` で出力制約 |
| STAGE3 `departments[]` + `projects[]` | STAGE4 `stage4Plans` | 計画のステータス・revision 管理 | `page.tsx` (stage4) で可視化 |
| STAGE4 `stage4Plans` | STAGE6 `northStarRows` | プロジェクト→OKR→KPI→NorthStar への寄与度計算 | `stage6/compute.ts` |
| STAGE3/4 OKR + projects | STAGE6 `projectContributions` | 実行プロジェクトの KPI への貢献度自動計算 | `stage6/execution.ts` `matchProgressLogToProject()` |
| STAGE6 結果分析 | STAGE1～4 への反映 | **実装なし**：下流の結果が上流修正判断に使われる実装は確認できない | N/A |

### 重要な実装あり/なしの要点

| 機能 | 状況 |
|-----|------|
| STAGE1-6 フロー | ✅ 完全実装（ただし STAGE5 画面なし） |
| AI生成系（15エンドポイント） | ✅ OpenAI統合済み |
| データ永続化（3層構成） | ✅ Supabase + Zustand + localStorage |
| 自動保存 | ✅ 全ステージで debounce (1200ms) 対応 |
| 権限管理（RBAC） | ✅ admin/manager/member 3段階 |
| 楽観ロック＋競合復旧 | ✅ revision + 競合復旧機構実装 |
| 下流→上流の自動反映 | ❌ 実装なし |
| Realtime協調編集 | ❌ Supabase Realtime subscription 未確認 |
| OKRチェックイン | ⚠️ 読取のみ、POST エンドポイント不明 |

---

## 2. 処理棚卸し表

| 処理ID | 処理名 | 概要 | 入力 | 処理内容 | 出力 | 保存先 / 反映先 | 次工程への受け渡し | 関連ファイル | 関連関数・Hook・state |
|--------|--------|------|------|--------|------|------------------|--------------|-------------|----------------------|
| P001 | 財務データインポート | ファイルから財務候補抽出 | FormData (PDF/Excel/CSV) | `parseExcelOrCsv()` + `buildCandidatesFromTable()` / `buildCandidatesFromCsvFallback()` | `candidates[]{kind, year, segment, fields}` | Supabase キャッシュ | ユーザー確認後に financePL/BS へ | `/api/stage1/import/route.ts` | `buildCandidatesFromTable`, `normalizeCandidate` |
| P002 | ベンチマーク診断 | PL/BS から診断指標計算 | `financePL`, `financeBS` | `calculateBenchmarkIssues()` | `stage1Issues[]`, `stage1Benchmarks` | `strategyStore` | STAGE2 `generate-draft` への入力 | `/utils/stage1/benchmarkIssues.ts` | `calculateBenchmarkIssues` |
| P003 | STAGE1スナップショット保存 | 途中保存 | `financePL`, `financeBS`, `candidates` | `localStorage` キャッシュ | キャッシュキー | `localStorage` | ブラウザ再起動時の復元 | `/utils/stageSnapshot.ts` | `saveStage1Snapshot` |
| P004 | 戦略ドラフト生成 | STAGE2の初期ドラフト | `issueBlocks`, `mvv`, `swot`, `ceoIntent`, `companyTargets` | `buildSystemPrompt()` + OpenAI `gpt-4o` | `storyDraft[4]`, `winPatternsCandidate[2-3]` | Supabase | STAGE2 最終版生成への入力 | `/api/stage2/generate-draft/route.ts` | `buildSystemPrompt`, `buildUserPrompt`, `normalizeChapterBody` |
| P005 | 最終ストーリー生成 | 社員向け熱量版 | `storyDraft`, `answers12`, `companyTargets`, `selectedWinPatternId` | OpenAI `gpt-4o` + North Star整合チェック + 2ndpass修復 | `finalStory[4]` (700-1000字/章) | Supabase → `strategyStore` | STAGE3 カスケード入力 | `/api/stage2/generate-final/route.ts` | `buildSystemPrompt`, `formatCompanyTargets`, `computeCoverageIssues`, `normalizeFinalStory` |
| P006 | 部門別戦略カスケード生成 | 全社→部門への多段連結 | `issueBlocks`, `storyDraft`, `selectedWinPattern`, `revenue`, `industry`, `businessSegments` | `/api/generate-cascade` → OpenAI `gpt-4o-turbo` + industryTemplates | `departments[]{name, strategy, projects[], okrs[]}` | Supabase | STAGE3・4 での編集・追跡 | `/api/generate-cascade/route.ts` | `buildSystemPrompt`, `industryTemplates`, OKR generation |
| P007 | 部門ドラフト生成 | 部門レベルの戦略 | `companyStory`, `departmentName`, `departmentIndex` | OpenAI `gpt-4o` | `departmentMission`, `deptStrategy`, `rationale` | Supabase | 部門タブへの表示 | `/api/generate-department-draft/route.ts` | `buildSystemPrompt` |
| P008 | 部門深掘り質問生成 | 部門別の議論質問 | `departmentName`, `companyStrategy`, `chapterIndex` | Template seed (`TEMPLATE_STAGE3_QUESTIONS`) / OpenAI (条件付き) | `questions[]{id, text, stepNumber}` | なし | ユーザー回答フロー | `/api/generate-department-question/route.ts` | `TEMPLATE_STAGE3_QUESTIONS` |
| P009 | OKR目標値計算 | 勝ち筋別の目標数値 | `selectedWinPattern`, `companyTargets`, `revenue`, `industry` | `industryTemplates` + `extractBaseAndLevers()` + `financeModel()` | `okrs[]{fy, objective, keyResults[]{elasticity, weight, lag}}` | Supabase | STAGE4・6 での進捗追跡 | `/api/generate-cascade/route.ts` | `extractBaseAndLevers`, `financeModel` |
| P010 | 人的投資・スキル要件記録 | STAGE3の実行体制定義 | `departmentId`, `projectId`, `skillRequirements`, `headcount` | ユーザー入力 / AI生成 | `stage4Plans{humanInvestment[], skillPlan}` | Supabase → `strategyStore` | STAGE4 ステータス確認 | `/types/strategy.ts` | `HumanInvestment`, `SkillPlan`, `SkillMethod` |
| P011 | 検証設計記録 | STAGE3の検証・サクセスクライテリア | `projectId`, `assumptions`, `tests` | ユーザー入力 | `stage4Plans{validationPlan[]{test, metric, successCriteria}}` | Supabase → `strategyStore` | STAGE5・6 での進捗判定 | `/types/strategy.ts` | `ValidationPlan`, `Impact`, `Probability` |
| P012 | ステータス・Revision管理 | STAGE4で計画状態追跡 | `projectId`, `newStatus`, `revision` | `updateStatus()` callback | `stage4Plans{projects[]{status, revision}}` | Supabase + `strategyStore` | 保存時の監査ログ記録 | `/app/stage4/page.tsx` | `setStage4Plans`, `updateStatus`, `revision` |
| P013 | 業績シミュレーション計算 | OKR→財務予測 | `strategy.okrs[]`, `financePL` (base), `levers` | `runThreeYearFromStrategy()` = `extractBaseAndLevers()` → `financeModel()` → `financeSimulation()` | `simulationResult {y1, y2, y3}` | `strategyStore` (計算キャッシュ) | STAGE6 表示 | `/utils/financeAdapter.ts` | `runThreeYearFromStrategy`, `simulateMonthlyPL`, `aggregateYearly` |
| P014 | North Star 寄与度計算 | KPI達成率の自動推定 | `okrs[]`, `simulationResult`, `companyTargets` | `buildNorthStarRows()` | `northStarRows[]{metric, baseline, target, y1, y2, y3, achievementRate}` | `strategyStore` (stage6 sub-state) | STAGE6 ダッシュボード | `/utils/stage6/compute.ts` | `buildNorthStarRows`, `extractMetricFromYearlyPL`, `calculateAchievementRate` |
| P015 | プロジェクト寄与分析 | 個別プロジェクトの KPI 貢献度 | `projects[]`, `progressLogs[]`, `northStarRows` | `buildProjectContributions()` → `matchProgressLogToProject()` | `projectContributions[]{projectId, contributionRate, linkedMetrics[]}` | `strategyStore` (stage6 sub-state) | STAGE6 プロジェクト分析表示 | `/utils/stage6/compute.ts`, `/utils/stage6/execution.ts` | `buildProjectContributions`, `matchProgressLogToProject` |
| P016 | 進捗ログ→プロジェクトマッチング | 実行実績の自動割り当て | `progressLogs[]`, `projects[]` | `normalizeProjectName()` + 名前マッチングアルゴリズム | `matched progressLog → projectId` | Supabase | STAGE6 寄与度計算 | `/utils/stage6/execution.ts` | `matchProgressLogToProject`, `normalizeProjectName` |
| P017 | 達成率計算 | KPI 実績 vs 目標 | `northStarRows`, `actualValues` | CAGR / 達成度 % 計算 (アルゴリズム) | `achievementRate (%)` | `strategyStore` | STAGE6 表示 | `/utils/stage6/compute.ts` | `calculateAchievementRate` |
| P018 | ヒント生成（質問支援） | 回答を促すヒント | `question`, `answer?` | バックキャスト・先行指標・小実験テンプレート + OpenAI JSON mode | `hints[3]{backcast, leadingIndicator, quickExperiment}` | なし | UI 表示（保存なし） | `/api/generate-hint/route.ts` | OpenAI `gpt-4o-mini` |
| P019 | OKRアドバイス生成 | 進捗が停滞時の改善案 | `objective`, `progress` | OpenAI `gpt-4o` | `advice` (3項目の改善提案) | なし | UI 表示 | `/api/generate-advice/route.ts` | OpenAI `gpt-4o` |
| P020 | インサイト自動生成 | KR数値からの洞察 | `baseline`, `y3`, `prob`, `krs[]` | `generateInsights()` (アルゴリズム、AI不使用) | `insight` (複合評価テキスト) | なし | UI 表示 | `/api/generate-insight/route.ts`, `/utils/insightModel.ts` | `generateInsights` (edge runtime) |
| P021 | CEO 相談エージェント | AI支援対話 | `messages[]`, `strategyId`, `userId` | RAG + `classifyHeuristic()` / `classifyLLM()` + ファシリテータプロトコル | `response` (テキスト), `mode` ラベル | `agent_logs` (Supabase) | UI チャット表示 | `/api/ask-ceo-agent/route.ts` | `classifyHeuristic`, `classifyLLM`, `retrieveGrowthKnowledge` |
| P022 | 戦略データ保存（監査付き） | DB保存＋監査ログ記録 | `strategy` (全体), `caller`, `trigger` | `saveWithAudit()` → `saveStrategyData()` + `revision++` + audit log 記録 | DB保存完了 | Supabase `strategy_data` + audit_logs | 返却値なし | `/utils/persist/saveWithAudit.ts` | `saveWithAudit`, `saveStrategyData` |
| P023 | 戦略データ復元（フォールバック） | DB/store/snapshot から復元 | `companyId`, `strategyId` | `restoreWithAudit()` → DB read → store restore → snapshot fallback | `strategy` (復元結果) | `strategyStore` | UI 再レンダリング | `/utils/persist/restoreWithAudit.ts` | `restoreWithAudit`, `detectSourceOfTruth` |
| P024 | 自動保存ポーリング | 定期的な save 呼び出し | `strategyStore` (全状態) | `useAutoSave` hook: 1200ms debounce + 1500ms interval | `saveStrategyData` 実行 | Supabase | 保存完了ステータス更新 | `useAutoSave` hook | `useAutoSave` |
| P025 | 楽観ロック・競合復旧 | API 衝突時の自動復旧 | `lastServerSyncAt`, `revision`, `lastConflictInfo` | `revision` 比較 → cooldown → retry | 自動復旧 or エラー通知 | `strategyStore` | UI 警告表示 | `strategyStore.ts` | `pendingConflictRecovery`, `conflictCooldownUntil`, `lastConflictInfo` |
| P026 | 社員向けメンバー招待 | 新規メンバー加入 | `email`, `role`, `companyId` | Supabase + メール送信 | `invitationToken`, `expiresAt` | Supabase `invitations` | 招待リンク生成 | `/api/invites/create/route.ts` | `createInvitation` |
| P027 | メンバー権限変更 | RBAC ロール更新 | `memberId`, `newRole` | Supabase `company_members` update | `membership{role}` | Supabase | 権限チェック再実行 | `/api/members/role/route.ts` | `updateMembershipRole` |
| P028 | オンボーディング・初期化 | 新規企業セットアップ | `companyName`, `industry`, `allowCreateCompany` | `provisionCompany()` → 初期 snapshot + 骨組み作成 | `company{id}`, `membership`, `strategy skeleton` | Supabase | メンバー管理・STAGE1開始 | `/api/companies/provision/route.ts` | `provisionCompany`, `bootstrapStrategy` |
| P029 | 権限ガード（API層） | エンドポイント権限チェック | Bearer Token, `capability` | RBAC マトリックス (`/lib/rbac.ts`) 照合 | `authorized` / `unauthorized` | エラー返却 | API 実行可否判定 | `/lib/server/rbacGuard.ts` | `assertCapability`, `enforceRBAC` |

---

## 3. データ構造表

| データID | データ名 | 主なフィールド | 保持場所 | 生成元 | 更新元 | 主な参照先 | 関連ID | 関連ファイル |
|---------|---------|--------------|--------|--------|--------|----------|--------|-------------|
| D001 | strategy_data (全体) | `companyId`, `strategyId`, `companyName`, `industry`, `revenue`, `departments[]`, `projects[]`, `okrs[]`, `story`, `finalStory`, `answers12`, `stage4Plans` | Supabase + `strategyStore` | `provisionCompany` / `bootstrapStrategy` | STAGE1～4編集 / API | Store → UI全体 | `company_id`, `strategy_id` | `/types/strategy.ts` `StrategyData` |
| D002 | financePL | `rows[]{ym, revenue, cogs, opex, operatingIncome, margin}` | Supabase + `strategyStore` | STAGE1 インポート | STAGE1 編集 | STAGE2 ドラフト生成, 財務計算 | `company_id` | `/types/strategy.ts` `FinancePLRow[]` |
| D003 | financeBS | `rows[]{ym, assets, liabilities, equity, apl}` | Supabase + `strategyStore` | STAGE1 インポート | STAGE1 編集 | STAGE2 ドラフト生成, 価値分析 | `company_id` | `/types/strategy.ts` `FinanceBSRow[]` |
| D004 | segmentPL | `rows[]{businessSegment, ym, revenue, opex, operatingIncome}` | Supabase + `strategyStore` | STAGE1 インポート | STAGE1 編集 | STAGE2・3 分析, ポートフォリオ | `company_id` | `/types/strategy.ts` `SegmentPLRow[]` |
| D005 | financeSummary | `rows[]{businessUnit, fy, revenue, operatingIncome, revenuePct, opPct}` | `strategyStore` | `buildFinanceSummary()` (from PL/BS) | STAGE1 インポート後 | STAGE2 生成入力, 指標表示 | `company_id` | `/types/financeSummary.ts` `FinanceSummaryRow` |
| D006 | valueAnalysis | `businessSegments[]`, `indicators{cagrPct, opmPct, roe, pbr, ranking}` | `strategyStore` | `buildValueAnalysis()` (from PL/BS) | STAGE1 診断 | STAGE2 分析・診断表示 | `company_id` | `/utils/valueAnalysis.ts` |
| D007 | stage1Issues | `issues[]{category, priority, description, relatedMetrics}` | `strategyStore` | `calculateBenchmarkIssues()` (from `financeSummary`) | STAGE1 診断 | STAGE2 `generate-draft` 入力 | `company_id` | `/utils/stage1/benchmarkIssues.ts` |
| D008 | issueBlocks | `blocks[]{category, title, description, impactArea}` | `strategyStore` | STAGE1 診断 → 構造化 | STAGE2 編集 | STAGE2 `generate-draft` 入力, STAGE3 参照 | `strategy_id` | `/types/strategy.ts` `IssueBlock` |
| D009 | SWOT | `strength[]`, `weakness[]`, `opportunity[]`, `threat[]` (各々 string) | `strategyStore` | ユーザー入力 / `/api/generate-ot` | STAGE2 編集 | STAGE2 `generate-draft`/`final` 入力 | `strategy_id` | `strategyStore.ts` |
| D010 | MVV | `mission`, `vision`, `value` (各々 string) | `strategyStore` | ユーザー入力 / テンプレート | STAGE2 編集 | STAGE2 生成・STAGE3 参照 | `strategy_id` | `strategyStore.ts` |
| D011 | answers12 | `chapters[]{chapterIndex, steps[]{stepNumber, answer}}` | `strategyStore` + `questionStore` | ユーザー入力（12問フロー） | STAGE2 編集 | STAGE2 `generate-final` 入力 | `strategy_id` | `/types/strategy.ts` `ChapterAnswers` |
| D012 | storyDraft | `chapters[]{chapterIndex, body}` (4章) | `strategyStore` | `/api/stage2/generate-draft` | STAGE2 生成 | STAGE2 `generate-final` 入力, 表示 | `strategy_id` | `strategyStore.ts` |
| D013 | finalStory | `chapters[]{chapterIndex, body}` (4章), `_timestamp` | Supabase + `strategyStore` | `/api/stage2/generate-final` | STAGE2 生成 / `saveWithAudit` | STAGE3 入力, 全社ダッシュボード表示 | `strategy_id` | `strategyStore.ts` |
| D014 | companyTargets | `targets[]{metricId, metricName, y0, y3, unit, weight}` | `strategyStore` | ユーザー入力 (North Star Metrics) | STAGE2 編集 | STAGE2 `generate-final`, STAGE6 計算 | `strategy_id` | `/types/strategy.ts` `CompanyTarget` |
| D015 | winPatterns | `patterns[]{id, name, description, reasoning}` (2-3案選択) | `strategyStore` | `/api/stage2/generate-draft` → 候補, ユーザー選択 | STAGE2 選択 | STAGE3 `/api/generate-cascade` 入力 | `strategy_id` | `/types/strategy.ts` `WinPattern` |
| D016 | departments | `departments[]{deptId, name, strategy, mission, questions, answers2[], projects[], okrs[]}` | Supabase + `strategyStore` | `/api/generate-cascade` / ユーザー追加 | STAGE3・4 編集 | STAGE4・6 参照, 表示 | `strategy_id`, `department_id` | `/types/strategy.ts` `Department` |
| D017 | projects | `projects[]{projectId, name, owner, description, objectives[], status, okrLinks[], targetImpacts[]}` | Supabase + `strategyStore` | `/api/generate-cascade` / ユーザー追加 | STAGE3・4 編集 | STAGE4 ステータス管理, STAGE6 分析 | `strategy_id`, `project_id` | `/types/strategy.ts` `Project` |
| D018 | okrs (OKR行) | `rows[]{okrId, strategyId, deptId, projectId, fy, objective, keyResults[], owner, status, revision}` | Supabase `okrs` テーブル + `strategyStore` | `/api/generate-cascade` / `/api/generate-strategy` / ユーザー入力 | STAGE3・4 編集 / API `upsert()` | STAGE4・6 追跡, 財務計算 | `strategy_id`, `okr_id`, `project_id` | `/types/okrs.ts` `OkrRow`, `ResolvedOkr` |
| D019 | stage4Plans | `plans{projects[]{status, revision, baseline, current}, humanInvestment[], skillPlan[], validationPlan[]}` | `strategyStore` | `/api/generate-cascade` | STAGE4 編集 | STAGE6 計算入力 | `strategy_id` | `/types/strategy.ts` `Stage4Plan` |
| D020 | progressLogs | `logs[]{logId, projectId, date, summary, impact, collaborators}` (実装確認 → 不明) | Supabase (テーブル確定 未) | ユーザー入力 | STAGE5・6 入力 | STAGE6 プロジェクト寄与分析 | `project_id` | 不明 |
| D021 | businessPortfolio | `units[]{name, type, revenue, profitability, stage}` (4象限) | `strategyStore` | `createDefaultPortfolio()` / ユーザー入力 | STAGE1 編集 | ポートフォリオビュー表示 | `company_id` | `/types/portfolio.ts` `BusinessPortfolio` |
| D022 | simulationResult | `{y0, y1, y2, y3: {revenue, costs, operatingIncome}, achievementRate, projection}` | `strategyStore` (計算結果) | `runThreeYearFromStrategy()` | STAGE6 計算実行 | STAGE6 表示（自動計算、保存なし） | `strategy_id` | `/utils/financeAdapter.ts` |
| D023 | northStarRows | `rows[]{metricId, metricName, baseline, target, y1, y2, y3, achievementRate, trend}` | `strategyStore` (stage6 sub-state) | `buildNorthStarRows()` (from `simulationResult` + `companyTargets`) | STAGE6 計算実行 | STAGE6 ダッシュボード表示 | `strategy_id` | `/utils/stage6/compute.ts` |
| D024 | projectContributions | `contrib[]{projectId, projectName, contributionRate, linkedMetrics[]}` | `strategyStore` (stage6 sub-state) | `buildProjectContributions()` (from `progressLogs` + `projects`) | STAGE6 計算実行 | STAGE6 プロジェクト分析表示 | `project_id` | `/utils/stage6/compute.ts` |
| D025 | profiles | `{userId, email, name, role, avatar?, createdAt}` | Supabase `auth.users` + `userStore` | Supabase Auth signup | ユーザー設定変更 | アクセス制御・表示 | `user_id` | `/store/userStore.ts` |
| D026 | company_members (memberships) | `rows[]{memberId, userId, companyId, role, createdAt, updatedAt}` | Supabase `memberships` | `/api/invites/accept` / `provisionCompany` | `updateMembershipRole()` | アクセス制御・ロール判定 | `company_id`, `user_id` | `/utils/supabase/membership.ts` |
| D027 | invitations | `rows[]{inviteId, inviteToken, email, companyId, role, expiresAt, acceptedAt}` | Supabase `invitations` | `/api/invites/create` | `/api/invites/accept` | オンボーディング | `invite_id` | `/api/invites/route.ts` |

---

## 4. 連結関係表

| 連結ID | 上流データ / 上流処理 | 下流データ / 下流処理 | 連結内容 | 実装箇所 | 自動反映 / 手動反映 | 備考 |
|--------|-----------------|-----------------|--------|--------|-----------------|------|
| L001 | `financePL`, `financeBS` (STAGE1) | `stage1Issues` (STAGE1診断) | 財務指標から強化項目・診断結果を計算 | `calculateBenchmarkIssues()` | 自動反映 | debounce 遅延なし、即座に反映 |
| L002 | `financeSummary` (STAGE1) | `issueBlocks` (STAGE2入力) | 集計済み財務データ → 論点ブロックの根拠 | `/api/stage2/generate-draft` 入力 | 手動呼び出し | `generate-draft` API に全て入力 |
| L003 | MVV + SWOT (STAGE2) | `storyDraft` (STAGE2生成) | CEO意図・MVISION・課題分析 → ドラフト生成 | `/api/stage2/generate-draft` | 手動呼び出し | `buildSystemPrompt()` で全データ反映 |
| L004 | `storyDraft` + `answers12` + `companyTargets` (STAGE2) | `finalStory` (STAGE2生成) | ドラフト + Q&A回答 + North Star → 熱量版ストーリー | `/api/stage2/generate-final` | 手動呼び出し | North Star 未入力時は注記出力 |
| L005 | `finalStory` + `winPatterns` (STAGE2) | `departments[]`, `projects[]`, `okrs[]` (STAGE3生成) | 戦略ストーリー + 選択勝ち筋 → カスケード | `/api/generate-cascade` | 手動呼び出し | `generate-cascade` で選択 `winPattern` を必須入力 |
| L006 | `companyTargets` (STAGE2) | `northStarRows` (STAGE6計算) | North Star Metrics 目標値 → 達成率分母 | `buildNorthStarRows()` | 自動反映 | STAGE6 画面ロード時に自動計算 |
| L007 | STAGE3 `departments[]`, `projects[]`, `okrs[]` | STAGE4 `stage4Plans` | カスケード結果 → ステータス・revision・人的投資管理 | `page.tsx` (stage4) + `updateStatus` callback | 手動反映 | ユーザーが stage4 で ステータス・revision を変更・保存 |
| L008 | `stage4Plans` + `progressLogs` (実行実績) | `northStarRows` + `projectContributions` (STAGE6) | 実行計画 + 進捗データ → KPI達成率・プロジェクト貢献度 | `stage6/compute.ts` `buildNorthStarRows()` / `buildProjectContributions()` | 自動反映 | STAGE6 ロード時に自動計算、別保存なし |
| L009 | `projectId` (STAGE3) → `progressLog` (実績) | `projectContributions` (STAGE6) | プロジェクト識別 → 進捗ログマッチング → KPI貢献度 | `matchProgressLogToProject()` | 自動反映 | 名前マッチングアルゴリズム使用 |
| L010 | `selectedWinPattern` (STAGE2選択) | `okrs[].objective` + `keyResults[]` (STAGE3生成) | 勝ち筋パターン → OKR テンプレート生成 | `industryTemplates` + OKR gen (in `/api/generate-cascade`) | 自動反映 | `generate-cascade` に含まれた処理 |
| L011 | `answers2` (STAGE2部門別回答) | `projects[]`, `okrs[]` (STAGE3部門別生成) | 部門の議論・回答 → プロジェクト・OKR に反映 | DepartmentQuestionStepper.tsx での入力 | 手動反映 | ユーザーが部門タブで回答・確認 |
| L012 | `companyName`, `industry` (STAGE1) | `winPatterns` 推奨 (STAGE2) | 企業情報 → 業種別パターンマッピング | `/lib/industryTemplates.ts` | 自動反映 | `generate-draft` / `generate-cascade` で自動選定 |
| L013 | `okrs[]` + `financeSimulation` (STAGE2-3) | `simulationResult` (STAGE6計算) | OKR KR (elasticity, weight) → 財務への月次インパクト | `okrToFinance()` → `financeSimulation()` | 自動反映 | STAGE6 ロード時に自動計算 |
| L014 | STAGE6 結果データ (`northStar`, `projectContrib`, `simulationResult`) | STAGE1-4 の修正・再検討 判断材料 | **実装なし** : 下流の結果が上流の修正に自動反映される機構は確認できない | N/A | N/A | ユーザーが手動で上流に戻って修正する流れのみ確認 |

---

## 5. 還流関係表

| 還流ID | 下流イベント / 下流データ | 戻る先 | 戻る内容 | 実装箇所 | 自動 / 手動 | 備考 |
|--------|-------------------|----|--------|--------|-----------|------|
| RF001 | STAGE6 `northStarRows` (達成率) | STAGE2 `companyTargets` 修正判断 | **実装なし** : 達成率が低い North Star に対する自動修正・提案なし | N/A | N/A | ユーザーが画面を見て手動で STAGE2 に戻って修正 |
| RF002 | STAGE6 `simulationResult` (3年売上予測) | STAGE2-3 OKR 目標値見直し判断 | **実装なし** : 予測が未達の場合の自動レコメンドなし | N/A | N/A | ユーザーが手動で STAGE3 に戻って OKR 修正 |
| RF003 | STAGE6 `projectContributions` (プロジェクト寄与度) | STAGE3-4 プロジェクト優先順位・リソース再配分判断 | **実装なし** : 低寄与度プロジェクトの自動フラグ・リモート判定機構なし | N/A | N/A | ユーザー判断で STAGE4 プロジェクト削除・修正 |
| RF004 | `progressLog` チェックイン実績 | OKR ステータス自動更新 | **部分実装** : `/api/stage5/execution-summary` でチェックイン率計算のみ。ステータス自動更新なし | `/api/stage5/execution-summary` | 手動 | Stale Projects 検出は実装あり、ステータス自動更新なし |
| RF005 | OKR 達成・未達ステータス | STAGE4 `stage4Plans` visibility 更新 | **実装なし** : KR 達成/未達による計画ステータスの自動色付け・更新なし | N/A | N/A | ユーザーが手動で ステータス変更ボタン操作 |
| RF006 | 部門 `answers2` (回答内容) | 全社 `finalStory` 内容への整合確認 | **実装なし** : 部門回答が全社ストーリーと矛盾した場合の自動検出・提示なし | N/A | N/A | UI では部門タブと全社タブは独立表示 |
| RF007 | メンバー権限変更（RBAC） | ページ・機能アクセス制御の即座適用 | **実装あり** : RBAC Guard による権限チェック | `/lib/server/rbacGuard.ts` + `useAccess()` hook | 自動反映 | 権限変更後、次回 API 呼び出しで新権限で検証 |
| RF008 | Supabase データベース更新（他ユーザー操作） | `strategyStore` → UI自動更新 | **実装なし** : Real-time Supabase subscription による自動反映なし。スナップショット復元による間接反映のみ | `/utils/persist/restoreWithAudit.ts` fallback | 手動 | `reload` ボタン操作で DB 再読み込み |
| RF009 | リビジョン競合（楽観ロック） | 競合復旧・ユーザーへの通知 | **実装あり** : `conflictCooldownUntil` による自動リトライ、`lastConflictInfo` でユーザー通知 | `strategyStore.ts` | 自動 | cooldown 期間経過後、自動リトライ実装済み |
| RF010 | ユーザー logout | `strategyStore` + `userStore` + localStorage のクリア | **実装あり** : `hardSignOut()` で強制クリア | `/utils/auth.ts` `hardSignOut`, `hardSignOutAndPurge` | 自動 | logout → Cookie削除 → localStorage 全クリア |

---

## 6. 主要ID対応関係一覧

| ID名 | 用途 | 生成箇所 | 保持箇所 | 参照箇所 | 備考 |
|------|------|--------|--------|--------|------|
| `company_id` (UUID) | 企業識別、スコープ管理 | `provisionCompany()` / signup | Supabase `companies`, `strategyStore`, `userStore`, Cookie | ほぼ全 API・ページ | RLS policy 自動適用の中心軸、`requireMembership()` で検証 |
| `strategy_id` (UUID) | 戦略識別、STAGE1-6 スコープ | `bootstrapStrategy()` | Supabase `strategy_data`, `strategyStore` | STAGE1-6 ページ、API | 1 company : 1 strategy (現在), `assertCompanyScopeByStrategyId()` で scope 確認 |
| `department_id` (UUID) | 部門識別 | `/api/generate-cascade` / ユーザー追加 | Supabase (departments テーブル想定), `strategyStore` `departments[]` | STAGE3-4 編集、STAGE6 フィルタ | `generateStableId()` で stable ID 生成 |
| `project_id` (UUID) | プロジェクト識別 | `/api/generate-cascade` / ユーザー追加 | Supabase (projects テーブル想定), `strategyStore` `projects[]` | STAGE4 ステータス管理、STAGE6 寄与分析 | `generateStableId()` で永続化、`matchProgressLogToProject()` で参照 |
| `okr_id` (UUID) | OKR識別 | `/api/generate-cascade` / `/api/generate-strategy` / ユーザー入力 | Supabase `okrs` テーブル, `strategyStore` `okrs[]` | STAGE4・6 追跡、財務計算 | `queryByStrategyId()` / `queryByProjectId()` で検索, `upsert()` で重複制御 |
| `user_id` (UUID) | ユーザー識別、認証・権限 | Supabase Auth signup | Supabase `auth.users`, `userStore` | ページ・API 認証・権限判定 | Bearer Token (JWT) に埋め込み、`user_id → company_id` 解決に使用 |
| `revision` (number) | 楽観ロック用バージョン | DB保存時に `revision++` | `strategyStore`, Supabase `strategy_data` | API 衝突検出・復旧 | `lastServerSyncAt`, `lastConflictInfo` と連携 |
| `memberId` (UUID) | メンバーシップ識別 | membership 作成時 | Supabase `memberships` | `/api/members/role` で権限変更 | `user_id` ではなく `memberId` で権限変更（1 user : n memberships 対応） |
| `inviteId` (UUID) | 招待識別、トークン管理 | `/api/invites/create` | Supabase `invitations` | `/api/invites/accept` で招待検証 | `inviteToken` で招待有効性確認、`expiresAt` で有効期限管理 |

---

## 7. 保存・更新ポイント一覧

| 保存ID | 保存 / 更新対象 | 実行契機 | 実装箇所 | 保存先 | 備考 |
|--------|-------------|--------|--------|--------|------|
| S001 | `financePL`, `financeBS`, `segmentPL`, `segmentBS` | STAGE1 データ入力・確定 | `useAutoSave` hook (debounce 1200ms) | Supabase `strategy_data` | `normalizeStrategyData()` 済み状態で保存 |
| S002 | `stage1Issues`, `stage1Benchmarks` | STAGE1 診断自動計算 | `calculateBenchmarkIssues()` 実行時 | `strategyStore` (store のみ) | DB 保存なし（計算結果の一時保存） |
| S003 | `companyName`, `industry`, `businessSegments` | STAGE1 企業情報入力 | `useAutoSave` hook | Supabase `strategy_data` | Zustand → DB sync |
| S004 | `mvv` (mission, vision, value) | STAGE2 入力 | `useAutoSave` hook | Supabase `strategy_data` | 自動保存対応 |
| S005 | `swot` (strength, weakness, opportunity, threat) | STAGE2 入力 | `useAutoSave` hook | Supabase `strategy_data` | `/api/generate-ot` API 使用時も自動保存トリガ |
| S006 | `answers12` (章別Q&A) | STAGE2 各章の質問回答 | `actionBus` emit 'answers2:updated' + `useAutoSave` | `strategyStore` + Supabase (via `saveWithAudit`) | `questionStore` と `strategyStore` 同期 |
| S007 | `storyDraft[]` | `/api/stage2/generate-draft` 実行完了後 | API response → store 更新 | Supabase (in `saveStrategyData` call) | 2ndpass 修復含む |
| S008 | `finalStory[]` + `finalStoryEdited` / `finalStoryFinal` | STAGE2 「確定」操作 + `/api/stage2/generate-final` | `commitFinalStory()` → `saveWithAudit` | Supabase `strategy_data` | 監査処理: `saveWithAudit()` ログイング |
| S009 | `winPatterns` (選択された勝ち筋) | STAGE2 ユーザー選択 | `useAutoSave` | `strategyStore` + Supabase | `/api/generate-cascade` 入力として使用 |
| S010 | `companyTargets` (North Star Metrics) | STAGE2 入力 | `useAutoSave` | `strategyStore` + Supabase | STAGE6 計算の分母 |
| S011 | `departments[]` | `/api/generate-cascade` 実行 または STAGE3 編集 | API response → store 或いは `setDepartments()` | Supabase + `strategyStore` | 部門名、戦略、ミッション等含む |
| S012 | `projects[]` (部門別) | `/api/generate-cascade` 或いは STAGE3 ユーザー追加/編集 | API response 或いは `updateProject()` callback | Supabase + `strategyStore` | `project_id` stable ID 生成 |
| S013 | `okrs[]` (OKR行) | `/api/generate-cascade` 或いは `/api/generate-strategy` 或いは STAGE4 修正 | API response 或いは `strategyStore.setOkrs()` | Supabase `okrs` テーブル + `strategyStore` | `upsert()` メソッドで重複除去 |
| S014 | `answers2` (部門別QA) | `/api/generate-department-question` → ユーザー入力 | DepartmentQuestionStepper 入力 trigger | `strategyStore` | DB 保存別個実装不明（C未確定参照） |
| S015 | `stage4Plans` (計画状態・revision・人的投資) | STAGE4 状態変更 → 保存 | `updateStatus()` / `updateCurrent()` callback | `strategyStore` (Supabase RDB 連動不明) | revision トラッキング含む |
| S016 | `progressLogs` | ユーザー体チェックイン入力 (STAGE5/6) | 入力フォーム → API | Supabase `progress_logs` (テーブル確定 不) | STAGE6 マッチング計算 入力 |
| S017 | `simulationResult` | STAGE6 自動計算 | `runThreeYearFromStrategy()` | `strategyStore` stage6 sub-state (RDB 保存 않음) | 読み取り専用計算結果 |
| S018 | `northStarRows`, `projectContributions`, `fourMetricCards` | STAGE6 自動計算 | `useStage6Data` hook 内 `buildNorthStarRows()` 等 | `strategyStore` stage6 sub-state | 別個保存없음 (計算캐시) |
| S019 | `membershipRole` (권한) | `/api/members/role` 호출 | `updateMembershipRole()` | Supabase `company_members` | RLS policy 재평가 |
| S020 | 감시 로그 (audit log) | `saveWithAudit()` 호출 | 저장 시마다 기록 | Supabase `audit_logs` (테이블) | `caller`, `trigger`, `revision` 포함 |
| S021 | `revision` + `lastServerSyncAt` | 모든 DB 저장 후 | `saveStrategyData()` 반환값 | `strategyStore` | 낙관적 lock 경합 복구 용도 |
| S022 | `conflictInfo` (경합 정보) | API 409 반환 시 | conflictRecovery 処理 | `strategyStore` `lastConflictInfo` | 自動 リトライ 또는 사용자 알림 |
| S023 | `localStorage` (stage1/stage2 스냅숏) | STAGE1/2 작업 중 주기적 | `saveStage1Snapshot()` | `localStorage` (`gro_stage1_snapshot`) | 브라우저 강제 종료 대비 |
| S024 | Cookie (`company_id`, session) | 로그인 후 또는 회사 전환 | `/api/_session/set-company`, `/api/_session/set-cookie` | Cookie | 세션 관리 |

---

## 8. 未確定 / 不明点一覧

| No | 論点 | 不明内容 | 確認すべきファイル / 箇所 |
|----|------|--------|-------------------------|
| 1 | `progressLogs` の DB テーブル | DB テーブル名が確定していない。STAGE5 `progress_logs` との関係不明 | `app/api/stage5/execution-summary/route.ts` の `progressLogs` 参照元、Supabase schema 確認 |
| 2 | `answers2` (部門別QA) の永続化 | DepartmentQuestionStepper で `answers2` 入力後、Supabase への保存実装がコード上不明 | `/app/cascade/page.tsx` + DepartmentQuestionStepper でのコールバック、`saveStrategyData` への組み込み確認 |
| 3 | `stage4Plans` の DB 保存実装 | `strategyStore` 内でのみ管理されており、`saveStrategyData` で Supabase に保存されるかどうか不明 | `saveStrategyData()` 実装内で `stage4Plans` が include されているか確認 |
| 4 | `projectTargetImpacts`, `projectIssueLinks` の更新箇所 | 型定義は存在（`types/strategy.ts`）だが、コード内で更新・参照される箇所が不明 | Grep: `projectTargetImpacts`, `projectIssueLinks` の全参照個所 確認 |
| 5 | `businessPortfolio` の更新・保存 | `createDefaultPortfolio()` で初期化後、ユーザー編集時の保存処理が不明 | `/utils/` 内での `businessPortfolio` 保存関数の有無確認 |
| 6 | STAGE5 の実装状況 | `/stage5` ページなし。`/api/stage5/execution-summary` のみ存在。STAGE5 機能の全体像が不明 | `/app/execution/` など、execution 関連ページの実装確認 |
| 7 | `execution.page.tsx` の動作 | `/app/execution/page.tsx` が存在するが、GROWTH の STAGE フロー内での位置付けが不明 | `/app/execution/page.tsx` の内容確認、他ページとの連携確認 |
| 8 | OKR チェックイン機能 | `/api/stage5/execution-summary` は読み取りのみ。チェックイン POST エンドポイント不明 | OKR チェックイン save API の有無確認 |
| 9 | Real-time Collaboration | 複数ユーザーの同時編集時、Supabase Realtime subscription 使用有無不明 | `strategyStore.ts` でのリスナー設定確認、Realtime subscription の有無確認 |
| 10 | `companyTargets`（北星）の選択 UI | STAGE2 / STAGE6 で North Star Metrics をどのように編集するのか、UI フロー不明 | STAGE2 / STAGE6 components での 北星入力・編集コンポーネント確認 |
| 11 | 削除済みプロジェクト・OKR の soft delete vs hard delete | soft delete 対応（`isDeleted` フィールド）か、hard delete か不明 | `/utils/supabase/okrsRepository.ts` `softDelete()` の実装、DB schema 確認 |
| 12 | Admin ロールの権限範囲 | RBAC マトリックスで admin の全権限列が完全か不明 | `/lib/rbac.ts` の Capabilities マトリックス確認、管理者専用機能の列挙 |
| 13 | Industry Templates との連携 | `WIN_PATTERN_MASTER` (8パターン) と `industryTemplates` の対応が不明 | `/lib/industryTemplates.ts` の実装確認、パターン別 OKR テンプレート の生成ロジック |
| 14 | Financial Model の elasticity, weight, lag の値 | KR → 財務変数のマッピングで、elasticity や lag (月数) がハードコードされているのか、設定可能か不明 | `/utils/financeModel.ts` での係数定義、カスタマイズ可能性確認 |
| 15 | Stage 6 Phase E の実装状況 | `/utils/stage6/phaseE.ts` が存在するが、STAGE6 ページで使用されているか不明 | `phaseE.ts` の関数群が `stage6/compute.ts` や `page.tsx` で呼び出されているか確認 |
| 16 | Auto-linking (`autoLinking.ts`) の動作 | OKR ↔ Project の自動リンクがどのタイミングで実行され、ユーザー操作で制御可能か不明 | `/utils/stage6/autoLinking.ts` の呼び出し箇所、ユーザー UI での制御可能性確認 |
| 17 | Strategy Patterns (top/exec) の自動推奨 | `WIN_PATTERN_MASTER` と `strategyPatterns` (top/exec) の推奨ロジック、recommend-* API が実際に使用されているか不明 | `/api/recommend-top-patterns`, `/api/recommend-exec-patterns` の呼び出し元確認 |
| 18 | CEO Agent の mode 分岐 | `intentRouter` で分類されるが、各 mode の処理内容・応答形式が異なるのか不明 | `/lib/intentRouter.ts` + `/api/ask-ceo-agent/route.ts` での mode 別処理を確認 |
| 19 | Knowledge Base (RAG) の更新方法 | `GROWTH_RAG_INDEX` が hardcoded か、動的に更新されるか不明 | `/lib/rag/indexer.ts` での インデックス生成・更新タイミング確認 |
| 20 | Generate 系 API のエラーハンドリング | 2ndpass 修復失敗時、ユーザーへの エラー通知・カスケード中止判定の実装不明 | `/api/stage2/generate-draft/route.ts`, `/api/generate-cascade/route.ts` でのエラー処理確認 |

---

## 9. 実装上の重要ポイント整理

### STAGE1〜6 の連結構造
GROWTH は **STAGE1 → STAGE2 → STAGE3 → STAGE4 → STAGE6** の5段階で構成される。各ステージは識別子（`strategy_id`, `department_id`, `project_id`, `okr_id`）で紐付けられ、上流から下流へデータが一方向に流れる。ただし、下流（STAGE6）の計算結果が上流の修正判断に自動反映される機構は実装されていない（ユーザー手動修正）。STAGE5 は `/api/stage5/execution-summary` の読取エンドポイントのみが存在し、専用の STAGE5 ページは実装されていない。

### AI生成処理の有無
生成系エンドポイントは **15個** 存在し、OpenAI (`gpt-4o`, `gpt-4o-turbo`, `gpt-4o-mini`) と統合されている。主要な生成処理は以下の通り：
- `/api/stage2/generate-draft` : ドラフト＆勝ち筋候補生成
- `/api/stage2/generate-final` : 最終ストーリー生成（North Star 整合性チェック付き）
- `/api/generate-cascade` : 部門・プロジェクト・OKR カスケード生成
- `/api/generate-department-xxx` : 部門別サポート生成
- `/api/generate-hint`, `/api/generate-advice`, `/api/generate-insight` : 支援・分析生成
- `/api/ask-ceo-agent` : AI Coach エージェント（RAG + 意図ルータ統合）

ただし、2ndpass 修復や North Star 未入力時の注記など、生成結果の品質維持機構も実装されている。

### 保存層の構成
GROWTH は **Supabase + Zustand + localStorage** の3層構成：
- **Supabase**: 永続化層（`strategy_data`, `okrs`, `company_members`, `invitations` テーブル）
- **Zustand (`strategyStore`)**: メモリキャッシュ（計算結果やUI状態を高速アクセス）
- **localStorage**: クライアント一時保存（STAGE1/2 スナップショット、セッション情報）

すべてのステージで `useAutoSave` hook (debounce 1200ms) により自動保存が有効。保存時は `saveWithAudit()` で caller・trigger・revision をログに記録。

### 権限管理（RBAC）の有無
RBAC は **admin/manager/member** の3段階で実装。
- `lib/rbac.ts` で Capabilities マトリックス定義
- `/lib/server/rbacGuard.ts` で API 層権限チェック
- `useAccess()` hook でクライアント側権限判定
- メンバーシップテーブルで user → company_id → role を解決

権限変更は即座に次の API 呼び出しで適用（リアルタイム RLS 反映）。

### 競合復旧の有無
楽観ロック機構が実装：
- `revision` フィールドで DB 更新バージョン管理
- API 409 衝突時に `lastConflictInfo` 記録
- `conflictCooldownUntil` による自動リトライ（cooldown 期間経過後）
- ユーザーへは SaveStatusIndicator で通知

### 下流→上流の自動反映の有無
**未実装**。STAGE6 で計算した `northStarRows` (達成率)、`simulationResult` (3年予測)、`projectContributions` (貢献度) がいずれも上流（STAGE2-4）の修正判断に自動フィードバックされない。ユーザーが手動で上流ページに戻って修正する流れのみ。

### Realtime協調編集の有無
**未確認**。Supabase Realtime subscription による複数ユーザーの同時編集自動反映実装は確認できず。スナップショット復元による間接的な状態同期のみ確認（`restoreWithAudit()` で DB 再読み込み）。

### 未確認事項の扱い
コード上で確認できない項目（progressLogs DB テーブル確定、answers2 永続化実装、projectTargetImpacts 更新箇所など）は「不明」と明記し、確認すべきファイル箇所を指摘。特許審査での詳細確認時の参考資料として機能。

---

