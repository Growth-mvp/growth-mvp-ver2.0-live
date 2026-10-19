# 経営計画書（ステークホルダー別）生成・保存・復元 設計書

**対象**: 銀行向け（bank）／株主向け（shareholder）／社員向け（employee）の経営計画書
**状態**: 実装済み（ローカル検証まで）。ステージングでの実物検証、本番での適用版の照合は未実施
**統合元**: `DESIGN_PLAN_STORAGE.md`（v5）、`FINAL_DESIGN_REVIEW.md`、`design-docs/3-stakeholder-plan-detailed-design.md`
**関連仕様**: [docs/spec/10-stakeholder-plans.md](../spec/10-stakeholder-plans.md)
**DB変更履歴**: [docs/deployment/DB_CHANGE_HISTORY.md](../deployment/DB_CHANGE_HISTORY.md)

---

## 1. 方針

| 項目 | 内容 |
|------|------|
| 既存テーブル | 変更しない（`strategy_data` などに列・制約を追加しない） |
| 会社移動 | 計画書は移動・削除・NULL化しない。**読み取り時に照合**する（API と RLS の両方） |
| 旧計画書 | 参照対象外になっても当面保持。戦略が旧会社に戻ると再表示されるため、**生成日時を必ず表示** |
| 生成と保存 | 生成 API が生成直後に保存する。クライアントから本文を受け取らない |
| 保存失敗 | 1 回の安全なリトライ → 未保存表示 → 本文コピー → Markdown ダウンロード → 離脱確認。**AI の自動再生成はしない** |
| 権限 | 生成・再生成は admin / manager。member は閲覧のみ |
| 鮮度判定 | 行わない（`revision` は使わない） |
| 認証機構・環境変数 | 追加しない |

## 2. テーブルと書き込み

- `public.generated_plans`: `(company_id, strategy_id, audience)` で一意。1 件が最新版。
- 書き込みは API（service_role）のみ。`authenticated` は SELECT のみ。
- トリガー `generated_plans_guard()`（INSERT・UPDATE）:
  - `id / company_id / strategy_id / audience / created_by / created_at` は UPDATE で変更不可。
  - 書き込み時に、戦略の現在の `company_id` が計画書の `company_id` と一致することを検査する。不一致は 42501。
  - UPDATE 時は `version` を +1 し、`updated_at` を更新する。
- 列: `generated_text`、`sections`（章ごとの配列）、`generated_at`、`version`、`updated_at`、`created_by`、`updated_by`。

## 3. 会社移動（読み取り時照合）

**参照条件**: 計画書の `company_id` が、戦略の現在の `company_id` と一致すること。

| 層 | 実装 |
|----|------|
| API（saved） | `strategy_data` を `id` と `company_id` で確認（不一致は 403）。計画書を `company_id`・`strategy_id`・`audience` で検索（無ければ 404） |
| RLS（SELECT） | 所属者であること AND `strategy_data` の `id` と `company_id` が計画書と一致すること |

**移動の例（戦略 S が会社 A → 会社 C）**

| 操作 | 結果 |
|------|------|
| 戦略の移動 | 成功（既存どおり）。計画書は変化しない |
| 会社 A の利用者が参照 | 0 件（戦略の会社が一致しない） |
| 会社 C の利用者が参照 | 0 件（計画書の会社が A） |
| 会社 C が S の計画書を生成 | 新しい行を作成（一意制約と衝突しない） |
| 戦略を A に戻す | A の旧い計画書が再び見える。生成日時を表示して判断する |

**残存データ**: 参照対象外の旧い行は当面残す。確認用の読み取りクエリ:

```sql
SELECT gp.id, gp.company_id, gp.strategy_id, gp.audience, gp.generated_at
FROM public.generated_plans gp
JOIN public.strategy_data s ON s.id = gp.strategy_id
WHERE s.company_id <> gp.company_id;
```

**既存の制約**: `strategy_data` は `company_id` が一意（1 社 1 戦略）。戦略の移動先は戦略を持たない会社に限られる（既存の挙動。変更しない）。

## 4. 生成・保存・表示

### 4-1. 生成 API（`POST /api/plans/[audience]/generate`）

1. 認証 → 入力の検証（`companyId`・`strategyId` は UUID、`audience` は 3 種）→ 所属確認
2. ロール判定（admin / manager のみ。member は 403）
3. `strategy_data` を `id` と `company_id` で取得（不一致は 403）。会社名が無い場合は 400
4. 既存の生成処理で本文と章（sections）を作る。`planGenerate` のモデル設定を使う（`config/models.json`）
5. 保存（1 回の安全なリトライ付き）
   - 既存行があれば `UPDATE ... WHERE id = ? AND version = ?`、無ければ INSERT
   - 競合（別の生成が先に保存した）はリトライしない
   - 一時的な DB エラーのみ、同じ内容で 1 回だけ再試行する
6. 応答: 保存成功なら `status: 'saved'`。保存失敗なら `status: 'unsaved'` と本文を返す（500 にしない）
7. 監査ログ: `PLAN_GENERATE`、失敗時 `PLAN_GENERATE_FAILED`、保存失敗時 `PLAN_SAVE_FAILED`

### 4-2. 保存失敗時の画面

| 段階 | 対応 |
|------|------|
| 1 | サーバーが 1 回だけ再試行する（AI は再実行しない） |
| 2 | 「未保存」バナーを表示し、本文は表示したままにする |
| 3 | 「コピー」（クリップボード）と「Markdown ダウンロード」（メモリ上の本文から生成）を提供する |
| 4 | 未保存の間は `beforeunload` で離脱を確認する。会社・戦略の切替時も確認する |

- AI の自動再生成はしない。ユーザーが「生成して保存」を押したときだけ再生成する。
- 再保存用のエンドポイントは作らない。本文の保存はサーバー生成の結果だけ。
- 本文を `localStorage` / `sessionStorage` に保存しない。
- 残るリスク: 未保存のまま、コピーもダウンロードもせずにタブを閉じると本文は失われる（許容）。

### 4-3. 保存済みの取得 API（`POST /api/plans/[audience]/saved`）

- 全ロール（admin / manager / member）が利用できる。
- §3 の照合を行い、一致すれば `generatedText`・`sections`・`generatedAt`・`version` を返す。
- 画面には必ず生成日時を表示する。

## 5. 権限

| 操作 | admin | manager | member |
|------|-------|---------|--------|
| 閲覧（saved） | 可 | 可 | 可 |
| 生成・再生成（generate） | 可 | 可 | 不可（API は 403） |

- API: generate で member は 403。RLS は計画書への書き込みを許可しない（書き込みは API 経由のみ）。
- UI: 計画書の 4 画面で、member には「生成」「再生成」ボタンを表示しない（`canGeneratePlan(role)`）。
- 既存への影響: 生成 API を呼ぶ画面は計画書の画面のみ。`stakeholder-select` は選択画面で、生成 API は呼ばない。

## 6. 戦略保存とのロック（承認済み方針: 待ちを受け入れる）

通常の戦略保存と計画書の保存の間に、ロック待ちが発生することを受け入れる。戦略保存処理（`utils/supabase/strategy.ts`）は変更しない。

**ローカル実測（PostgreSQL 17、隔離 DB、架空データ）**

| 先に開いたトランザクション | 後から来た操作 | 結果 |
|---|---|---|
| 計画書の保存（INSERT、未コミット） | 通常の戦略保存（`departments` と `updated_at` のみ） | 待たない |
| 計画書の保存（INSERT、未コミット） | 通常の戦略保存（`company_id` を同じ値で SET） | 保持側のコミットまで待つ |
| 計画書の保存（INSERT、未コミット） | 会社移動（`company_id` を別の値に変更） | コミットまで待つ |
| 会社移動（未コミット） | 計画書の保存 | コミットまで待つ |
| いずれの組み合わせでも | — | デッドロック（40P01）は観測されなかった |

**理由**: `company_id` は一意インデックスの列のため、SET 句に含まれると同じ値でも `FOR UPDATE` の行ロックを取る。計画書側は外部キー検査で `FOR KEY SHARE` を取る。計画書テーブル固有の問題ではなく、戦略行を参照する他テーブルにも同じ性質がある。

**影響**: 計画書の保存は 1 文の自動コミットで、保持時間は数ミリ秒と見込まれる。計画書の保存が開いたまま残る経路はアプリにない。

**残件（保留）**: 戦略保存側で `company_id` を変更しない場合に SET から外す最適化。既存の戦略保存処理の変更になるため行わない。

## 7. 検証状況

| 項目 | 状態 |
|------|------|
| マイグレーションを 2 回連続適用 | ローカル PGlite（PostgreSQL 18）で成功 |
| 整合・不変性・会社移動・RLS・権限・取り消し（16 件） | ローカル PGlite で全件 PASS |
| 検証の有効性（故意に壊したマイグレーション 2 種） | 検出できることを確認 |
| 単体・API のテスト（生成・取得・権限・会社切替） | リポジトリのテストで実施（関連テスト合格。詳細は完了記録） |
| ロック待ち・同時保存・保存失敗の実挙動 | **未確認**（ステージングで実施する） |
| 本番 | `generated_plans` の作成は申告済み。リポジトリの SQL と適用版の一致は**未確認** |

**ローカル検証の制約**: PGlite の stub（`auth`・ロール・既存テーブルの最小版）で実行した。`strategy_data` の RLS と `propagate_company_change` は含めていない。

## 8. ステージング検証手順

1. 本番のスナップショットではなく、ステージング（または使い捨て DB）に適用する。
2. 適用版を確認したうえで `MIGRATION_GENERATED_PLANS.sql` を適用し、2 回目も適用する。
3. `scripts/sql/generated_plans_verify.sql` を実行する（`BEGIN ... ROLLBACK` で囲まれている）。
4. §6 のロック手順を実行する。
5. 同時保存: 同じ `(company, strategy, audience)` に 2 つの生成を同時に送り、後発が競合（未保存）になることを確認する。
6. 保存失敗: DB を一時的に止める（または権限を外す）模擬で、`unsaved` の応答と画面の表示を確認する。AI の自動再実行がないことも確認する。
7. 結果を記録する。本番適用は別途承認する。

## 9. 既知の課題

| 課題 | 内容 | 扱い |
|------|------|------|
| 単位の推定 | 既存の復元処理（`utils/supabase/strategy.ts` の金額復元）が、値の大きさ（100 万未満）で「百万円」と推定し換算する。単位未確認の方針と矛盾する | 要対応（既存処理の変更を伴うため、別途判断） |
| 章構成の差 | 設計書（3-stakeholder-plan-detailed-design）は銀行 7 章・株主 6 章・社員 5 章。実装（生成プロンプト）は 3 種とも 5 章 | 実装を正とする。設計書の章構成は見直しが必要 |
| 参照対象外の旧計画書 | 保持期間と削除方法は未決定 | 承認事項（現時点では削除しない） |
| 本番の適用版 | リポジトリの `MIGRATION_GENERATED_PLANS.sql` は「DRAFT / 未適用」のヘッダのまま。適用版との一致は未確認 | 適用版の SQL 全文を入手して照合する |
| 画面の重複 | `bank-plan`・`shareholder-plan`・`employee-plan` の 3 画面と、`[audience]-plan` は同じ構成の重複 | 整理候補（コード変更は別途） |
| 権限の境界 | 戦略テーブルの書き込みは所属者全員に可能（計画書機能の外の既存事項） | [docs/security-log/2026-10-19_company-isolation-and-rbac-record.md](../security-log/2026-10-19_company-isolation-and-rbac-record.md) を参照 |

## 10. 関連ファイル

- API: `app/api/plans/[audience]/generate/route.ts`、`app/api/plans/[audience]/saved/route.ts`
- サーバー側の保存: `utils/supabase/generated-plans.ts`（service_role、再試行と競合の扱い）
- 計画書の状態: `lib/plans/planDocumentState.ts`、`lib/plans/generationController.ts`
- 計画書データの構築: `utils/export/buildPlanData.ts`
- UI: `app/report/[audience]-plan/page.tsx`、`app/report/{bank,shareholder,employee}-plan/page.tsx`、`app/report/stakeholder-select/page.tsx`、`components/export/Plan*.tsx`、`hooks/usePlan*.ts`
- マイグレーションと検証: `MIGRATION_GENERATED_PLANS.sql`（リポジトリ直下。適用版の照合待ち）、`scripts/sql/generated_plans_verify.sql`
