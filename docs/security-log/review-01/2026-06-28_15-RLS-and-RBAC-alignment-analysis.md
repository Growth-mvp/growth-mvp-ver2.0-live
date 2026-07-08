# RLS と権限設計（RBAC）の整合性分析

**作成日**: 2026-06-28  
**ステータス**: 分析完了（修正はまだ未実施）  
**担当**: セキュリティ改善タスク A-5  

---

## 1. 権限設計の基本方針（GROWTHSHIFTより）

| STAGE | Admin | Manager | Member | 操作対象 |
|-------|-------|---------|--------|---------|
| **STAGE1-3** | ✅ 編集可 | ✅ 編集可 | ❌ 閲覧のみ | strategy_data（財務、戦略たたき台）|
| **STAGE4** | ✅ 編集可 | ✅ 編集可 | ✅ 編集可 | strategy_data（実行計画）、okrs |
| **STAGE5** | ✅ 編集可 | ✅ 編集可 | ✅ 編集可 | progress_logs（進捗・メモ・コメント） |

**設計の要点**:
- STAGE1-3: strategy_data（戦略の正本）は manager/admin のみ編集。member は閲覧のみ
- STAGE4: strategy_data と okrs は member も編集可能（実行計画参加）
- STAGE5: progress_logs は member も入力可能（実行状況報告）

---

## 2. 現在のRLS実装状況

### A) **strategy_data テーブル**

#### 🟡 **中程度問題：RLS は存在するが role 制御が設計とズレている可能性**

**現状**:
- RLS は **有効化されている** ✅
- SELECT / INSERT / UPDATE / DELETE のポリシーが定義されている
- ただし、company_members に所属していれば **member でも INSERT / UPDATE / DELETE できるように見える**

**権限設計との比較**:
- **期待**: STAGE1-3 は manager/admin のみが strategy_data を編集可能。member は閲覧のみ
- **実際のRLS**: company_id が合致する company_members に所属していれば、role に関わらず INSERT/UPDATE/DELETE 可能か？

**影響**:
- API層で `assertMinRole(membership, 'manager')` でチェックしているが、RLS が role を制御していない可能性
- RLS で明示的に manager/admin に INSERT/UPDATE/DELETE を制限する必要がある可能性
- テナント分離は RLS で強制されている（company_id チェック）

---

### B) **okrs テーブル**

#### ✅ **RLS 実装済み - 現時点では修正不要**

**RLS定義**:
```sql
ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;

-- SELECT: 同じ company_id のユーザーはすべて読取可能
CREATE POLICY "Users can read okrs in their company" ON okrs
  FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
    )
  );

-- INSERT: admin のみ
CREATE POLICY "Company admins can insert okrs" ON okrs
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- UPDATE: admin のみ
CREATE POLICY "Company admins can update okrs" ON okrs
  FOR UPDATE
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- DELETE: admin のみ
CREATE POLICY "Company admins can delete okrs" ON okrs
  FOR DELETE
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

**現在の設計**:
- okrs は STAGE4 に関連する
- member が編集可能な仕様のため、現在のRLS（admin のみ UPDATE/DELETE）は権限設計との確認が必要
- **PoC前の必須修正からは外す**（PoC後に member が okrs を直接編集する仕様か確認してから修正）

---

### C) **progress_logs テーブル**

#### ✅ **RLS は実装済み - 現時点では修正不要**

**現状**:
- RLS は **有効化されている** ✅
- SELECT / INSERT / UPDATE / DELETE のポリシーが定義されている

**権限設計**:
- member が STAGE5 で進捗ログ入力可能（`'progress:write': true`）
- admin/manager も入力可能

**現在の設計**:
- progress_logs は member 編集可能な仕様のため、現在のRLSで問題なし
- ただし、「自分のログのみ編集可」 vs 「会社内のログなら編集可」の設計は別途確認が必要（設計によっては RLS 修正の対象になる可能性あり）

---

### D) **org_alignment 系テーブル**

#### org_alignment_requests

**RLS実装**: ✅ 実装済み

```sql
ALTER TABLE public.org_alignment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_select_own_org_alignment_requests"
  ON public.org_alignment_requests
  FOR SELECT
  USING (
    requested_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_requests.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

CREATE POLICY "member_insert_org_alignment_requests"
  ON public.org_alignment_requests
  FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = company_id
        AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "admin_update_org_alignment_requests"
  ON public.org_alignment_requests
  FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_requests.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- DELETE ポリシーなし
```

**分析**:
- ✅ member が投稿可能（INSERT で requested_by = auth.uid()）
- ✅ admin が管理可能（UPDATE で admin のみ）
- ❌ DELETE ポリシーなし
- ✅ member は自分の依頼のみ SELECT 可能（requested_by = auth.uid()）

---

#### org_alignment_shared_topics

**RLS実装**: ✅ 実装済み

```sql
ALTER TABLE org_alignment_shared_topics ENABLE ROW LEVEL SECURITY;

-- Admin can see all shared topics (draft/published both)
CREATE POLICY "Admin can see all shared topics"
  ON org_alignment_shared_topics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_shared_topics.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- Members can see published shared topics
CREATE POLICY "Members can see published shared topics"
  ON org_alignment_shared_topics
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_shared_topics.company_id
        AND cm.user_id = auth.uid()
    )
    AND status = 'published'
  );

-- Only admins can insert shared topics
CREATE POLICY "Only admins can insert shared topics"
  ON org_alignment_shared_topics
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- Only admins can update shared topics
CREATE POLICY "Only admins can update shared topics"
  ON org_alignment_shared_topics
  FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = org_alignment_shared_topics.company_id
        AND cm.user_id = auth.uid()
        AND cm.role = 'admin'
    )
  );

-- DELETE ポリシーなし
```

**分析**:
- ✅ admin のみ作成・編集可能（INSERT/UPDATE）
- ✅ member は published トピックのみ閲覧可能
- ❌ DELETE ポリシーなし
- ✅ 管理者向けテーブルとして適切に設計

---

#### org_alignment_insights

**RLS実装**: ✅ 実装済み

```sql
ALTER TABLE org_alignment_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_select_org_alignment_insights ...
CREATE POLICY admin_insert_org_alignment_insights ...
CREATE POLICY admin_update_org_alignment_insights ...
CREATE POLICY admin_delete_org_alignment_insights ...
```

**分析**:
- ✅ admin のみすべてのポリシーで操作可能
- ✅ 意思決定支援データのため admin 限定は適切

---

#### org_alignment_stage_reflection_candidates

**RLS実装**: ✅ 実装済み

```sql
ALTER TABLE org_alignment_stage_reflection_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_alignment_stage_reflection_candidates_select
  ON org_alignment_stage_reflection_candidates
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid()
    )
  );

-- INSERT, UPDATE, DELETE も同様（company_id チェックのみ）
```

**分析**:
- ❌ role チェックなし（company_id チェックのみ）
- ❓ member も INSERT/UPDATE/DELETE 可能な設計か不明
- ⚠️ 修正が必要な可能性あり

---

## 3. RLS と権限設計のズレ一覧

### 🔴 **重大：strategy_data の RLS が role 制御を強制しているか確認必須**

| テーブル | 問題 | 詳細 | 優先度 |
|---------|------|------|--------|
| **strategy_data** | role 制御が権限設計とズレている可能性 | STAGE1-3 では member が編集できない設計だが、RLS が role を制御していない場合、member も INSERT/UPDATE/DELETE できてしまう。PoC前に Supabase で確認し、必要に応じて修正 | 🔴 High |

---

### 🟡 **中程度：STAGE3/4 の API 権限チェックを確認**

| 項目 | 問題 | 詳細 | 優先度 |
|------|------|------|--------|
| **STAGE3: /api/stage3/generate-strategy-bridge** | API 権限チェックが不明 | strategy_data を参照・生成する API。manager 以上制限が必要か確認 | 🟡 Medium |
| **STAGE4: /api/stage4/generate-execution-draft** | API 権限チェックが不明 | member も参加可能な STAGE4 なので、manager 制限は不要の可能性あり。確認必要 | 🟡 Medium |

---

### 🟢 **軽微：PoC後に検討**

| テーブル | 問題 | 詳細 | 優先度 |
|---------|------|------|--------|
| **okrs** | member 編集可能な仕様か確認 | STAGE4 で member が okrs を編集する仕様の場合、RLS を修正が必要 | 🟢 Low（PoC後） |
| **progress_logs** | 「自分のみ」vs「会社内」の設計 | 設計確認後、RLS を修正 | 🟢 Low（PoC後） |
| **org_alignment テーブルの DELETE ポリシー** | DELETE ポリシーなし | 削除権限が曖昧 | 🟢 Low（PoC後） |

---

## 4. API層の権限制御実装状況

### STAGE1-3: 権限チェック ✅ 実装済み

**STAGE1: /api/stage1/import**
```typescript
assertMinRole(membership, 'manager');  // ✅ manager 以上のみ
```

**STAGE2: /api/stage2/generate-draft, /api/stage2/generate-final**
```typescript
assertMinRole(membership, 'manager');  // ✅ manager 以上のみ
```

**STAGE3: /api/stage3/generate-strategy-bridge**
```typescript
requireMembership(admin, userId);  // ⚠️ role チェックなし
```

**分析**: STAGE3 で role チェックがない。manager 以上のチェックが必要だが、呼び出しテーブル参照により権限制御されている可能性あり。

---

### STAGE4: 権限チェック ⚠️ 不完全

**STAGE4: /api/stage4/generate-execution-draft**
```typescript
requireMembership(admin, userId);  // ⚠️ role チェックなし
```

**分析**: role チェックがない。manager 以上のみに制限する必要がある（権限設計では member は STAGE4 閲覧のみ）。

---

### STAGE5: 権限チェック ❌ 不明確

**STAGE5: /api/stage5/assist-execution**
```typescript
requireMembership(admin, userId);  // member 参加のため role チェックなし
```

**STAGE5: /api/stage5/execution-summary**
```typescript
requireMembership(admin, userId);  // ⚠️ role チェックなし
```

**分析**: role チェックなし。member が progress_logs 入力可能なため role チェックなしは正しい。ただし、RLS で権限が強制されているか確認必要。

---

## 5. PoC前に必須で確認・修正すべき RLS

### **必須確認・修正：strategy_data の RLS が role 制御を強制しているか**

**理由**:
- strategy_data は STAGE1-3 の「正本」
- STAGE1-3 では member が編集できない設計
- RLS が role チェックなしの場合、member も INSERT/UPDATE/DELETE できてしまい、設計とズレる

**確認事項（Supabase SQL Editor で実行）**:
```sql
-- 現在の strategy_data ポリシーを確認
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;
```

**確認ポイント**:
- INSERT/UPDATE/DELETE ポリシーに `role IN ('manager', 'admin')` などの role チェックがあるか
- **ない場合**: 修正が必須

**修正候補ポリシー**（現在のポリシーが role チェックなしの場合）:
```sql
-- INSERT：manager/admin のみに制限
CREATE POLICY "Managers and admins can create strategy_data"
  ON strategy_data
  FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

-- UPDATE：manager/admin のみに制限
CREATE POLICY "Managers and admins can update strategy_data"
  ON strategy_data
  FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

-- DELETE：admin のみに制限
CREATE POLICY "Only admins can delete strategy_data"
  ON strategy_data
  FOR DELETE
  USING (
    company_id IN (
      SELECT id FROM user_companies
      WHERE user_id = auth.uid()
        AND role = 'admin'
    )
  );
```

---

### **確認対象：API層の権限チェック**

**STAGE3: /api/stage3/generate-strategy-bridge**
- 現在: `requireMembership()` のみ、role チェックなし
- **確認項目**: STAGE3 は strategy_data を参照するため、manager 以上制限が必要か確認

**STAGE4: /api/stage4/generate-execution-draft**
- 現在: `requireMembership()` のみ、role チェックなし
- **確認項目**: STAGE4 は member も参加する仕様のため、member の呼び出しが許可されるべきか確認
- **注意**: member が呼び出す場合、manager 制限は不要

---

## 6. PoC後に検討すべき修正（現在の修正対象外）

### **検討項目1：okrs の RLS が member 編集に対応しているか確認**

**現在の状態**:
- okrs RLS：UPDATE/DELETE が admin のみ

**PoC後の検討**:
- STAGE4 で member が okrs を直接編集する仕様の場合、RLS を修正（member 対応に）

---

### **検討項目2：progress_logs の UPDATE/DELETE を「自分のみ」に制限するか検討**

**現在の状態**:
- progress_logs RLS：member が会社内のログを edit/delete できる仕様か不明

**PoC後の検討**:
- member が他のユーザーのログを編集・削除できるべきか、それとも「自分のログのみ」か設計確認

---

### **検討項目3：DELETE ポリシーを追加**

**対象**:
- org_alignment_shared_topics
- org_alignment_requests

**PoC後に実施予定**

---

## 7. 修正による影響を受ける画面・API

### **strategy_data の RLS role 制御が必要な場合の影響**

**修正内容**: strategy_data の INSERT/UPDATE/DELETE を manager/admin に制限

**影響を受けるAPI**:
- `/api/stage1/import` - member は呼び出せなくなる（API層チェックで既に制御）✅ 設計通り
- `/api/stage2/generate-draft` - member は呼び出せなくなる（API層チェックで既に制御）✅ 設計通り
- `/api/stage2/generate-final` - member は呼び出せなくなる（API層チェックで既に制御）✅ 設計通り
- `/api/stage3/generate-strategy-bridge` - ⚠️ role チェック確認必要。manager 制限が必要な場合は API 修正が必要
- `/api/stage4/generate-execution-draft` - ⚠️ STAGE4 は member 参加なので、member の呼び出しが許可される場合は修正不要

**影響を受ける画面**:
- STAGE1 財務インポート画面 - 変化なし（API層で既に制御）
- STAGE2 戦略たたき台画面 - 変化なし（API層で既に制御）
- STAGE3 戦略展開ブリッジ画面 - manager 以上のみ使用可能に（API層設計に依存）
- STAGE4 実行計画たたき台画面 - member も使用可能（STAGE4 は member 参加設計）

---

### **okrs / progress_logs 関連**

**修正対象外（PoC後検討）**:
- okrs：STAGE4 member 参加のため、修正判定は PoC 後
- progress_logs：STAGE5 member 参加のため、修正判定は PoC 後

---

## 8. 修正した場合に壊れる可能性のある機能

### **高リスク**

1. **Service Role での直接アクセス**
   - migration スクリプトやバックアップが Service Role で strategy_data にアクセスしている場合、RLS が無視されないか確認
   - Supabase の Service Role は RLS を無視するため問題ないはず

2. **API層での権限チェック漏れ**
   - STAGE3, STAGE4 で role チェックがない API が RLS で member をブロックされる
   - `assertMinRole()` の追加が必須

3. **progress_logs の UPDATE/DELETE 権限**
   - 「自分のログのみ編集」vs「会社内のログなら編集」の設計が不明確
   - 修正前に確認必須

---

### **中リスク**

1. **古い migration スクリプト**
   - PHASE_2A_SUPABASE_MIGRATION.sql などで strategy_data に直接アクセスしている場合、RLS の影響を受ける可能性
   - migration 実行時は admin context で実行されるため問題ないはず

2. **テスト・診断スクリプト**
   - `scripts/sql/diag_*.sql` で strategy_data にアクセスしている
   - 実行ユーザーの権限を確認

---

### **低リスク**

1. **org_alignment テーブルの DELETE ポリシー追加**
   - 既存データに影響なし
   - 今後の削除動作のみ変化

2. **org_alignment_stage_reflection_candidates の role チェック追加**
   - 現在動作しているなら、既存データに影響なし
   - 今後の編集動作のみ厳格化

---

## 9. Supabase で必ず実行すべき確認 SQL

**PoC前に、以下の SQL を Supabase SQL Editor で実行して、strategy_data の RLS 状況を確認してください。**

```sql
-- strategy_data のポリシー確認（最優先）
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'strategy_data'
ORDER BY policyname;
```

**確認ポイント**:
- **INSERT / UPDATE / DELETE ポリシーに `role IN ('manager', 'admin')` などの role チェックがあるか**
- ない場合：修正が必須（strategy_data に role 制御を追加）
- ある場合：修正不要

---

**参考：okrs / progress_logs の確認**（PoC後検討用）

```sql
-- okrs のポリシー確認
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'okrs'
ORDER BY policyname;

-- progress_logs のポリシー確認
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'progress_logs'
ORDER BY policyname;
```

---

## 10. 次のステップ

### **PoC前（優先度High - strategy_data のみ）**

1. ✅ **本分析レポート確認** - 完了（権限設計修正版）
2. ⏳ **Supabase SQL Editor で strategy_data のポリシーを確認**（上記「確認SQL」実行）
   - INSERT/UPDATE/DELETE に role チェック（`role IN ('manager', 'admin')` など）があるか確認
   - **ない場合**：修正 SQL を作成（PoC 前に修正実施）
   - **ある場合**：修正不要
3. ⏳ **STAGE3 / STAGE4 の API 権限チェックを確認**
   - STAGE3：strategy_data を参照するため、manager 以上制限が必要か確認
   - STAGE4：member も参加するため、API に manager 制限がないか確認（現在のロールチェック状況）

### **PoC後（優先度Medium・Low）**

4. **okrs / progress_logs の RLS を検討**
   - STAGE4/5 で member 編集可能な仕様が確認されたら、必要に応じて修正
5. **DELETE ポリシーを追加**（org_alignment テーブル）
6. **テナント越境テスト実施**

---

## 11. 参考資料

- 権限設計：prompt.txt
- API層実装：app/api/stage[1-5]/**
- RBAC定義：lib/rbac.ts, lib/server/rbacGuard.ts
- OKR RLS：docs/phase2a/PHASE_2A_SUPABASE_MIGRATION.sql

---

**ステータス**: 権限設計修正版・完成。  
**修正内容**: 
- STAGE4 は member も編集可能な設計に修正
- PoC前必須修正を strategy_data のみに絞込み
- okrs / progress_logs / org_alignment テーブルはPoC後検討に変更
- API権限チェックはSTAGE3/4で確認対象として記載

**次アクション**: 
1. Supabase SQL Editor で strategy_data のポリシーを確認
2. role チェックがない場合、修正SQL を準備・実施
3. API 層の権限チェック状況を確認

**重要**: migration ファイル作成・実行は、Supabase での確認後に実施（本レポート確認待ち）

