# 05. 組織変革ルーム（Org Alignment）

本書は、6 ステージと並行する組織変革機能の仕様を記述する。現場の「違和感」を AI 対話で言語化・分類し（個人ルーム）、会社全体で集計・共有・すり合わせ・戦略還流まで行う（全社ルーム）。

- **関連**: テーブル定義の migration は [02] §1、匿名性（`VisibilityMode`）の監査項目は [08] J-01・J-02 を参照。

| 画面 | ルート |
|---|---|
| 個人ルーム | `/org-transformation` |
| 全社すり合わせルーム | `/org-transformation/shared` |
| 管理者インサイト | `/admin/org-insights` |

## 1. ドメイン概念（`types/org-alignment.ts`）

| 概念 | 説明 |
|---|---|
| Case（ケース） | 個人が投稿する「違和感」。`org_alignment_cases` |
| `CounterpartyType` | 相手の属性: executive / manager / own_department / other_department / backoffice / field_member / customer / unknown / other |
| `VisibilityMode` | 公開範囲: `anonymous` / `manager_only` / `named` |
| `OrgAlignmentStatus` | ケース状態: draft → generated → alignment_requested → in_alignment → closed |
| `OrgAlignmentIssueType` | ズレの種類（11 区分）: 部門間連携／経営と現場／戦略と実行／実行と評価制度／役割責任／優先順位／意思決定基準／情報共有／挑戦と失敗許容／ツール不信／その他 |
| Insight（インサイト） | 会社単位の AI 集計。`org_alignment_insights` |
| Shared Topic（共有トピック） | 全社に公開する論点。`org_alignment_shared_topics` |
| Request（依頼） | すり合わせ依頼。`org_alignment_requests` |
| Reflection Candidate | Stage3/4 への反映候補。`org_alignment_stage_reflection_candidates` |

## 2. 個人ルーム（`/org-transformation`）

### フロー
1. **インタビュー/インテイク**: AI 対話または固定フォームで違和感を入力。
   - `components/org-transformation/OrgAlignmentIntakeChat.tsx`（対話）/ `OrgAlignmentFixedIntakeForm.tsx`（固定フォーム）/ `OrgAlignmentIntakeReviewCard.tsx`（確認）。
   - API: `POST /api/org-alignment/intake`。
2. **生成**: 入力からケース（論点・相手属性・公開範囲）を AI 生成。
   - API: `POST /api/org-alignment/generate`。状態は `draft → generated`。
3. **すり合わせ依頼**: 必要に応じて管理者へすり合わせを依頼。
   - API: `POST /api/org-alignment/cases/[id]/request-alignment` → `org_alignment_requests`（status `pending`）。状態 `alignment_requested`。
- 公開範囲（`VisibilityMode`）により、`userName` / `userEmail` の表示可否が決まる。

## 3. 全社すり合わせルーム（`/org-transformation/shared`）

会社全体の集計・共有トピック・反映候補を扱う（メンバーも閲覧可能な `visibility: 'company'`）。

- 共有トピック一覧: `GET /api/org-alignment/shared/topics`。トピック更新: `PATCH /api/org-alignment/shared/topics/[id]`。
- 集計サマリ: `GET /api/org-alignment/shared/summary`。
- Stage 反映候補: `/api/org-alignment/shared/reflection-candidates`, `/topics/[id]/reflection-candidates`, `/topics/reset-reflection`。
- 未対応のすり合わせ依頼表示: `components/org-alignment/UnhandledAlignmentRequestsSection.tsx`。

### 共有トピックのデータ（`org_alignment_shared_topics`）

`title` / `summary` / `status`（draft / published / in_alignment / action_planned / reflected_to_strategy / closed）/ `priority_score` / `importance`（高中低）/ `urgency` / `impact_scope` / `affected_departments`(jsonb) / `recognition_gap`(jsonb: fieldView/companyView/gapEssence) / `company_axis` / `session_type` / `next_actions`(jsonb) / `strategy_reflection`(jsonb: stage3Status/stage4Status/relatedDepartments/generatedProjects/generatedOkrs) / `visibility`（company/draft）/ `published_by`。

- 自動公開・関連ケース数・ソースインサイト紐付け等は段階的にマイグレーションで追加（`20260610130000`〜`20260610180000`）。

## 4. 管理者インサイト（`/admin/org-insights`）

会社単位の AI 集計を生成・管理し、共有トピック化・告知・すり合わせ依頼対応を行う。

### インサイト生成（`org_alignment_insights`）
- `POST /api/org-alignment/admin/insights/generate` … 会社のケース群を集計し AI でインサイト生成。
  - 保存: `summary` / `insights`(jsonb) / `category_counts` / `priority_counts`{low,medium,high} / `department_trends` / `source_case_count` / `generated_by` / `generated_at`。
- `GET /api/org-alignment/admin/insights`, `PATCH /api/org-alignment/admin/insights/[id]/actions`。
- ソースケース: `org_alignment_insight_sources`。

### `OrgAlignmentInsight`（集計論点）の主フィールド
`title` / `description` / `relatedIssueTypes` / `affectedDepartments` / `recommendedActions` / `stage3Stage4Relevance` / `relatedCaseCount` / `priorityScore`(0-100) / `importance` / `urgency` / `impactScope` / `recognitionGap`{fieldView, companyView, gapEssence} / `companyAxis` / `sessionType` / `nextActions[]`（`OrgInsightNextAction`: title/owner/dueDate/status）/ `strategyReflection`{stage3Status, stage4Status, ...} / `announcement`。

### すり合わせ依頼・共有トピック管理（admin）
- 依頼: `GET /api/org-alignment/admin/requests`, `PATCH /api/org-alignment/admin/requests/[id]`（status: pending → reviewing → scheduled → resolved / on_hold、`handled_by` / `admin_note`）。
- 共有トピック: `/api/org-alignment/admin/shared-topics`, `/[id]`, `/[id]/announcement`, `/announcement`。

## 5. 戦略への還流（Stage 3/4 連携）

共有トピック/インサイトには `strategy_reflection`（stage3Status / stage4Status / relatedDepartments / generatedProjects / generatedOkrs）があり、論点を Stage 3 の部門・プロジェクトや Stage 4 の OKR に反映する候補として扱う。
反映候補は `org_alignment_stage_reflection_candidates` で管理し、Stage 3/4 画面の `ReflectionCandidatesSection` が利用する。

---

## 変更履歴

| 日付 | 変更内容 | 変更者 |
|---|---|---|
| 2026-06-22 | 初版（基準コミット `f7b9c03`） | 仕様書作成（Claude Code） |
| 2026-07-06 | 表記統一（目的宣言・関連文書・ルート表・変更履歴の追加） | ドキュメント整備（Claude Code） |
