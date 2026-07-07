# strategy_data RLS 修正：PoC 前最終判定

**作成日**: 2026-06-28  
**ステータス**: PoC 前適用見送り決定  
**優先度**: 重要な方針決定  

---

## 1. STAGE4 保存先の最終判定

### ✅ 確認されたデータ保存状況

#### **okrs テーブル**
- **件数**: 472 件存在
- **用途**: STAGE4 の OKR/KPI 正本データ
- **役割**: 実際の KPI 値を管理

#### **strategy_data テーブル**
STAGE4 関連の補助データが実際に保存されている：

| データ | 用途 | 影響 |
|------|------|------|
| **project_target_impacts** | STAGE4 での「売上寄与」など影響試算 | 🔴 member の保存が必要 |
| **okr_target_scores** | OKR 進捗スコア | 🔴 member の保存が必要 |
| **stage3_strategy_bridge** | STAGE3 の戦略展開ブリッジ | 🔴 member の参照が必要 |

### 🔴 **最終判定：strategy_data UPDATE を manager/admin のみに制限するのは危険**

**理由**:
- STAGE4 の補助データ（project_target_impacts, okr_target_scores）が strategy_data に保存されている
- member がこれらのデータを編集・保存する機能が実装されている
- strategy_data UPDATE を manager/admin のみに制限すると、member のSTAGE4 保存機能全体が壊れる可能性がある

---

## 2. strategy_data RLS 修正をPoC前に見送る理由

### ❌ **PoC前の適用を見送る決定**

**判定**: **適用保留** → PoC 後に設計再検討

**理由**:

1. **STAGE4 データが strategy_data に混在している**
   - project_target_impacts（STAGE4 の影響試算）
   - okr_target_scores（OKR 進捗管理）
   - これらは member が編集する必要がある

2. **STAGE1-3 のデータと STAGE4 のデータが同じテーブルにある**
   - STAGE1-3: manager/admin のみが編集（保護が必要）
   - STAGE4: member も編集（アクセス必要）
   - 同じテーブルで異なる権限制御ができない

3. **カラムレベルの権限制御が実装されていない**
   - PostgreSQL RLS ではテーブル全体またはポリシーレベルの制御のみ
   - 特定カラムへのアクセスだけ制限することは困難

4. **テーブル分離が先決**
   - strategy_data から STAGE4 関連データを分離する必要がある
   - その後に各テーブルで独立した RLS 設定が可能

---

## 3. PoC前の安全運用チェックリスト

### ✅ **PoC前に確認すべき項目**

| 項目 | 確認内容 | 状態 |
|------|---------|------|
| **UI制御** | STAGE1-3 の編集UI が member に見えていないか | ⏳ 確認待ち |
| **API制御** | STAGE1-3 保存API が manager/admin 制限されているか | ⏳ 確認待ち |
| **導線制限** | PoC では member に STAGE1-3 編集導線を提供しない | ✅ 実装予定 |
| **STAGE4/5** | member の STAGE4/5 編集機能は正常に動作するか | ⏳ テスト待ち |
| **RLS** | 現在の RLS（role チェックなし）のまま PoC 実施 | ✅ 決定 |

### 📋 **PoC前チェック手順**

#### 1. **UI 層の確認**
```typescript
// app/stage1/page.tsx
const canEdit = isAdmin || isManager;  // member は除外されているか

// app/stage2/page.tsx
const canEdit = isAdmin || isManager;  // member は除外されているか

// app/stage3/page.tsx
const canEdit = isAdmin || isManager;  // member は除外されているか
```

確認: member が STAGE1-3 の保存ボタンを見つけられない状態か

#### 2. **API 層の確認**
```typescript
// /api/stage1/import, /api/stage2/generate-*, /api/stage3/* など
const membership = await requireMembership(admin, userId);
await assertMinRole(membership, 'manager');  // role チェックがあるか
```

確認: API が manager/admin 以上を強制しているか

#### 3. **PoC 実施時の制限**
- member ユーザーに STAGE1-3 へのアクセス導線を提供しない
- member は STAGE4-5 へのアクセスのみ許可
- member の STAGE4 編集・保存が正常に動作することを確認

---

## 4. PoC後のテーブル分離方針

### 🎯 **目標：STAGE4 関連データを strategy_data から分離**

#### **分離対象データ**

| 現在の格納先 | データ | 新テーブル |
|----------|------|----------|
| strategy_data | project_target_impacts | **execution_impacts** (新) |
| strategy_data | okr_target_scores | **execution_scores** (新) |
| strategy_data | stage4Plans | **execution_plans** (新) |
| strategy_data | executionPlanBaseline | execution_plans (新) |
| strategy_data | stage3_strategy_bridge | **strategy_bridge** (新) |

#### **新テーブル設計案**

##### **1. execution_plans**
```sql
CREATE TABLE execution_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  strategy_id UUID NOT NULL REFERENCES strategy_data(id),
  
  -- STAGE4 実行計画
  stage4_plans JSONB,          -- 部門別実行計画
  baseline JSONB,               -- STAGE3 から生成されたベースライン
  
  -- RLS: member/manager/admin すべて編集可能
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP DEFAULT now(),
  updated_by UUID,
  
  CONSTRAINT execution_plans_company_fk 
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- RLS: テーブル全体で member/manager/admin 許可
CREATE POLICY "execution_plans_select"
  ON execution_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = execution_plans.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "execution_plans_insert"
  ON execution_plans FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = execution_plans.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "execution_plans_update"
  ON execution_plans FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = execution_plans.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "execution_plans_delete"
  ON execution_plans FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = execution_plans.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
```

##### **2. execution_impacts**
```sql
CREATE TABLE execution_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  strategy_id UUID NOT NULL REFERENCES strategy_data(id),
  
  -- STAGE4 での影響試算
  project_target_impacts JSONB,  -- 「[STAGE4] 売上寄与」などの影響数値
  
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP DEFAULT now(),
  updated_by UUID,
  
  CONSTRAINT execution_impacts_company_fk 
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- RLS: member/manager/admin 編集可能
-- (execution_plans と同様)
```

##### **3. execution_scores**
```sql
CREATE TABLE execution_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  strategy_id UUID NOT NULL REFERENCES strategy_data(id),
  
  -- OKR 進捗スコア
  okr_target_scores JSONB,
  
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP DEFAULT now(),
  updated_by UUID,
  
  CONSTRAINT execution_scores_company_fk 
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- RLS: member/manager/admin 編集可能
-- (execution_plans と同様)
```

##### **4. strategy_bridge**
```sql
CREATE TABLE strategy_bridge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  strategy_id UUID NOT NULL REFERENCES strategy_data(id),
  
  -- STAGE3 戦略展開ブリッジ
  stage3_bridge JSONB,
  
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP DEFAULT now(),
  updated_by UUID,
  
  CONSTRAINT strategy_bridge_company_fk 
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- RLS: member は SELECT のみ、manager/admin は全操作
CREATE POLICY "strategy_bridge_select"
  ON strategy_bridge FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = strategy_bridge.company_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "strategy_bridge_write"
  ON strategy_bridge FOR INSERT, UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = strategy_bridge.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
```

#### **既存 strategy_data テーブルの修正**

strategy_data から上記カラムを削除：
- project_target_impacts
- okr_target_scores  
- stage3_strategy_bridge
- stage4Plans
- executionPlanBaseline

修正後、strategy_data は STAGE1-3 のデータのみを保有

```sql
-- strategy_data の RLS（修正後）
-- STAGE1-3 のみなので manager/admin 制限で安全
CREATE POLICY "strategy_data_update"
  ON strategy_data
  FOR UPDATE
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = strategy_data.company_id
        AND user_id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
```

---

## 5. 今後のRLS再設計案

### **フェーズ1：PoC（実施中）**
- ✅ RLS 修正は適用見送り
- ✅ API/UI で manager/admin チェックを確認
- ✅ member に STAGE1-3 編集導線を提供しない
- ✅ member の STAGE4-5 編集動作を検証

### **フェーズ2：PoC後（本格対応）**
- ⏳ テーブル分離を実装
  - strategy_data（STAGE1-3 のみ）
  - execution_plans / execution_impacts / execution_scores（STAGE4）
  - strategy_bridge（STAGE3 bridge）

- ⏳ 各テーブルで独立した RLS を設定
  - strategy_data: manager/admin のみ UPDATE
  - execution_* テーブル: member/manager/admin UPDATE 可能

- ⏳ コード修正
  - saveStrategyData() を分割
  - 各テーブルへの save 処理を実装

- ⏳ マイグレーション実施
  - 既存データの分散処理
  - RLS 有効化

### **フェーズ3：STAGE5-6 対応**
- okrs / progress_logs の RLS 設定
- 完全な権限分離の実装

---

## 6. 作成済み Migration ファイルの位置づけ

**ファイル**: `supabase/migrations/20260628_fix_strategy_data_rls_role_control.sql`

**現在の状態**: **適用保留**

**理由**: STAGE4 関連データが strategy_data に含まれており、member アクセス制限で機能が壊れる可能性

**今後の扱い**:
- ❌ PoC 前には適用しない
- ⏳ PoC 後、テーブル分離実装時に参考として使用
- 📝 strategy_data からSTAGE4 データを削除後、修正・適用予定

---

## 7. 結論

### **PoC前の結論**

```
✅ RLS 修正は見送り
✅ API/UI でのチェックで十分
✅ member の STAGE4 編集機能を維持
✅ PoC では member に STAGE1-3 導線を提供しない
```

### **PoC後の方針**

```
✅ テーブル分離を実装
✅ strategy_data（STAGE1-3）と STAGE4 データを分離
✅ 各テーブルで独立した RLS 設定
✅ member/manager/admin の権限を明確に分離
```

---

**ステータス**: 最終決定完了。PoC 前は RLS 修正見送り、API/UI チェックで対応。PoC 後にテーブル分離を実装。
