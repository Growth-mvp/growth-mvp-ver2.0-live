# 02. データモデル

## 1. Supabase テーブル一覧

コード（`.from('...')`）で参照されるテーブルを以下に整理する。
コア 6 テーブル（`companies` / `company_members` / `profiles` / `strategy_data` / `okrs` / `progress_logs`）の **定義 SQL はリポジトリの `supabase/migrations/` に含まれていない**ため、列構成は **コード参照からの【推定】**を含む。組織変革（org_alignment）系・招待系はマイグレーション SQL が存在し確定。

| テーブル | 役割 | 定義の所在 |
|---|---|---|
| `companies` | 会社（テナント） | 【推定】 |
| `company_members` | 所属（user × company × role × department_id） | 【推定】 |
| `profiles` | ユーザープロフィール | 【推定】 |
| `strategy_data` | 会社の戦略データ本体（1 会社 1 行・巨大 JSONB） | 【推定】 |
| `okrs` | OKR の正本（行ベース） | 【推定】（`utils/supabase/okrsRepository.ts` から列を確認） |
| `progress_logs` | Stage 5 進捗ログ | 【推定】 |
| `company_invites` | アプリ制御の招待トークン | `20260212130000_create_company_invites.sql` |
| `org_alignment_cases` | 組織違和感ケース | 【推定】（migration から参照） |
| `org_alignment_insights` | 会社単位 AI 集計インサイト | `20260610000000_*.sql` |
| `org_alignment_insight_sources` | インサイトのソースケース | `20260610170000_*.sql` |
| `org_alignment_shared_topics` | 全社共有トピック | `20260610120000_*.sql` ほか |
| `org_alignment_requests` | すり合わせ依頼 | `20260617_create_org_alignment_requests.sql` |
| `org_alignment_stage_reflection_candidates` | ステージ反映候補 | `20260617_*.sql` |
| `agent_logs` | AI エージェント呼び出しログ | 【推定】（`lib/supabase/agentLogs.ts`） |

### 1.1 コアテーブルの既知列（コード／マイグレーション由来）

> コア 6 テーブルの定義 SQL がリポジトリに無いため、以下は **コードの `select`/`insert` と型定義から判明する列**を整理したもの。
> **型・NOT NULL・デフォルト・CHECK・索引・RLS ポリシーの詳細は実スキーマの introspect（`supabase db dump` / `information_schema`）が必要**（[09] 移行性の最優先課題）。型注記は推定。

| テーブル | 判明している列（コード由来） | RLS |
|---|---|---|
| `companies` | `id`(uuid)、会社名等 | 【未確認】 |
| `company_members` | `company_id`(uuid)・`user_id`(uuid)・`role`(text: admin/manager/member)・`department_id`(text/uuid, null可)・`status`・`created_at` | 【未確認】 |
| `profiles` | `id`(uuid, = auth.users.id)、プロフィール属性 | 【未確認】 |
| `strategy_data` | `id`(uuid)・`company_id`(uuid)・`user_id`(uuid)・`updated_by`(uuid)・`revision`(int, 楽観ロック)・`created_at`/`updated_at`・`departments`(jsonb)・`story`/`final_story`/`answers2`/`answers12`(jsonb)・`csv_finance_data`(jsonb)・`swot_suggestions`(jsonb)・`business_portfolio`(jsonb)・`finance_summary`(jsonb)・`simulation_result`(jsonb)・`stage1_issues`(jsonb)・`stage1_benchmarks`(jsonb) ほか | 【未確認】★ |
| `okrs` | `id`(uuid)・`company_id`・`strategy_id`・`department_id`(text)・`project_id`(text)・`objective`・`key_results_json`(jsonb)・`status`・`owner_user_id`・`owner_name`・`sort_order`・`source_okr_id`・`source_stage`・`meta_json`(jsonb)・`is_deleted`・`created_at`/`updated_at` | 【未確認】★ |
| `progress_logs` | `user_id`・`okr_id`(または `db_okr_id`)・`strategy_id`・`company_id`・`department`・`project`・`rating`・`progress_text`・`rating_comment`・`advice`・`help_request`・`created_at` | 【未確認】★ |
| `company_invites` | `id`・`company_id`(fk companies)・`email`・`role`(check admin/manager/member)・`token_hash`(unique)・`expires_at`・`accepted_at`・`accepted_by`(fk auth.users)・`created_by`(fk auth.users)・`created_at`。`(company_id,email) where accepted_at is null` 単一制約 | **有効**（migration） |
| `agent_logs` | `user_id`・`strategy_id`・`step`(int)・`role`(user/assistant)・`content`(text) | 【未確認】 |
| `org_alignment_*` | 各 migration 参照（`05-org-alignment.md`） | **有効**（migration） |

★ = **クライアント（ブラウザ）から anon キーで直接アクセスされるため、RLS の正しさがテナント分離の生命線**（[08] F-8）。

> **#1 課題（最優先）**: 上記を正本化するため、**コアスキーマ定義書＋ migration 化**（列型・制約・索引・RLS ポリシー・必須/任意・削除方針を含む）を行う。実スキーマの introspect が前提。

## 2. `strategy_data`（中核ブロブ）

Stage1〜6 の入力/成果の大半を 1 レコードに集約する。クライアントでは `strategyStore`（Zustand）がこのミラーになる。
TypeScript 上の純粋データ型は `types/strategy.ts` の **`StrategyData`**。

### 2.1 保持する主なデータ群

- **会社プロフィール**: `companyName`, `foundationYear`, `location`, `industry`, `revenue`, `employees`, `businessContent`, `customerSegment`
- **会計・期間**: `fiscalYearEnd`, `currency`, `periodStartYear`, `periodEndYear`
- **上場/指標準備**: `isListed`, `ticker`, `pbrManual`
- **財務（Stage 1）**: `financePL[]`, `financeBS[]`, `segmentPL{}`, `segmentBS{}`, `hqAdjustmentPL/BS`
- **5 指標分析**: `valueAnalysis`, `segmentValueAnalysis`
- **論点/ベンチマーク（Stage 1）**: `stage1Issues[]`, `stage1Benchmarks`
- **MVV / SWOT（Stage 2）**: `mission`, `vision`, `value`, `thought`, `ceoIntent`, `strength/weakness/opportunity/threat`, `swotSuggestions`
- **戦略ストーリー（Stage 2）**: `story[]`, `finalStory[]`, `storyDraft[]`, `finalStoryDraft/Edited/Final`, `answers2[]`, `answers12[]`, `winPatternsCandidate[]`
- **勝ち筋**: `winPatterns[]`, `winPatternPrimary`, `winPatternSecondary`
- **North Star（Stage 2/6）**: `companyTargets[]`
- **中計設計（Stage 2）**: `midtermStrategy`
- **部門カスケード（Stage 3）**: `departments[]`（各 `projects[]`、各 project の `okrs[]` / `okrsV2[]`）
- **実行計画（Stage 4）**: `stage4Plans[]`, `executionPlanBaseline`、プロジェクトの `role/roleDetail/impact*/planStatus/approvedAt/approvedBy/ownerUserId`
- **Stage 6 寄与**: `projectTargetImpacts[]`, `okrTargetScores{}`, `projectIssueLinks[]`, `simulationResult`
- **ポートフォリオ**: `businessPortfolio`, `financeSummary[]`, `csvFinanceData`

### 2.2 JSONB パッキングの注意（重要な実装事実）

DB 側に専用列が無いデータは既存 JSONB 列にパックされる（マイグレーション不要のため）。

- `csv_finance_data`（JSONB）に **`financeBS` / `segmentPL` / `segmentBS` / `hqAdjustmentPL` / `hqAdjustmentBS`** をパック（`types/strategy.ts` の `CsvFinanceData` コメント）。
- `swot_suggestions`（JSONB）に **`midtermStrategy`** をパック。
- パック処理: `utils/supabase/strategy.ts` の `buildDbRowFromState`／展開: `utils/supabase/normalize.ts` の `normalizeStrategyData`。

### 2.3 保存ペイロード生成

`strategyStore.buildSavePayload()` が `StrategyData` 相当を生成。保存前に以下を実施:
- `okrsV2` のサニタイズ（空 label 除外）
- department/project の `id` 補完（`dept_${idx}` / `proj_${i}_${j}`）
- `projectTargetImpacts` / `projectIssueLinks` のサニタイズ（NaN/0/不正 strength の除去）
- `pruneUndefinedDeep`（undefined/null/空文字の除去、空配列は保持）

## 3. ドメイン型（`types/strategy.ts` 主要型）

| 型 | 説明 |
|---|---|
| `WinPattern` / `WinPatternId` | 勝ち筋。`SHORT_REVENUE`/`FUTURE_INVEST`/`INDIRECT_PEOPLE`/`COST_FOCUS` ほか（`ExtensibleString` で拡張可） |
| `GrowthLever` | 成長レバー |
| `StrategyTrack` | `'EVOLVE'`（既存改善）/ `'EXPLORE'`（新規探索） |
| `Hypothesis` / `Impact` / `Probability` / `ValidationPlan` | 戦略 OKR の因果・期待インパクト・成功確率・検証設計 |
| `OKR` | 旧 OKR（`objective` + `keyResults: string[]` + `owner`）。戦略メタ任意 |
| `KRStructured` | 構造化 KR（財務ブリッジ用）。`KRKind`/`KRScope`/`KRUnit`/`BaseKey`/`MetricRole`/`Milestone`/`Evidence` |
| `Project` | 部門配下の実行単位。`okrs[]` / `okrsV2[]`、財務ロール（`role`/`roleDetail`）、`impactRevenueMJPY` 等、`planStatus`、`ownerUserId` |
| `Department` | 部門。`mission`、`projects[]`、勝ち筋・レバー |
| `BusinessSegment` / `BusinessPortfolio` / `BusinessUnit` | 事業セグメント・ポートフォリオ（PPM 等） |
| `FinancePLRow` / `FinanceBSRow` / `SegmentPLRow` / `SegmentBSRow` | 財務行 |
| `ValueAnalysis` | 5 指標（ROIC/WACC/PBR/成長率/利益率）の分析結果 |
| `IssueBlock` / `Stage1IssueBlock` | Stage 1 論点ブロック |
| `Stage1Benchmarks` / `BenchmarkTarget` | 外部ベンチマーク（任意入力） |
| `CompanyTarget` | North Star Metric（会社数値目標） |
| `ProjectTargetImpact` / `ProjectIssueLink` | Stage 6 Phase E：プロジェクト → North Star/論点 紐付け |
| `MidtermStrategy` | 中計設計（Stage 2 第 2 パス生成・任意） |
| `Stage4Plan` / `Stage4Baseline` / `Stage4Current` | Stage 4 実行計画（`status: 'Draft'|'Review'|'Approved'`、baseline/current diff） |
| `HumanInvestment` / `SkillPlan` / `ExecutionHumanInvestment` | 人的投資・スキル計画 |
| `ProgressLog` | 進捗ログ（`userId`/`okrId`/`progressText`/`rating`/`advice`/`helpRequest` 等） |

## 4. OKR の正本化（`okrs` テーブル）と二重ソース

OKR は **`okrs` テーブルが正本**、`strategy_data.departments[].projects[].okrs` は **スナップショット（fallback）**。

### 4.1 `okrs` テーブル列（`utils/supabase/okrsRepository.ts` / `types/okrs.ts` `OkrRow`）

```
id (uuid, PK)         company_id (uuid)      strategy_id (uuid)
department_id (text)  project_id (text)      objective (text)
key_results_json (jsonb)   status            owner_user_id   owner_name
source_okr_id         source_stage          sort_order
meta_json (jsonb)     is_deleted            created_at / updated_at
```

- `department_id` / `project_id` は **TEXT ベースの stable ID**（Phase 2A）。
- 論理削除（`is_deleted`）、並び順（`sort_order`）、生成元追跡（`source_okr_id` / `source_stage`）を持つ。

### 4.2 解決（読込）ロジック — `services/okrService.ts`

`resolveProjectsWithOkrs(projectId, departmentId, strategyData, companyId)`:
1. `okrs` テーブルから DB 読込（DB 優先）
2. `strategy_data` スナップショットから fallback OKR を取得
3. マージ（`OkrMergeResult`）し、各 OKR に `source`（DB/snapshot）を付与
4. `project.id` が無い legacy project は snapshot-only で扱う

設計原則: **DB 失敗時はスナップショットを更新しない**（failure safety）。Service 層は形状更新のみで、実保存は `useAutoSave`/`saveStrategyData` に委譲。

## 5. 進捗ログ `progress_logs`

Stage 5 のチェックイン履歴。`okrId` 単位で `progressText` / `rating` / `ratingComment` / `advice` / `helpRequest` を蓄積。CEOChat のコンテキストや Stage 6 の見立て材料にも使われる。

> Stage 5 周辺は OKR ID 解決（`db_okr_id` / stable ID）に関する既知の調整履歴が `docs/investigation/` および `docs/reports/STAGE5_*` に多数存在する。実装変更時は併読のこと。
