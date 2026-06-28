# 🚨 CRITICAL：STAGE4 保存時の RLS 矛盾と対応策

**作成日**: 2026-06-28  
**ステータス**: 重大問題発見 - 対応策検討中  
**優先度**: PoC 前に必ず対応が必要  

---

## 1. 発見された重大問題

### 🔴 **主な矛盾**

| 層 | 設計 | 実装 | 結果 |
|----|------|------|------|
| **UI** | member も編集可能 | `canEdit = isAdmin \|\| isManager \|\| isMember` | ✅ member が編集画面を操作可 |
| **RLS（修正案）** | member は UPDATE 不可 | `role IN ('manager', 'admin')` | ❌ member の UPDATE 拒否 |
| **最終結果** | - | - | 💥 **保存に失敗** |

---

### ❌ **具体的な失敗シナリオ**

```
1. Member ユーザーが STAGE4 画面にアクセス
   → UI では canEdit = true で編集可能

2. 計画の draft を編集してボタンを押す
   → updateCurrent() → setStage4Plans() → autoSave trigger

3. saveStrategyData() が Supabase に UPDATE を送信
   UPDATE strategy_data SET stage4Plans = {...} WHERE company_id = ?

4. Supabase RLS で権限チェック
   strategy_update ポリシー: role IN ('manager', 'admin') ?
   member の role は 'member' → ❌ RLS violation

5. UPDATE 失敗 → 403 Forbidden
   → Member は STAGE4 を保存できない
```

---

## 2. STAGE4 での保存対象データ

### 全量が strategy_data テーブルに保存されている

**保存処理フロー**:

```typescript
// app/stage4/page.tsx
updateStatus() / updateCurrent()
  ↓
store.setStage4Plans(updated) // Zustand state 更新
  ↓
autoSave hook trigger
  ↓
utils/supabase/strategy.ts: saveStrategyData()
  ↓
UPDATE strategy_data 
SET stage4Plans = {...},
    departments = {...},
    projectTargetImpacts = {...},
    okrTargetScores = {...},
    projectIssueLinks = {...}
WHERE company_id = ? AND revision = ?
```

### 保存されるデータ一覧

| データ | 格納先 | 説明 |
|------|------|------|
| **stage4Plans[]** | strategy_data (JSONB) | 部門別実行計画（status, baseline, current） |
| **executionPlanBaseline** | strategy_data (JSONB) | STAGE3 から生成されたベースライン |
| **departments[]** | strategy_data (JSONB) | STAGE3 から引き継いだ部門・プロジェクト |
| **projectTargetImpacts[]** | strategy_data (JSONB) | プロジェクト→数値目標への影響量 |
| **okrTargetScores** | strategy_data (okr_target_scores) | OKR 進捗スコア |
| **projectIssueLinks[]** | strategy_data (JSONB) | プロジェクト→論点紐付け |

**結論**: STAGE4 の全データは strategy_data テーブルに集約保存されている。別テーブル（okrs など）には保存されていない。

---

## 3. 権限設計との矛盾分析

### GROWTH SHIFT の権限設計

```
STAGE1-3: manager/admin のみ編集可
STAGE4: member も編集可能（実行計画への参加）
STAGE5: member も編集可能（進捗報告）
```

### 現在の実装状況

| STAGE | UI 制御 | RLS 制御（修正案） | API 制御 | 実現度 |
|-------|--------|----------|---------|--------|
| **STAGE1-3** | manager/admin のみ | manager/admin の UPDATE | manager/admin のみ | ✅ 一貫 |
| **STAGE4** | member も編集可 | ❌ manager/admin のみ | member 不許可 | 💥 **矛盾** |
| **STAGE5** | member も入力可 | TBD (未修正) | member 許可 | ⏳ 未確認 |

**矛盾の根本原因**:
- STAGE4 は member の参加を想定した UI 設計
- しかし RLS では member の strategy_data UPDATE を制限
- strategy_data がすべてのデータを保持しているため、制限が全体に波及

---

## 4. RLS 修正案の再検討

### ❌ **現在の修正案（問題あり）**

```sql
CREATE POLICY "strategy_update"
  ON strategy_data
  FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')  -- ← member 除外
    )
  );
```

**問題**: member が STAGE4 を保存できなくなる

---

### 🔧 **代替案1：STAGE別に RLS を分ける（推奨）**

**考え方**: STAGE1-3 の strategy_data（戦略の正本）と STAGE4 のデータは分離

**実装方法**:
```sql
-- STAGE1-3 のデータ更新（戦略たたき台）→ manager/admin のみ
CREATE POLICY "strategy_update_stage_1_3"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  )
  -- ★ STAGE1-3 のカラムのみに限定（departments, finance_pl, など）
  WITH CHECK (true);

-- STAGE4 のデータ更新（実行計画）→ member/manager/admin
CREATE POLICY "strategy_update_stage_4"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  )
  -- ★ STAGE4 のカラムのみに限定（stage4Plans, executionPlanBaseline, など）
  WITH CHECK (true);
```

**利点**:
- ✅ STAGE1-3 の保護（manager/admin のみ）
- ✅ STAGE4 の member アクセス許可
- ✅ 権限設計と一貫性あり

**課題**:
- ⚠️ カラムレベルの制御は PostgreSQL RLS では難しい（CHECK 句では指定不可）
- ⚠️ 実装が複雑（トリガーで実装する必要がある可能性）

---

### 🔧 **代替案2：STAGE4 データを別テーブルに分離（大規模変更）**

**考え方**: STAGE4 の stage4Plans を別テーブル（execution_plans）に移動

**新テーブル構成**:
```sql
CREATE TABLE execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  strategy_id UUID NOT NULL REFERENCES strategy_data(id),
  stage4_plans JSONB,
  baseline JSONB,
  updated_at TIMESTAMP,
  updated_by UUID,
  UNIQUE(strategy_id)
);

-- RLS: member/manager/admin すべて UPDATE 可能
CREATE POLICY "execution_plans_update"
  ON execution_plans
  FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = execution_plans.company_id
        AND user_id = auth.uid()
    )
  );
```

**利点**:
- ✅ テーブルレベルでの権限分離が可能
- ✅ シンプルで明確な RLS ポリシー
- ✅ STAGE1-3 の strategy_data は manager/admin のみ制限できる

**課題**:
- ❌ コード修正が大規模（saveStrategyData() の変更）
- ❌ スキーマ変更のため、既存データマイグレーションが必要

---

### 🔧 **代替案3：STAGE4 は member を除外する（権限設計の変更）**

**考え方**: STAGE4 の権限設計を manager/admin のみに変更

**変更内容**:
```typescript
// app/stage4/page.tsx
const canEdit = isAdmin || isManager;  // member 除外
```

**利点**:
- ✅ RLS 修正案をそのまま適用可能
- ✅ コード変更最小限

**課題**:
- ❌ 権限設計の意図（member の参加）に反する
- ❌ ユーザー体験の低下（member は見るだけ）

---

## 5. 推奨対応策

### **段階的アプローチ**

#### **Phase 1（PoC 前 - 最小修正）**
1. **STAGE4 の権限設計を確認**
   - member が本当に STAGE4 で編集すべきか確認
   - プロダクト要件と UI 実装のズレを確認

2. **その上で、以下のいずれかを選択**:

   **Case A: Member が STAGE4 を編集すべき場合**
   → **代替案2（テーブル分離）** または **代替案1（カラムレベルRLS）** を採用
   → PoC 前にコード修正が必要

   **Case B: Member は STAGE4 編集不要（manager/admin のみ）の場合**
   → **代替案3** を採用（UI から member 除外）
   → RLS 修正案をそのまま適用可能

---

## 6. STAGE3 の確認結果

### STAGE3 の保存先

**ファイル**: `app/api/stage3/generate-strategy-bridge/route.ts`

- draft 生成 API のみ（DB 保存なし）
- 実際の保存は画面側で実施

### STAGE3 での保存

```typescript
// app/stage3/page.tsx と関連 components
// strategy_data の departments カラムに保存（推定）
```

### STAGE3 の RLS 制御

**現在の実装**:
- API: `requireMembership()` のみ（role チェックなし）
- RLS: strategy_update ポリシーで manager/admin に制限（修正案）

**結論**: STAGE3 も strategy_data を UPDATE するため、RLS 修正案の影響を受ける

---

## 7. Migration SQL の修正版案

### DROP POLICY の改善

**修正前**:
```sql
DROP POLICY IF EXISTS "strategy_select" ON strategy_data;
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;
```

**修正後（推奨）**:
```sql
-- strategy_select は変更しない（member/manager/admin 全員 SELECT 可能）
-- strategy_insert/update/delete のみ修正
DROP POLICY IF EXISTS "strategy_insert" ON strategy_data;
DROP POLICY IF EXISTS "strategy_update" ON strategy_data;
DROP POLICY IF EXISTS "strategy_delete" ON strategy_data;

-- strategy_select は現状維持
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

### INSERT ポリシー（現在のまま）
```sql
CREATE POLICY "strategy_insert"
  ON strategy_data
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
```

### UPDATE ポリシー（STAGE4 対応が必須）

#### **案A: STAGE4 用に別ポリシー追加**
```sql
-- STAGE1-3 データ用（manager/admin のみ）
CREATE POLICY "strategy_update_stage_1_3"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

-- STAGE4 データ用（member/manager/admin）
CREATE POLICY "strategy_update_stage_4"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
    )
  );
```

**課題**: PostgreSQL は複数の同じ操作の UPDATE ポリシーを持つことができない（後者が優先される）。トリガーで実装する必要がある。

#### **案B: STAGE4 を除外（manager/admin のみ）**
```sql
CREATE POLICY "strategy_update"
  ON strategy_data
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
```

**注**: STAGE4 で member 編集が不要の場合のみこの案で対応可能

### DELETE ポリシー（変更なし）
```sql
CREATE POLICY "strategy_delete"
  ON strategy_data
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );
```

---

## 8. 結論と次のアクション

### 🔴 **現在の修正案は安全でない**

- STAGE4 で member が編集・保存できなくなる可能性が高い
- strategy_data がすべてのデータを保有しているため、カラムレベルの権限分離ができない

### ✅ **次に確認すべき項目**

1. **STAGE4 の権限設計確認**（最優先）
   - member が本当に STAGE4 で編集すべきか
   - 実装上の requirement を確認

2. **対応策の選択**
   - Case A: member が編集すべき → テーブル分離か カラムレベルRLS の実装
   - Case B: member は不要 → UI から member 除外、RLS 修正案そのまま適用

3. **API 層の権限確認**
   - STAGE3/4 の API が role チェックを実施しているか
   - API 層で先に制限されている場合、RLS は二重防御

### ❌ **まだ実施してはいけない**

- Migration の Supabase 適用
- コード修正
- RLS の実装確認テスト

---

**ステータス**: STAGE4 の保存設計再検討が必須。権限設計との矛盾を解決してから RLS 修正を進める。
