# strategy_data RLS 修正：詳細ドキュメント

**作成日**: 2026-06-28  
**ステータス**: Migration 案作成完了（実 DB 適用待ち）  
**優先度**: PoC 前必須  

---

## 1. 修正の背景

### 現状問題
Supabase SQL Editor での確認結果：
- strategy_data の INSERT / UPDATE / DELETE ポリシーに role チェックがない
- company_members に所属していれば、member も INSERT/UPDATE/DELETE 可能
- **GROWTH SHIFT の権限設計とズレている**

### 権限設計要件
- STAGE1-3：strategy_data は manager/admin のみが編集可能。member は閲覧のみ
- STAGE4-5：後続ステージのため、別テーブル（okrs, progress_logs）で管理

---

## 2. 修正されるポリシー一覧

| ポリシー名 | 操作 | 修正前 | 修正後 | 理由 |
|----------|------|--------|--------|------|
| strategy_select | SELECT | company_members 所属のみ | company_members 所属のみ | **現状維持**（member も読取可） |
| strategy_insert | INSERT | company_members 所属のみ | manager/admin のみ | **role 制御追加** |
| strategy_update | UPDATE | company_members 所属のみ | manager/admin のみ | **role 制御追加** |
| strategy_delete | DELETE | company_members 所属のみ | admin のみ | **role 制御追加** |

---

## 3. 変更前・変更後の権限表

### 修正前（現在）

| ユーザー種別 | SELECT | INSERT | UPDATE | DELETE |
|----------|--------|--------|--------|--------|
| **member** | ✅ | ✅ | ✅ | ✅ |
| **manager** | ✅ | ✅ | ✅ | ✅ |
| **admin** | ✅ | ✅ | ✅ | ✅ |
| **会社未所属** | ❌ | ❌ | ❌ | ❌ |

### 修正後（目標）

| ユーザー種別 | SELECT | INSERT | UPDATE | DELETE |
|----------|--------|--------|--------|--------|
| **member** | ✅ | ❌ | ❌ | ❌ |
| **manager** | ✅ | ✅ | ✅ | ❌ |
| **admin** | ✅ | ✅ | ✅ | ✅ |
| **会社未所属** | ❌ | ❌ | ❌ | ❌ |

**変更点**:
- member：INSERT/UPDATE/DELETE が ❌ に変更
- manager：DELETE が ❌ のまま（admin のみ）
- テナント分離は変わらず

---

## 4. 影響を受ける画面・API

### ❌ Member が操作できなくなる機能

| 画面・API | 操作 | 影響 | 対応 |
|---------|------|------|------|
| **STAGE1 財務インポート** | `/api/stage1/import` | member は呼び出し不可に | API層で既に assertMinRole('manager') で制御済み ✅ |
| **STAGE2 戦略たたき台生成** | `/api/stage2/generate-draft` | member は呼び出し不可に | API層で既に assertMinRole('manager') で制御済み ✅ |
| **STAGE2 最終ストーリー生成** | `/api/stage2/generate-final` | member は呼び出し不可に | API層で既に assertMinRole('manager') で制御済み ✅ |
| **STAGE3 戦略展開ブリッジ** | `/api/stage3/generate-strategy-bridge` | member は呼び出し不可に | API層で role チェック必要か確認待ち ⏳ |

**影響度**: 低（API層で既に制御されている可能性が高い）

### ✅ Manager / Admin は引き続き使用可能

| 画面・API | 影響 | 確認 |
|---------|------|------|
| **STAGE1-3 各種生成API** | 変化なし | ✅ manager/admin は継続利用可 |
| **STAGE4 実行計画生成** | 変化なし | ✅ member も使用（別テーブル okrs） |
| **STAGE5 実行支援** | 変化なし | ✅ member も使用（別テーブル progress_logs） |

---

## 5. Migration ファイル内容

**ファイル**: `supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql`

### 実行内容

1. **既存ポリシー削除** ✅ 安全な DROP POLICY IF EXISTS
2. **SELECT ポリシー新規作成** - 現状維持（member も読取可）
3. **INSERT ポリシー新規作成** - manager/admin のみ
4. **UPDATE ポリシー新規作成** - manager/admin のみ
5. **DELETE ポリシー新規作成** - admin のみ

### 参照テーブル
- `public.company_members` を直接参照
- `user_companies` ビューは使用しない

---

## 6. Supabase 適用前の確認事項

### 実行前チェック

```sql
-- 1) strategy_data テーブルの存在確認
SELECT tablename FROM pg_tables
WHERE tablename = 'strategy_data' AND schemaname = 'public';

-- 2) company_members テーブルの構造確認
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'company_members'
  AND column_name IN ('company_id', 'user_id', 'role')
ORDER BY ordinal_position;

-- 3) 現在のポリシー確認
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;
```

### 実行前の注意
- ⚠️ **バックアップを取得してから実行してください**
- ⚠️ **本番環境での実行前に開発環境で検証してください**
- ⚠️ **実行中の query がないことを確認してください**

---

## 7. 適用後の確認 SQL

### 修正されたポリシーの確認

```sql
-- 修正後のポリシー一覧
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;
```

**確認ポイント**:
- strategy_select：policy_name がある（SELECT は変わらず）
- strategy_insert：qual に `role IN ('manager', 'admin')` がある
- strategy_update：qual に `role IN ('manager', 'admin')` がある
- strategy_delete：qual に `role = 'admin'` がある

### ロール別の権限確認テスト

#### Member ユーザーでの確認

```sql
-- Member が strategy_data を読取できることを確認（SELECT OK）
SELECT COUNT(*) FROM strategy_data WHERE company_id = '<Company A ID>';

-- Member が INSERT できないことを確認（INSERT NG）
INSERT INTO strategy_data (company_id, ...) VALUES (...);
-- 期待結果: RLS violation error

-- Member が UPDATE できないことを確認（UPDATE NG）
UPDATE strategy_data SET ... WHERE id = '...';
-- 期待結果: RLS violation error

-- Member が DELETE できないことを確認（DELETE NG）
DELETE FROM strategy_data WHERE id = '...';
-- 期待結果: RLS violation error
```

#### Manager ユーザーでの確認

```sql
-- Manager が strategy_data を読取できることを確認（SELECT OK）
SELECT COUNT(*) FROM strategy_data WHERE company_id = '<Company A ID>';

-- Manager が INSERT できることを確認（INSERT OK）
INSERT INTO strategy_data (company_id, ...) VALUES (...);
-- 期待結果: 1 row inserted

-- Manager が UPDATE できることを確認（UPDATE OK）
UPDATE strategy_data SET ... WHERE id = '...';
-- 期待結果: rows updated

-- Manager が DELETE できないことを確認（DELETE NG）
DELETE FROM strategy_data WHERE id = '...';
-- 期待結果: RLS violation error
```

#### Admin ユーザーでの確認

```sql
-- Admin が strategy_data を読取できることを確認（SELECT OK）
SELECT COUNT(*) FROM strategy_data WHERE company_id = '<Company A ID>';

-- Admin が INSERT できることを確認（INSERT OK）
INSERT INTO strategy_data (company_id, ...) VALUES (...);
-- 期待結果: 1 row inserted

-- Admin が UPDATE できることを確認（UPDATE OK）
UPDATE strategy_data SET ... WHERE id = '...';
-- 期待結果: rows updated

-- Admin が DELETE できることを確認（DELETE OK）
DELETE FROM strategy_data WHERE id = '...';
-- 期待結果: 1 row deleted
```

---

## 8. ロール別テスト観点

### テスト観点1：STAGE1-3 での保存機能

| テストケース | ユーザー種別 | 操作 | 期待結果 | 確認方法 |
|----------|----------|------|---------|---------|
| **STAGE1_1** | Member | /api/stage1/import を呼び出し | ❌ エラー（401/403） | API 応答コード確認 |
| **STAGE1_2** | Manager | /api/stage1/import を呼び出し | ✅ 成功 | API 応答コード + DB反映確認 |
| **STAGE1_3** | Admin | /api/stage1/import を呼び出し | ✅ 成功 | API 応答コード + DB反映確認 |
| **STAGE2_1** | Member | /api/stage2/generate-draft を呼び出し | ❌ エラー（401/403） | API 応答コード確認 |
| **STAGE2_2** | Manager | /api/stage2/generate-draft を呼び出し | ✅ 成功 | API 応答コード + DB反映確認 |
| **STAGE2_3** | Admin | /api/stage2/generate-draft を呼び出し | ✅ 成功 | API 応答コード + DB反映確認 |

### テスト観点2：RLS による権限制御

| テストケース | ユーザー種別 | SQL 操作 | 期待結果 | 確認方法 |
|----------|----------|---------|---------|---------|
| **RLS_1** | Member | SELECT strategy_data | ✅ 読取可 | 結果件数確認 |
| **RLS_2** | Member | INSERT strategy_data | ❌ RLS violation | エラーメッセージ確認 |
| **RLS_3** | Member | UPDATE strategy_data | ❌ RLS violation | エラーメッセージ確認 |
| **RLS_4** | Member | DELETE strategy_data | ❌ RLS violation | エラーメッセージ確認 |
| **RLS_5** | Manager | SELECT strategy_data | ✅ 読取可 | 結果件数確認 |
| **RLS_6** | Manager | INSERT strategy_data | ✅ 插入可 | 新規 ID 확인 |
| **RLS_7** | Manager | UPDATE strategy_data | ✅ 更新可 | affected rows 確認 |
| **RLS_8** | Manager | DELETE strategy_data | ❌ RLS violation | エラーメッセージ確認 |
| **RLS_9** | Admin | SELECT strategy_data | ✅ 読取可 | 結果件数確認 |
| **RLS_10** | Admin | INSERT strategy_data | ✅ 挿入可 | 新規 ID 確認 |
| **RLS_11** | Admin | UPDATE strategy_data | ✅ 更新可 | affected rows 確認 |
| **RLS_12** | Admin | DELETE strategy_data | ✅ 削除可 | affected rows 確認 |

### テスト観点3：テナント分離の確認

| テストケース | ユーザー種別 | 所属会社 | 操作対象 | 期待結果 | 確認方法 |
|----------|----------|--------|---------|---------|---------|
| **Tenant_1** | Member A | Company A | Company A の strategy_data | ✅ 読取可 | 結果件数確認 |
| **Tenant_2** | Member A | Company A | Company B の strategy_data | ❌ RLS violation | エラーメッセージ確認 |
| **Tenant_3** | Manager A | Company A | Company A の strategy_data INSERT | ✅ 成功 | 新規 ID 確認 |
| **Tenant_4** | Manager A | Company A | Company B の strategy_data INSERT | ❌ RLS violation | エラーメッセージ確認 |
| **Tenant_5** | Admin A | Company A | Company A の strategy_data DELETE | ✅ 成功 | affected rows 確認 |
| **Tenant_6** | Admin A | Company A | Company B の strategy_data DELETE | ❌ RLS violation | エラーメッセージ確認 |

---

## 9. 修正スケジュール

### PoC 前（本修正）
- ✅ Migration SQL 案作成 - **完了**
- ⏳ API層の権限チェック確認（STAGE3 の manager 制限必要性）
- ⏳ 開発環境での検証実施
- ⏳ Supabase での適用

### PoC 後
- okrs / progress_logs の RLS 検討・修正
- DELETE ポリシーの manager 対応検討
- テナント越境テスト実施

---

## 10. リスク・副作用

### ⚠️ 認識すべき変更
- Member ユーザーは strategy_data を直接編集できなくなる
- STAGE1-3 の API は manager 以上のロール確認が必須

### ✅ 緩和策
- API層で既に manager 制限がされている可能性が高い
- RLS で二重制御により、セキュリティが向上

### 🔍 検証項目
- STAGE3 API が実際に manager 制限をしているか確認
- 古い migration スクリプトが strategy_data に直接アクセスしていないか確認

---

## 11. 参考資料

- Migration ファイル：`supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql`
- RLS 分析：`docs/spec/15-RLS-and-RBAC-alignment-analysis.md`
- 権限設計：prompt.txt

---

**ステータス**: Migration 案作成完了。Supabase 適用前に再度確認を実施予定。
