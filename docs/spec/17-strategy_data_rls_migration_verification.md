# strategy_data RLS 修正 Migration：確認結果レポート

**作成日**: 2026-06-28  
**ステータス**: Migration 案の精査完了  
**次アクション**: STAGE4 の保存先とメンバー権限設計の再確認が必要  

---

## 1. Migration SQL 内容確認

### ✅ 確認項目の検証結果

#### 1-1. strategy_select は現状維持か

**確認結果**: ✅ **OK**
- DROP POLICY で削除してから再作成
- `role IN ('manager', 'admin')` などのチェックなし
- company_members 所属のメンバーなら誰でも SELECT 可能
- **現状維持確認**

```sql
CREATE POLICY "strategy_select"
  ON strategy_data
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  );
```

#### 1-2. DROP POLICY は strategy_insert/update/delete のみか

**確認結果**: ⚠️ **注意**
- strategy_select も DROP POLICY している（STEP 1 で削除）
- ただし STEP 2 で同じポリシーを再作成しているため、機能的には問題なし
- 推奨: DROP POLICY を strategy_insert/update/delete のみに限定するか、コメントで説明を追加

**現在の DROP POLICY 実行内容**:
```sql
DROP POLICY IF EXISTS "strategy_select" ON strategy_data;
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;
```

**推奨修正**:
```sql
-- strategy_insert/update/delete のみ削除（strategy_select は変更不要なため）
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;

-- strategy_select は現状維持するため削除しない
-- 理由: member/manager/admin 全員がSELECT可能の設計は変わらない
```

#### 1-3. strategy_insert は role IN ('manager', 'admin') か

**確認結果**: ✅ **OK**

```sql
CREATE POLICY "strategy_insert"
  ON strategy_data
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')  -- ✅ OK
    )
  );
```

#### 1-4. strategy_update は role IN ('manager', 'admin') か

**確認結果**: ✅ **OK**

```sql
CREATE POLICY "strategy_update"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')  -- ✅ OK
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')  -- ✅ OK
    )
  );
```

#### 1-5. strategy_delete は role = 'admin' のみか

**確認結果**: ✅ **OK**

```sql
CREATE POLICY "strategy_delete"
  ON strategy_data
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role = 'admin'  -- ✅ OK (admin のみ)
    )
  );
```

#### 1-6. company_members を直接参照しているか

**確認結果**: ✅ **OK**
- user_companies ビューを使用していない
- すべてのポリシーが `FROM public.company_members` を直接参照
- テーブル存在確認が安全

---

## 2. Member 権限表の誤り指摘に対する修正

### 📝 修正前のドキュメント内容（誤り）

| ユーザー種別 | 修正前 | 修正後 |
|----------|--------|--------|
| **member** | ❌ INSERT | ❌ INSERT |
| **member** | ❌ UPDATE | ❌ UPDATE |
| **member** | ❌ DELETE | ❌ DELETE |

**問題**: 修正前は member も INSERT/UPDATE/DELETE 可能だったが、ドキュメントに反映されていない

### ✅ 正しい権限表（修正版）

| ユーザー種別 | 操作 | 修正前（現在） | 修正後（目標） | 変更 |
|----------|------|----------|----------|------|
| **member** | SELECT | ✅ 可能 | ✅ 可能 | 変化なし |
| **member** | INSERT | ✅ **可能だった** | ❌ 不可 | 🔴 **強化** |
| **member** | UPDATE | ✅ **可能だった** | ❌ 不可 | 🔴 **強化** |
| **member** | DELETE | ✅ **可能だった** | ❌ 不可 | 🔴 **強化** |
| **manager** | SELECT | ✅ 可能 | ✅ 可能 | 変化なし |
| **manager** | INSERT | ✅ 可能 | ✅ 可能 | 変化なし |
| **manager** | UPDATE | ✅ 可能 | ✅ 可能 | 変化なし |
| **manager** | DELETE | ✅ **可能だった** | ❌ 不可 | 🔴 **強化** |
| **admin** | 全操作 | ✅ 可能 | ✅ 可能 | 変化なし |

---

## 3. STAGE3 / STAGE4 での strategy_data 読み書き分類

### STAGE3: /api/stage3/generate-strategy-bridge

**API の動作**:
- STAGE2 の最終ストーリーを **読取** → AI で戦略展開ブリッジを生成 → JSON で返却
- **strategy_data への書き込みなし**（draft 返却のみ）

**処理フロー**:
1. 入力: `finalStoryFinal[]`（request body から受け取り）
2. 処理: OpenAI API で bridge を生成
3. 出力: `{ bridge, debugInfo }`（DB 保存なし）

**結論**: 読み取りのみ（strategy_data に直接はアクセスしていない可能性がある）

---

### STAGE4: /api/stage4/generate-execution-draft

**API の動作**:
- 入力: ExecutionDraftRequest（projectInfo パラメータ）
- 処理: OpenAI API で実行計画たたき台を生成
- 出力: `{ draft, debugInfo }`（DB 保存なし）

**処理フロー**:
1. 入力: projectTitle, departmentName, existingOkrs[], existingKpis[] など
2. 処理: OpenAI API で draft を生成
3. 出力: JSON で返却

**注意**: existingOkrs[], existingKpis[] は「既に存在する OKR」を入力として受け取っているが、これが strategy_data から読み取られているかは別途確認が必要

**結論**: draft 生成のみ（DB 保存なし）

---

## 4. 重大な懸念：STAGE4 の保存先確認が必須

### ❓ 未確認のポイント

**重要な質問**:
1. **STAGE4 の画面で「保存」ボタンを押した時、データはどこに保存されるか？**
   - strategy_data に保存される場合 → member が UPDATE できなくなる可能性がある
   - 別テーブル（okrs, execution など）に保存される場合 → 問題なし

2. **STAGE4 で member が編集可能な設計の場合、どのテーブルに保存されているか？**
   - strategy_data の場合：RLS 修正で member のSTAGE4保存が壊れる可能性
   - okrs テーブルの場合：member が okrs を編集可能な RLS になっているか確認が必要

### 🔍 確認すべき SQL（コード内に記載されているはず）

```sql
-- STAGE4 の保存先を確認
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name IN ('strategy_data', 'okrs', 'execution', 'execution_plan', ...)
       AND column_name IN ('execution_draft', 'kpis', 'steps', ...));
```

---

## 5. API 権限チェック分類（role チェック有無）

| API | 操作 | 参照テーブル | 書き込み | 権限チェック | 確認状況 |
|-----|------|----------|---------|----------|---------|
| **STAGE3: /api/stage3/generate-strategy-bridge** | 読取 | strategy_data（推定） | なし | requireMembership のみ | ⏳ role チェック必要か要確認 |
| **STAGE4: /api/stage4/generate-execution-draft** | 読取 | projectInfo から受け取り | なし | requireMembership のみ | ⏳ member 参加なので role チェック不要か要確認 |

---

## 6. STAGE4 メンバー編集可能性の影響分析

### シナリオA: STAGE4 データが strategy_data に保存される場合

❌ **大問題が発生する可能性**

```
修正前: member も strategy_data UPDATE 可能
  → STAGE4 の draft を保存できた

修正後: member は strategy_data UPDATE 不可
  → STAGE4 の draft 保存が RLS violation で失敗
  → 機能が壊れる可能性がある
```

**対応策**:
1. STAGE4 データ保存を別テーブル（okrs など）に変更
2. または、strategy_data UPDATE に member を含める
3. または、STAGE4 は manager/admin のみの操作に変更

### シナリオB: STAGE4 データが別テーブル（okrs など）に保存される場合

✅ **問題なし**

```
STAGE4 データ → okrs テーブルに保存
okrs テーブルの RLS で member アクセス制御
strategy_data の修正は影響なし
```

**確認事項**:
- okrs テーブルに member 編集可能な RLS ポリシーがあるか

---

## 7. 実装前の必須確認タスク

### 🔴 Critical（修正実施前に確認が絶対必要）

1. **STAGE4 の保存先確認**
   - strategy_data か別テーブル か確認
   - コード内の INSERT/UPDATE 文検索

2. **STAGE4 で member の書き込み可能性確認**
   - 画面の「保存」ボタンが member も押せるか
   - 押せる場合、どのテーブルに何が保存されるか

3. **STAGE3 の API 権限設計確認**
   - manager 以上制限が必要か確認
   - member が呼び出す可能性があるか

### 🟡 Important（修正実施前に確認推奨）

4. **DROP POLICY の修正**
   - strategy_select を削除しないように修正
   - または、削除理由をコメントで記載

5. **okrs テーブルの RLS 確認**
   - member 編集可能な RLS ポリシーがあるか
   - STAGE4 とSTAGE5 での使用パターン確認

---

## 8. 推奨される修正内容

### 修正1: Migration SQL の DROP POLICY を改善

**修正前**:
```sql
DROP POLICY IF EXISTS "strategy_select" ON strategy_data;
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;
```

**修正後**:
```sql
-- strategy_select は変更なし（member/manager/admin 全員 SELECT 可能）
-- 以下の3つのポリシーのみ修正
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;
```

### 修正2: 確認SQL の追加

```sql
-- 修正前：INSERT/UPDATE/DELETE が company_members 所属のみ
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'strategy_data'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE');

-- 修正後の確認
SELECT COUNT(*) FROM strategy_data
WHERE EXISTS (
  SELECT 1 FROM company_members
  WHERE company_id = strategy_data.company_id
    AND user_id = <member_user_id>
)
AND EXISTS (
  SELECT 1 FROM company_members cm
  WHERE company_id = strategy_data.company_id
    AND user_id = <member_user_id>
    AND role IN ('manager', 'admin')
);
-- 修正後は 0 件であることを確認（member は INSERT/UPDATE/DELETE 不可）
```

---

## 9. 次のアクション

### ✅ 完了

1. ✅ Migration SQL 作成
2. ✅ SQL 内容精査

### ⏳ 実施待ち（修正実施前の確認）

1. **STAGE4 の保存先確認**（コード検索）
   - okrs テーブルか strategy_data か
   - member の書き込み可能性

2. **API 権限設計の最終確認**
   - STAGE3 で manager チェックが必要か
   - STAGE4 で member チェックが不要か

3. **Migration SQL の微調整**
   - DROP POLICY を改善

### ❌ まだ実施しない

- Supabase への migration 適用
- テスト実行
- コード修正

---

**ステータス**: Migration 案の精査完了。STAGE4 保存先の確認が次の優先事項。
