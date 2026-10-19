# 本番 Supabase の DB 変更履歴

**性質**: 本番 DB に対して実施した変更の記録。追記のみ（過去の記録は書き換えない）。
**記録の区分**: 「実施者の申告」は、実施者が報告した内容。「確認済み」は別の方法（SQL Editor での条件式の確認など）で確認した内容。「未確認」は確認していないもの。
**記録しないもの**: 接続情報、サービスロールキー、顧客の業務データ。

---

## 変更 1: `generated_plans` テーブルの作成（SQL v6）

| 項目 | 内容 |
|---|---|
| 対象 | `public.generated_plans` |
| 内容 | 経営計画書の保存テーブル（`(company_id, strategy_id, audience)` で一意）、索引、ガード関数 `generated_plans_guard()`、トリガー `trg_generated_plans_guard`、SELECT ポリシー `generated_plans_select` |
| 権限（定義） | RLS 有効。`PUBLIC`・`anon`・`authenticated` の全権限を取り消し、`authenticated` に SELECT のみを付与。`service_role` に全権限 |
| 実施者 | 実施者の申告 |
| 適用した SQL | v6。適用版の全文は本記録に含まれていない（**未確認**） |
| 確認 | 申告: RLS 有効、`authenticated` は SELECT のみ、`service_role` が書き込み、トリガー有効、localhost からの保存成功 |
| 未確認事項 | (1) リポジトリの `MIGRATION_GENERATED_PLANS.sql` は「DRAFT / 未適用」のヘッダのままで、適用版と一致するか未確認。一致を断定しない。(2) 本番の ACL（`anon`・`PUBLIC` に権限が無いこと）の直接確認は未実施。(3) トリガーの定義の直接確認は未実施 |
| 関連 | 設計: [docs/design/STAKEHOLDER_PLAN_DESIGN.md](../design/STAKEHOLDER_PLAN_DESIGN.md)、検証: `scripts/sql/generated_plans_verify.sql`（ステージング用） |
| ロールバック | 本番適用後に問題が出た場合のみ。`DROP TABLE IF EXISTS public.generated_plans; DROP FUNCTION IF EXISTS public.generated_plans_guard();`（承認後に実行） |

**適用版の確認方法（次に必要な作業）**: 実際に適用した SQL の全文を、Supabase のマイグレーション履歴または SQL Editor の実行履歴から入手し、リポジトリの SQL と差分を取る。差分があれば、適用版を正として本記録を更新する。

---

## 変更 2: `strategy_data` の `strategy_delete` ポリシーの変更

| 項目 | 内容 |
|---|---|
| 対象 | `public.strategy_data` のポリシー `strategy_delete`（DELETE） |
| 実施日 | 2026-10-19（実施者の申告） |
| 変更前 | 会社への所属があれば DELETE 可能（ダンプ上の定義から推定。**変更前の条件式の実物は未確認**） |
| 変更後 | 所属会社で `role = 'admin'` の場合のみ DELETE 可能 |
| 変更 SQL | 下記（実施者の申告） |
| 確認 | 本番 SQL Editor で変更後の条件式を確認（申告）。**ロール別の DELETE の実動作テストは未実施** |
| 変更していない操作 | SELECT・INSERT・UPDATE のポリシー |

**変更 SQL（実施者の申告）**

```sql
ALTER POLICY strategy_delete
ON public.strategy_data
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND m.company_id = strategy_data.company_id
      AND m.role = 'admin'
  )
);
```

**ロールバック（変更前の条件式が確認できるまでは未完成）**

変更前の条件式の実物（`pg_policies` の `qual`）を記録してから、次の形で戻す。変更前の条件式は、2026-07-08 のダンプでは次の形と記録されているが、本番の実物での確認は未実施。

```sql
ALTER POLICY strategy_delete
ON public.strategy_data
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.company_members m
    WHERE m.user_id = auth.uid()
      AND m.company_id = strategy_data.company_id
  )
);
```

**変更前後の確認 SQL（読み取りのみ）**

```sql
SELECT policyname, cmd, roles, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'strategy_data' AND cmd = 'DELETE';
```

**未確認事項**

1. 変更前の条件式の実物（ロールバックに必要）。
2. 変更後の `pg_policies` の出力を、本記録に保存すること。
3. admin 以外（manager・member・所属していない利用者）の DELETE が拒否されること（ステージングでのテストが必要。本番での実行は、テストデータの作成を伴うため承認が必要）。
4. admin の DELETE が成功すること（同上）。
5. member の STAGE4 の通常更新（UPDATE）が影響を受けないこと（変更の対象外のため影響しないはずだが、確認は未実施）。

**影響の確認（コード確認）**: アプリのコードには、`strategy_data` の行を削除する処理は無い。会社の一括削除（`app/api/admin/data-management/delete-all`）はサービスロールで列を初期化する（行は削除しない）。そのため、アプリの通常の操作への影響は無い。

---

## 記録の追加ルール

- 変更を行うたびに、本ファイルに新しい項目を追記する（既存の項目は書き換えない）。
- 申告の内容は「実施者の申告」と明記する。確認した内容は、確認の方法（SQL Editor、カタログ、ログ等）を明記する。
- 適用した SQL の全文と、ロールバック SQL を必ず残す。
