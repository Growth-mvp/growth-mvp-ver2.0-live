# RLS テスト計画：org_alignment_* と agent_logs

**日時**: 2026-07-08  
**対象**: org_alignment テーブル（3件）と agent_logs テーブル（1件）の RLS ポリシー追加  
**ステータス**: 本番未適用（テスト計画のみ）

---

## テスト概要

本テスト計画は、RLS ポリシー追加前後で以下を検証します：

1. **テナント分離**: A 社ユーザーが B 社データにアクセスできないこと
2. **権限分離**: メンバーと admin での操作権限の違い
3. **書き込み保護**: 権限のないユーザーが UPDATE/DELETE/INSERT できないこと

### テスト実行環境

- ローカル環境（テスト用 Supabase インスタンス推奨）
- 本番 DB は使用しない
- テスト用テストデータを一時作成（cleanup 手順あり）

---

## テストシナリオ

### シナリオ 1：テナント分離の検証

**前提**:
- Company A（ID: `company-a-uuid`）: User A（member）, User Admin A（admin）
- Company B（ID: `company-b-uuid`）: User B（member）, User Admin B（admin）
- テスト用ケース: Case A（Company A）, Case B（Company B）

#### テスト 1-1: org_alignment_cases への SELECT アクセス

**テスト**: User A が SELECT を実行した場合、Company A のケースのみが見える

```sql
-- User A のセッションで実行
SELECT id, company_id FROM "public"."org_alignment_cases"
  WHERE company_id IN ('company-a-uuid', 'company-b-uuid');

-- 期待結果: Case A のみ返却
--          (company-a-uuid)
-- 期待外: Case B を含まない
```

**検証**: Case A が返却され、Case B は返却されない

#### テスト 1-2: User B による Company A データへのアクセス禁止

**テスト**: User B が Company A のケースを SELECT しようとする

```sql
-- User B のセッションで実行
SELECT id, company_id FROM "public"."org_alignment_cases"
  WHERE id = 'case-a-uuid';

-- 期待結果: 0 rows (RLS ポリシーで拒否)
```

**検証**: エラーなしで 0 rows が返却される（RLS は silent deny）

#### テスト 1-3: org_alignment_insights への SELECT

**テスト**: User A は自社の insights を SELECT 可能、User B は不可

```sql
-- User A のセッションで実行（admin role）
SELECT id, company_id FROM "public"."org_alignment_insights"
  WHERE company_id = 'company-a-uuid';

-- 期待結果: Company A の insights が返却

-- User B のセッションで実行（admin role）
SELECT id, company_id FROM "public"."org_alignment_insights"
  WHERE company_id = 'company-b-uuid';

-- 期待結果: Company B の insights が返却
```

**検証**: 各ユーザーが自社データのみアクセス可能

---

### シナリオ 2：権限分離の検証（admin vs member）

**前提**:
- User A（Company A の member）
- User Admin A（Company A の admin）
- User Admin B（Company B の admin）

#### テスト 2-1: org_alignment_insights への INSERT/UPDATE

**テスト**: admin は INSERT/UPDATE 可能、member は不可

```sql
-- User A（member）で実行
INSERT INTO "public"."org_alignment_insights"
  (company_id, summary, generated_by)
VALUES ('company-a-uuid', 'Test insight', 'user-a-uuid');

-- 期待結果: RLS ポリシーで INSERT 拒否

-- User Admin A（admin）で実行
INSERT INTO "public"."org_alignment_insights"
  (company_id, summary, generated_by)
VALUES ('company-a-uuid', 'Test insight', 'user-admin-a-uuid');

-- 期待結果: INSERT 成功
```

**検証**: admin のみ INSERT/UPDATE 可能

#### テスト 2-2: org_alignment_stage_reflection_candidates への UPDATE

**テスト**: admin のみ UPDATE 可能

```sql
-- User A（member）で実行
UPDATE "public"."org_alignment_stage_reflection_candidates"
  SET status = 'approved'
  WHERE company_id = 'company-a-uuid';

-- 期待結果: 0 rows updated（RLS ポリシーで拒否）

-- User Admin A（admin）で実行
UPDATE "public"."org_alignment_stage_reflection_candidates"
  SET status = 'approved'
  WHERE company_id = 'company-a-uuid';

-- 期待結果: 1 or more rows updated
```

**検証**: admin のみ UPDATE 可能

---

### シナリオ 3：跨社境アクセス防止

#### テスト 3-1: User B（admin）が Company A データを UPDATE しようとする

**テスト**: User B（Company B の admin）は Company A データを UPDATE できない

```sql
-- User Admin B（Company B の admin）で実行
UPDATE "public"."org_alignment_insights"
  SET summary = 'Hijacked'
  WHERE company_id = 'company-a-uuid';

-- 期待結果: 0 rows updated（company_id が異なるため RLS で拒否）
```

**検証**: User B の admin 権限は Company B に限定される

#### テスト 3-2: INSERT での跨社境防止

**テスト**: User A が別社の company_id で INSERT しようとする

```sql
-- User A（Company A メンバー）で実行
INSERT INTO "public"."org_alignment_insights"
  (company_id, summary, generated_by)
VALUES ('company-b-uuid', 'Hijack', 'user-a-uuid');

-- 期待結果: RLS ポリシーで INSERT 拒否（company_id = company-b-uuid で user A は admin でない）
```

**検証**: 権限のない company_id への INSERT が拒否される

---

### シナリオ 4：agent_logs のアクセス制御

#### テスト 4-1: agent_logs への SELECT（admin のみ）

**テスト**: member は SELECT できない、admin のみ可能

```sql
-- User A（Company A メンバー）で実行
SELECT id, content FROM "public"."agent_logs"
  WHERE strategy_id IN (
    SELECT id FROM "public"."strategy_data"
      WHERE company_id = 'company-a-uuid'
  );

-- 期待結果: 0 rows（RLS で拒否）

-- User Admin A（Company A admin）で実行
SELECT id, content FROM "public"."agent_logs"
  WHERE strategy_id IN (
    SELECT id FROM "public"."strategy_data"
      WHERE company_id = 'company-a-uuid'
  );

-- 期待結果: Company A のログが返却
```

**検証**: admin のみが agent_logs を参照可能

#### テスト 4-2: agent_logs への INSERT（service_role）

**テスト**: service_role は常に INSERT 可能、authenticated client は INSERT 試行に対応するポリシーなし

```sql
-- authenticated client では通常 INSERT しない（RLS ポリシーがないため）
-- service_role のみ INSERT 可能
INSERT INTO "public"."agent_logs"
  (user_id, strategy_id, step, role, content)
VALUES ('user-a-uuid', 'strategy-a-uuid', 0, 'assistant', 'Test log');

-- 期待結果: service_role なら成功
```

**検証**: service_role による INSERT が成功

---

### シナリオ 5：org_alignment_insight_sources（FK ベース）

#### テスト 5-1: FK 経由のテナント分離

**テスト**: org_alignment_insight_sources への SELECT は、参照元 case のテナント分離に従う

```sql
-- User A（Company A メンバー）で実行
SELECT s.id
FROM "public"."org_alignment_insight_sources" s
WHERE s.case_id IN (
  SELECT c.id FROM "public"."org_alignment_cases" c
    WHERE c.company_id = 'company-a-uuid'
);

-- 期待結果: Company A のケースに紐付いた insight_sources が返却

-- Company B のケースに紐付いた insight_sources にアクセス
SELECT s.id
FROM "public"."org_alignment_insight_sources" s
WHERE s.case_id IN (
  SELECT c.id FROM "public"."org_alignment_cases" c
    WHERE c.company_id = 'company-b-uuid'
);

-- 期待結果: 0 rows（User A には Company B ケースへのアクセス権がない）
```

**検証**: FK 経由のテナント分離が機能

---

## テスト実行手順（ローカル環境）

### 前提条件
1. ローカル Supabase インスタンスが起動している
2. テスト用 2 社、各 2-3 ユーザーが作成済み
3. テスト用ケース・インサイト・ログが準備済み

### 実行ステップ

1. **migration を適用**
   ```bash
   supabase migration up --linked
   # またはローカルで構文確認のみ
   ```

2. **各シナリオを実行**
   - Supabase Studio か PostgREST API クライアント（curl など）で実行
   - または: Node.js/TypeScript で supabase client を使用

3. **結果を記録**
   - 各テストの期待値と実際の結果
   - エラーメッセージ（あれば）
   - パフォーマンス観察（クエリ時間）

4. **Cleanup**
   ```bash
   -- テスト用データを削除
   DELETE FROM "public"."org_alignment_insights" WHERE created_at > now() - interval '1 hour';
   DELETE FROM "public"."org_alignment_stage_reflection_candidates" WHERE created_at > now() - interval '1 hour';
   -- etc.
   ```

---

## 検証チェックリスト

- [ ] テスト 1-1: User A が Company A ケースのみ参照可能
- [ ] テスト 1-2: User B が Company A ケースにアクセス不可
- [ ] テスト 1-3: org_alignment_insights が company_id ベースで分離
- [ ] テスト 2-1: admin が INSERT/UPDATE 可能、member 不可
- [ ] テスト 2-2: admin が UPDATE 可能、member 不可
- [ ] テスト 3-1: User B の admin 権限が Company B に限定
- [ ] テスト 3-2: 権限なしの company_id への INSERT が拒否
- [ ] テスト 4-1: agent_logs は admin のみ参照可能
- [ ] テスト 4-2: service_role による INSERT が成功
- [ ] テスト 5-1: FK 経由のテナント分離が機能

---

## 既知の制限・注意点

1. **org_alignment_insight_sources**: company_id なし
   - FK（case_id）経由でテナント分離を実現
   - FK が削除されるとテナント分離が失われる
   - Constraint: NOT NULL と ON DELETE RESTRICT を確保

2. **agent_logs**: company_id なし
   - FK（strategy_id）経由でテナント分離
   - admin のみが SELECT 可能（member 不可）
   - service_role は常に INSERT 可能

3. **パフォーマンス**
   - RLS ポリシーに EXISTS サブクエリを使用
   - インサイト数が多い場合、JOIN が重くなる可能性あり
   - monitor: EXPLAIN ANALYZE for complex queries

---

**テスト計画作成日**: 2026-07-08  
**ステータス**: 本番未適用
