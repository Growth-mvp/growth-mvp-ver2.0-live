# 会社間データ分離と権限設計の記録（2026-10-19 時点）

**目的**: 経営計画書機能の公開前に確認した、会社間データ分離とロール権限の状態を記録する。
**性質**: 実施済みの確認の記録。現在の仕様は [docs/spec/03-auth-rbac.md](../spec/03-auth-rbac.md) と [docs/spec/10-stakeholder-plans.md](../spec/10-stakeholder-plans.md) を参照する。
**確認の区分**: 「コード確認」はリポジトリのコードを読んだ結果。「カタログ確認（申告）」は本番 Supabase の設定を利用者が確認し、報告された結果。「未確認」は確認していないもの。

---

## 1. アプリ層（API）の会社間分離

経営計画書の API（コード確認）。

| API | 検証の順序 | 会社間の分離 |
|---|---|---|
| `POST /api/plans/{audience}/generate` | 認証 → 入力検証 → 所属（`requireMembership`）→ ロール（admin / manager）→ 戦略を `id` と `company_id` で取得 → 戦略 ID の一致 | 他社の `companyId` は所属で 403。他社の `strategyId` は会社条件で 404 |
| `POST /api/plans/{audience}/saved` | 認証 → 入力検証 → URL と本体の audience の一致 → 所属 → 戦略が会社に属すること → 計画書を会社・戦略・audience で検索 | 他社の戦略は 403。他社の計画書は読めない |

サーバー側の書き込み（`utils/supabase/generated-plans.ts`）は service_role で行うが、呼び出し前に上記の検証を通す。DB 側でも、トリガーが戦略の会社との一致を検査する（不一致は 42501）。

**他社 strategyId の検査（旧 `SECURITY_FUNCTIONAL_TEST.md` の問題 1）**: 生成 API に、取得した戦略の ID と要求の戦略 ID の一致確認（403）が入っている（コード確認）。解消済み。

## 2. 会社切替時のクライアント側の分離

会社が切り替わった際に、旧会社のデータや保存応答が新会社の状態を書き換えないよう、次の対策を入れた（コード確認・単体テスト）。

| 対策 | 対象 | テスト |
|---|---|---|
| 会社・戦略スコープの照合（世代番号で A→B→A も検出） | `lib/strategy/saveScope.ts` | `lib/strategy/saveScope.test.ts`（8 件） |
| 保存応答の反映前の照合（ストア更新の抑止） | `store/strategyStore.ts`（保存・再読み込み） | `store/strategyStore.refetch.test.ts` |
| 直接保存の照合（SWOT・ポートフォリオ・財務・stage2 の生成と保存） | `components/steps/Step2SWOT.tsx`、`Step2Portfolio.tsx`、`Step3FinanceUpload.tsx`、`app/stage2/page.tsx` | 上記の `saveScope` の単体テストで判定ロジックを検証 |
| OKR 書き込みの所属確認（会社・戦略・プロジェクト） | `app/okr/page.tsx`、`lib/strategy/okrWriteScope.ts` | `lib/strategy/okrWriteScope.test.ts`（4 件） |
| 財務入力状態の会社別リセット | `store/strategyStore.ts`（`financeActual` / `financePlan`）、`components/steps/Step3FinanceUpload.tsx` | `store/strategyStore.refetch.test.ts` |

**未対応（コード確認）**: 次の経路は上記の対策の対象外。切替直後の保存で、他社のデータを書き込む可能性が残る。

- `app/story-process/page.tsx` の自動保存（800ms のタイマーが閉包の会社 ID を使う。`saveFinalStory` の会社 ID 指定が Cookie を書き換える）
- `components/steps/Step5Confirm.tsx` の確定保存（AI 生成の待機後に、ストアの値と閉包の会社 ID を組み合わせて保存する）
- `utils/supabase/strategy.ts` の `resolveCompanyId`（会社 ID の指定があると Cookie を書き換える）

これらは、同一タブで会社 ID が変わる場合（主に、別タブでの別アカウントのログイン）に限って発生する。同一タブでの会社切替 UI は確認されていない。

## 3. データベース層（RLS・権限）

### 3-1. 対象テーブルの状態

| テーブル | 状態 | 出典 |
|---|---|---|
| `generated_plans` | RLS 有効。SELECT は所属者かつ戦略の会社が一致する行のみ（`authenticated`）。書き込みは service_role のみ。トリガー `trg_generated_plans_guard` 有効 | カタログ確認（申告）。リポジトリの定義は `MIGRATION_GENERATED_PLANS.sql` |
| `strategy_data` | RLS 有効。SELECT・INSERT・UPDATE は所属者に許可。DELETE は 2026-10-19 に admin のみへ変更（申告） | カタログ確認（申告）。変更の詳細は [docs/deployment/DB_CHANGE_HISTORY.md](../deployment/DB_CHANGE_HISTORY.md) |
| `company_members` | RLS 有効。INSERT のポリシーは無い（authenticated には INSERT 権限がある）。UPDATE・DELETE は同じ会社の admin に許可 | カタログ確認（申告） |

### 3-2. 確認できていない事項（未確認）

- `generated_plans` の本番の適用版と、リポジトリの SQL の一致（リポジトリのヘッダは「DRAFT / 未適用」のまま）。
- `strategy_delete` の変更前の条件式（ロールバック用に必要）と、ロール別の DELETE の実動作テスト（未実施）。
- `company_members` の UPDATE の `WITH CHECK`（所属の付け替えの可否に関わる）。
- `strategy_data` の UPDATE に対する制限（member も STAGE1〜3 を更新できる状態。運用ガイドでは閲覧のみ）。
- `okrs`・`progress_logs` の RLS。
- 既定権限（`ALTER DEFAULT PRIVILEGES`）で、新規テーブルに `anon`・`authenticated` の全権限が付く設定の有無（2026-07-08 のダンプで確認。本番の現状は未確認）。
- `generated_plans` に対する `anon`・`PUBLIC` の権限の不在（申告。ACL の直接確認は未実施）。

## 4. ロール別権限（現状の整理）

| 操作 | admin | manager | member | DB の許可 | 整合 |
|---|---|---|---|---|---|
| STAGE1〜3 の閲覧 | 可 | 可 | 可 | 所属者は SELECT 可 | 整合 |
| STAGE1〜3 の編集 | 可 | 可（運用ガイド） | 不可（運用ガイド） | 所属者は UPDATE 可 | **不一致**（UI の `readOnly` は無効、バナーは「admin のみ」） |
| STAGE4 の編集（KPI・投資など） | 可 | 可 | 可（運用ガイド） | 所属者は UPDATE 可 | 概ね整合。能力定義（`lib/rbac.ts`）の `strategy:edit` は member が false で、仕様と食い違う |
| STAGE5 の進捗ログ入力 | 可 | 可 | 可 | `progress_logs` の RLS は未確認 | 未確認 |
| STAGE6 の閲覧・編集 | 閲覧 | 閲覧 | 閲覧（運用ガイド） | 所属者は UPDATE 可 | 未確認（STAGE6 の UI に権限判定が無い） |
| 計画書の生成・再生成 | 可 | 可 | 不可 | API で admin / manager のみ | 整合 |
| 計画書の閲覧 | 可 | 可 | 可 | API は全ロール。RLS は所属者 | 整合 |
| 戦略データの DELETE | 可 | 不可 | 不可 | admin のみ（申告。変更後） | 整合（申告。実動作は未確認） |
| 会社データの一括削除 | 可 | 不可 | 不可 | API は admin の所属のみ（サービスロール） | 整合 |
| メンバーの招待・削除 | 可 | 不可 | 不可 | API は admin を確認 | 整合（API）。UI の一部は直接操作（下記） |
| メンバーのロール変更 | 可 | 不可 | 不可 | API は admin と「最後の管理者」の保護あり。UI（管理画面）は直接 UPDATE | **不一致**（UI は API のガードを通らない） |
| 所属の自己追加（参加） | — | — | — | DB に INSERT ポリシーなし | オンボーディング・ログイン時の参加は、ブラウザからの INSERT を使うため失敗する可能性（未確認） |

## 5. 残存リスクと優先度

| 区分 | 内容 | 状態 |
|---|---|---|
| P0 | `strategy_data` の DELETE が member に可能（所属者全員）。戦略行の削除は 1 操作で可能になる | 変更済み（申告）。実動作テストで確認が必要 |
| P1 | `strategy_data` の UPDATE を member が行える（STAGE1〜3 を閲覧のみとする仕様と不一致） | 未対応。列単位の制限（トリガー）の設計が必要 |
| P1 | 管理画面のロール変更が API のガードを通らない | 未対応 |
| P1 | `company_members` の参加フロー（ブラウザからの INSERT）が、INSERT ポリシー無しで失敗する可能性 | 未確認（実機で確認） |
| P1 | `company_members` の UPDATE の `WITH CHECK` が未確認 | 未確認（本番のポリシー定義の確認が必要） |
| P1 | 画面の表示中に会社 ID が変わった場合に、story-process・Step5 の保存が他社へ書き込む経路（§2） | 未対応 |
| P1 | `resolveCompanyId` の Cookie 書き換え（§2） | 未対応 |
| P2 | `deleteStrategyData` が未使用の残存コード（会社単位で関連テーブルを削除する関数） | 削除候補 |
| P2 | 会社一括削除の対象が「最新の admin 所属会社」で、利用者が選べない | 未対応 |
| P2 | 能力定義（`lib/rbac.ts`）と運用ガイドの不一致（member の戦略編集、Viewer ロール） | 仕様の確定が必要 |

## 6. 過去の検証記録の扱い

- `SECURITY_FUNCTIONAL_TEST.md` と `test-security.md`（Phase 2。元の資料は [docs/archive/stakeholder-plan-dev-2026-10/](../archive/stakeholder-plan-dev-2026-10/) にある）: コード検査は実施済み。動作テストは未実施。Test 6 の問題はコードで解消済み（§1）。動作テストは本番ではなくステージングで実施する（旧資料の「ローカルのみ」の記述は、この方針で置き換える）。
- 旧テストの手順に残っている誤り（実施前に直す）:
  - 他社 strategyId の期待値。戦略が存在しない場合は 404（`app/api/plans/[audience]/generate/route.ts:118-119`）、会社と戦略が一致しない場合は 403（同 `:139-140`）。旧資料の「403」は後者だけ
  - 不正トークンの期待値。認証は先に行われるため 401（同 `:62-64`）。`test-security.md` の「400」は誤り
  - 「実会社名を AI に送らない」という前提。生成プロンプトには会社名が含まれる（同 `:629`）ため、成り立たない
- 旧テストで未検証のまま残っている項目: `buildPlanData` の audience フィルタ、AI に渡すデータの範囲、audit ログに本文が含まれないこと（`route.ts` の監査ログの呼び出し 3 箇所は未確認）。
- DB 書き込みの確認: 書き込みは生成側の保存（`generated_plans`、service_role）だけ。`/saved` は読み取りのみ（コード確認済み）。旧資料の「DB に保存しない」は現行と一致しない（旧記載として扱う）。
- 未実施の確認項目と手順は [docs/testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md](../testing/STAKEHOLDER_PLAN_TEST_CHECKLIST.md) §2 にある。
- 本番の RLS の検証（`docs/security-log/` の 2026-07 の文書群）は、2026-07-08 時点の記録であり、本記録の §3 の申告内容とは時点が異なる。

## 7. 次に必要な確認

1. 本番の `strategy_data` の DELETE ポリシーの変更前後の条件式（`pg_policies`）を記録する。
2. `company_members` の全ポリシーの `WITH CHECK` を確認する。
3. ロール別の DELETE 動作テスト（admin 可、manager・member・非所属は拒否）をステージングで実施する。
4. member の STAGE4 の通常更新が成功することを確認する（DELETE の変更で影響しないこと）。
5. 上記 P1 の扱いを、仕様（運用ガイド）と合わせて決める。
6. 旧テストの手順を、§6 の訂正（404・401・会社名の前提）に合わせて直してからステージングで実施する。
7. AI に渡すデータの範囲（`buildPlanData` の audience フィルタ、プロンプトの入力）を確認する。
8. 監査ログ（`route.ts` の 3 箇所）に、本文や機密情報が含まれないことを確認する。
