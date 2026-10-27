# company_members の直接書込みの禁止（案 B）：設計メモ

状態：提案。本番・ステージングの DB には未適用。SQL は `company-members-rls-hardening.sql`、
ロールバックは `company-members-rls-rollback.sql`。

## 1. 目的

本番の `company_members` には、同一会社の管理者が直接 UPDATE・DELETE できるポリシーがある（AAL2 の条件なし）。
MFA 未完了の管理者でも、API のガードを通らずに権限変更・削除ができてしまうため、直接書込みを禁止し、
API（MFA・会社・権限・最後の管理者・監査）に一本化する。

## 2. 直接操作の網羅的な調査（書込み先：`company_members`）

走査は `app/`・`lib/`・`utils/`・`components/`・`store/`・`hooks/`・`scripts/`・`supabase/` の追跡済みと未追跡の
TypeScript・JavaScript・SQL を対象にした。

### 2-1. ブラウザ（authenticated。RLS の対象）

| 場所 | 操作 | 現状 | 案 B 後 |
|---|---|---|---|
| `utils/supabase/membership.ts` `createCompanyAndJoin` | UPSERT（作成者を admin として登録） | INSERT のポリシーが無いため、RLS で拒否（本番で確認） | 権限エラー（42501） |
| `utils/supabase/membership.ts` `joinCompany` | UPSERT（任意のロールで参加） | 同上 | 同上 |

- 呼び出し元：`app/onboarding/page.tsx`（`createCompanyAndJoin`、`joinCompany`）、`app/login/LoginClient.tsx`（`joinCompany`、`?company=` のとき）。
- 影響：現行でも、所属の作成は RLS で失敗しているはず（INSERT のポリシーが無い）。案 B によって失敗の理由が
  RLS から権限に変わるだけで、機能の結果は変わらない。
- 推奨（別承認）：オンボーディングを既存の `/api/companies/provision` に移す。動作が変わるため、単独で行う。
- 既に移行済み：ロール変更（`updateMemberRole` → `PATCH /api/members/role`）と削除（→ `DELETE /api/admin/members`）。

### 2-2. サーバー（サービスロール。RLS を迂回する）

| 場所 | 操作 | 内容 | 案 B の影響 |
|---|---|---|---|
| `app/api/invites/accept/route.ts` | UPSERT（`onConflict`） | ロールは `max(既存, 招待)`（昇格のみ） | 権限の剥奪の影響なし。昇格は UPDATE トリガーの対象外 |
| `app/api/invites/complete/route.ts` | UPSERT（`ignoreDuplicates`） | 既存の行は変更しない | 影響なし |
| `app/api/auth/link-invited-user/route.ts` | UPSERT（`ignoreDuplicates`） | 既存の行は変更しない | 影響なし |
| `app/api/companies/provision/route.ts` | INSERT、UPDATE（`department_id` のみ） | 作成と部門の付与 | 影響なし（UPDATE は role が admin のまま変わらないためトリガーは通過） |
| `app/api/members/route.ts` | UPSERT（POST）、DELETE | 会社を明示。最後の管理者を保護 | 影響なし（API で検査済み） |
| `app/api/members/role/route.ts` | UPDATE | 会社を明示。最後の管理者を保護 | 影響なし |
| `lib/server/companyAdmin.ts` `removeCompanyMember` | DELETE | 最後の管理者を保護 | 影響なし |
| `app/api/admin/invite/route.ts`（廃止予定） | UPSERT（既存メンバーの役割を上書き） | MFA ガード済み。非最後の管理者を降格させ得る | 最後の管理者はトリガーが守る。ルートの削除を推奨（別承認） |
| `scripts/setup-e2e-test-accounts.mjs` | INSERT | テスト用の作成（非本番のみ） | 影響なし |

### 2-3. SQL

- `supabase/schema_remote_20260708.sql:271`：`provision_company` 関数内の INSERT（SECURITY DEFINER）。
  サービスロールの権限で動くため、影響なし。

## 3. 招待受諾と会社登録への影響（まとめ）

- 招待受諾（`invites/accept`）と招待の補完（`invites/complete`）、招待の自動紐付け（`link-invited-user`）は、
  すべてサービスロールで動く。REVOKE と RLS の変更の影響を受けない。
- 会社の作成は、サーバーの `provision` が正規の経路。ブラウザの `createCompanyAndJoin` は、現行でも RLS で失敗する可能性が高い（本番で要確認）。

## 4. 既存のポリシー・GRANT の正確な復元

1. **事前取得**：`company-members-rls-hardening.sql` の「0」の 3 つの SELECT を、適用の前に実行して保存する。
2. **適用**：「1」を、ステージングで先に行う（単一トランザクション）。
3. **ロールバック**：`company-members-rls-rollback.sql`。定義はダンプ（`supabase/schema_remote_20260708.sql`）から
   機械的に抜き出したもの。実行の前に、「0」の保存結果と一致することを確認する。
4. **照合**：ロールバック後に「0」を再実行し、保存結果と一致することを確認する（差分が無いこと）。

- `members_select_self` は変更しない（SELECT のみ。自己参照しない）。
- サービスロールの GRANT（ALL）は変更しない。`anon` には元から権限が無い。
- `strategy_data` などのポリシーは、`company_members` を SELECT で参照するだけなので、影響を受けない（検証 2-5）。

## 5. 最後の管理者を守るトリガーの同時実行安全性

- 関数：`public.company_members_guard()`（SECURITY DEFINER、`search_path = public`）。
- **RLS の影響を受けない理由**：SECURITY INVOKER だと、呼び出し元（authenticated）の RLS の下で数えるため、
  `members_select_self` により自分の行しか見えず、管理者の人数を誤って 1 と数えてしまう。定義者の権限で数える。
- **同時実行**：同じ会社の管理者行を `order by user_id for update` で固定してから数える。
  READ COMMITTED では、ロック待ちの後に行が消えていれば PostgreSQL が再評価し、数えるときは他方のコミット後の状態を見る。
  例：A と B を同時に削除すると、後から実行された方は「残りが 0」を検出して `P0001 last_admin` になる。
- **デッドロック**：同じ会社の管理者行は、常に `user_id` の順にロックする。2 つの削除が同じ集合を同じ順で取るため、
  循環待ちが起きない。異なる会社の操作は、ロック対象が重ならない。
  1 つのトランザクションが複数の会社を操作すると、順序の不一致が起き得る。本アプリはそうしない（`removeCompanyMember` は 1 件ずつ）。
- **API の事前確認との関係**：API の `countOtherAdmins` は、エラーメッセージを分かりやすくするための事前確認。
  保証はトリガーが行う（API は競合で古い数を見ることがあるため）。

## 6. DELETE の NEW・OLD の扱い

- DELETE の行トリガーでは `NEW` は NULL。`OLD` だけを参照し、`RETURN OLD` で削除を続ける。
- UPDATE では `NEW` を返す（返さないと行が更新されない）。
- 役割が admin の行だけを検査する。admin でない行の変更や削除は、検査を行わずに通す。

## 7. company_id・user_id の変更を含む UPDATE

- 付け替えは禁止する：`company_members_identity_immutable`（P0001）。
- 理由：所属の移動を許すと、移動元の最後の管理者の検査を回避できる。移動は、削除と追加として API で行う。
- `ON CONFLICT DO UPDATE`（UPSERT の更新）は、キーが変わらないので影響を受けない。

## 8. 検証の計画（ステージング）

- 「2」の SQL（ロールバック付き）：直接 UPDATE・DELETE・INSERT の拒否、自分の行だけの参照、トリガー（最後の管理者、
  付け替え、複数行の削除）。
- 「3」の同時実行テスト：2 つのセッションで A と B を同時に削除（片方のみ成功、40P01 が出ないこと）。
- API の回帰：`docs/security-log/staging-company-schema.sql` を適用した staging で、招待・権限変更・会社切替・保存を確認。

## 9. 残る注意点

- 複数行の一括削除（`WHERE role = 'admin'` など）の振る舞いは、PostgreSQL の行トリガーの可視性に依存する。
  検証 2-7 で必ず確認する。本アプリは 1 件ずつ操作するため、通常の経路では問題にならない。
- 将来、会社の管理者を閲覧できる SELECT のポリシーを追加する場合、`company_members` を直接参照すると
  無限再帰（42P17）になる。SECURITY DEFINER の関数を使うこと。
- 廃止予定の `admin/invite` ルートは、削除を推奨（別承認）。
