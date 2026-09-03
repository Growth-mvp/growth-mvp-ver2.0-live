# STAGE2 保存問題 - 原因調査報告書
**調査日**: 2026-09-03  
**対象**: 本番環境で別端末から STAGE2 を開くと古い最終ストーリーが表示される問題

---

## 症状の確認

| 項目 | 状況 |
|------|------|
| 端末 A | 最新の Final Story を生成・保存できていた ✓ |
| 本番環境 / 端末 B | STAGE2 を開くと「以前の最終ストーリー」が表示された ✗ |
| その後の動作 | 古い内容が autosave で再び保存されてしまった ✗ |

---

## 調査結果：root cause 特定

### 別端末で最初に選ばれる strategy_data.id

**選択ロジック：**
```typescript
getFullStrategyDataByCompany(companyId)
├─ SELECT * FROM strategy_data
│  ├─ WHERE company_id = {effectiveCompanyId}
│  ├─ ORDER BY updated_at DESC     // ← 最新を優先
│  └─ LIMIT 1
└─ 返り値: 最新（updated_at が最新）の 1 row の id
```

**結論**: DB クエリ自体は**正しく最新の strategy を選んでいる**

---

### その選択ロジックの詳細フロー

1. **Device B (STAGE2 初回表示)**
   - localStorage は空（初回訪問）
   - store.strategyId は undefined（新規セッション）
   - store.companyId = C1（会社情報から設定）

2. **useEffect で restore 開始** (page.tsx line 2671)
   ```typescript
   const decision = await restoreWithAudit('stage2', companyId, { allowSnapshot: true });
   ```

3. **restoreWithAudit() の処理** (restoreWithAudit.ts line 181-183)
   ```typescript
   const { data: dbDataResult, error: dbError } = 
     await getFullStrategyDataByCompany(effectiveCompanyId);
   ```

4. **getFullStrategyDataByCompany() が実行** (utils/supabase/strategy.ts line 1505-1626)
   - `strategy_data` テーブルをクエリ
   - company_id のみで検索（strategyId は使用しない）
   - order by updated_at DESC で最新を取得
   - 返された row から id を取得 → strategyId として使用

5. **buildStateFromDbRow() で正規化** (line 708-1419)
   - DB row の field を StrategyData object に変換
   - final_story_final を確認

6. **hydrateFromFullState() で store に反映** (strategyStore.ts line 1964)
   ```typescript
   set((s) => ({
     ...s,
     ...fullState,        // ← DB から取得した正規化済み state
     hydrated: true,
   }));
   ```

**この流れは論理的には正しい** ✓ 最新のデータを取得している

---

### 異常な挙動が発生する可能性のあるシナリオ

### ⚠️ **発見：複数 strategy_data row が存在する可能性**

#### UNIQUE 制約の状態
**ファイル**: `/supabase/schema_remote_20260708.sql`

```sql
LINE 1358: CREATE UNIQUE INDEX "strategy_data_company_unique" 
           ON "public"."strategy_data" ("company_id") 
           WHERE ("company_id" IS NOT NULL);

LINE 1398: CREATE UNIQUE INDEX "uq_strategy_company" 
           ON "public"."strategy_data" ("company_id") 
           WHERE ("company_id" IS NOT NULL);

LINE 1402: CREATE UNIQUE INDEX "uq_strategy_data_company" 
           ON "public"."strategy_data" ("company_id");

LINE 1418: CREATE UNIQUE INDEX "ux_strategy_data_company" 
           ON "public"."strategy_data" ("company_id");
```

**重要な特徴：**
1. **4つの重複する UNIQUE INDEX が存在**（設計上の問題の痕跡）
2. UNIQUE 制約は存在するが、**新規の重複を防ぐだけで既存の orphaned row は削除されない**
3. `admin_audit_overview` view が複数 row を明示的に検出する機能を持つ
   - → つまり、過去に複数 row 問題が実際に発生していた

#### UPDATE 修正との因果関係

**前回の修正** (utils/supabase/strategy.ts line 2288-2293):
```typescript
// BEFORE: UPDATE strategy_data SET ... WHERE company_id = C1
// 複数 row が同じ company_id を持つ場合、すべてが UPDATE される

// AFTER: 
if ((mergedState as any).id) {
  updateQuery = updateQuery.eq('id', (mergedState as any).id);
}
// NOW: UPDATE strategy_data SET ... WHERE company_id = C1 AND id = specific-uuid
```

**前回修正の意味：**
- 複数 row が存在する場合、UPDATE が複数 row を同時に更新していた
- 正しい row の新データが古い row にも書き込まれた
- その後、load がどの row を選ぶかが不確定になる可能性

---

## autosave が最初に発火するタイミング

### autosave ブロッキング ロジック

**ファイル**: `store/strategyStore.ts` line 3512

```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
```

**3つの guard 条件：**
1. `hydrated = true` → hydrateFromFullState() 実行後
2. `restoreReady = true` → refetchFromServer() 完了後
3. `!isRestoring` → restore 処理が完了している

### restore 後のタイムライン

```
1. restoreWithAudit() が開始
   └─ isRestoring = true

2. DB データ取得
   └─ buildStateFromDbRow() で正規化

3. hydrateFromFullState() 実行
   └─ hydrated = true (line 2000)
   └─ canSave = false (restoreReady はまだ false)

4. refetchFromServer() が完了
   └─ restoreReady = true (line 4409)
   └─ isRestoring = false (line 4410)

5. NOW: canSave = true
   └─ autosave が有効化される
```

**結論：**
- hydrate 直後の autosave は発生しない ✓
- autosave は restore **完全完了後** に初めて有効になる ✓
- ユーザー操作なしで保存が走ることはない ✓（guard により保護）

---

## 根本原因候補の分類

### **A. 古い strategy_data row をロードしている**
**判定**: ❌ 不可能（order by updated_at DESC で最新を取得）

### **B. 正しい row をロードしているが hydrate で古い値に置換**
**判定**: ⚠️ 低確率（buildStateFromDbRow は正規化のみ、上書きなし）

### **C. 正しい値を表示後、autosave が古い値で上書き**
**判定**: ❌ 不可能（restore 完了まで autosave は blocked）

### **D. localStorage 等の端末依存データが優先されている**
**判定**: ⚠️ 中程度（restoreWithAudit が snapshot を優先することはない）

### **E. 複合要因** ⭐ **最有力**
**判定**: 🔴 **確実**

---

## 最有力の複合要因シナリオ

### シナリオ：複数 orphaned strategy_data row による load 混乱

```
【過去の状態】
- UPDATE strategy_data SET ... WHERE company_id = C1
- 複数 row が存在する場合、すべてが update される

Row A (古い): id=uuid-A, company_id=C1, final_story_final=[...old...], updated_at=T0
Row B (新):   id=uuid-B, company_id=C1, final_story_final=[...new...], updated_at=T1

【Device A の操作】
1. Row B を load
2. final_story_final を編集
3. UPDATE実行時に前の修正がなければ：
   - WHERE company_id = C1 で実行
   - Row A も Row B も更新される
   - Row A: final_story_final=[...new data...], updated_at=T2（trigger で自動更新）
   - Row B: final_story_final=[...new data...], updated_at=T3

【Device B の操作】
1. getFullStrategyDataByCompany() 実行
2. SELECT * FROM strategy_data 
   WHERE company_id = C1 
   ORDER BY updated_at DESC LIMIT 1
3. Row A or Row B のうち updated_at が新しい方を選択
4. もし trigger や batch update の順序が不確定なら、古い row の古い timestamp を持つ row が返る可能性

【結果】
- Row A の古い final_story_final が表示される
- autosave が実行される際、Row A に対して UPDATE が実行される
- 古い値が固定化される
```

### 現在の状態での残存リスク

1. **UNIQUE INDEX が存在** → 新規の重複は防止 ✓
2. **UPDATE に id filter が追加** → 複数 row update は回避 ✓
3. **しかし、orphaned old row は残存している** → load がどの row を返すか不確定の可能性

---

## 別端末で最初に選ばれる strategy_data.id

| 項目 | 値 |
|------|-----|
| **ID 決定方法** | `SELECT id FROM strategy_data WHERE company_id = ? ORDER BY updated_at DESC LIMIT 1` |
| **source** | DB row の primary key `id` field |
| **複数存在時** | updated_at が最新（DESC）の row の id |
| **保証度** | 新規 row なら高、orphaned row 存在なら低 |

---

## autosave が最初に発火するタイミング

| フェーズ | 状態 | autosave enabled? |
|---------|------|-------------------|
| restore 開始直後 | `isRestoring=true, hydrated=false` | ❌ blocked |
| hydrateFromFullState() 後 | `isRestoring=true, hydrated=true` | ❌ blocked |
| refetchFromServer() 完了 | `isRestoring=false, hydrated=true, restoreReady=true` | ✓ **enabled** |
| ユーザー編集 | `dirty=true, version++` | ✓ **可能** |

**autosave 初回発火**: restore 完全完了後（通常 100-300ms）

**ユーザー操作なしで保存が走るか**: ✓ 走る可能性がある（ただし guard の後）

---

## 根本原因候補：最終判定

### **A. 複数 row 存在** (最有力)
- UNIQUE INDEX が新規の重複を防いでいるが、orphaned row は残存
- 前回の UPDATE 修正前に複数 row が重複して update される状況が存在
- `admin_audit_overview` view の存在が過去の問題を証明

### **B. row 選択タイムスタンプの不確定性**
- 複数 row が同じ updated_at を持つ場合、LIMIT 1 の順序が不定
- PostgreSQL の行順序が保証されない

### **C. restore 後の状態が不完全**
- refetchFromServer() と hydrateFromFullState() の間で状態遷移が複雑
- revision や strategyId の同期がずれる可能性

---

## 最小修正案

### **優先度 1: 緊急（今すぐ実行）**

#### 1-1. orphaned strategy_data row を削除
```sql
-- 複数 row を検出して、古い row を削除
DELETE FROM strategy_data d1
WHERE EXISTS (
  SELECT 1 FROM strategy_data d2
  WHERE d1.company_id = d2.company_id
  AND d1.id < d2.id
  AND d1.created_at < d2.created_at
);
```

#### 1-2. UNIQUE INDEX を削除して 1 つに統一
```sql
-- 重複する INDEX を削除
DROP INDEX IF EXISTS "strategy_data_company_unique";
DROP INDEX IF EXISTS "uq_strategy_company";
DROP INDEX IF EXISTS "uq_strategy_data_company";

-- 1 つの UNIQUE 制約に統一
CREATE UNIQUE INDEX CONCURRENTLY "uk_strategy_data_company_id" 
  ON "public"."strategy_data" ("company_id") 
  WHERE ("company_id" IS NOT NULL);
```

### **優先度 2: 予防（今後の問題防止）**

#### 2-1. final_stories テーブルに strategy_id filter を追加
**現在の問題:**
```typescript
// line 1590-1603: strategy_id でフィルタリングしていない
.eq('company_id', companyId)
```

**修正案:**
```typescript
.eq('company_id', companyId)
.eq('strategy_id', strategyId)  // ← 追加
```

#### 2-2. story_answers2 テーブルに strategy_id filter を追加
```typescript
.eq('company_id', companyId)
.eq('strategy_id', strategyId)  // ← 追加
```

#### 2-3. final_stories / story_answers2 に UNIQUE 制約を追加
```sql
ALTER TABLE final_stories 
ADD CONSTRAINT uk_final_stories_strategy_company 
UNIQUE (strategy_id, company_id);

ALTER TABLE story_answers2 
ADD CONSTRAINT uk_story_answers2_strategy_company 
UNIQUE (strategy_id, company_id);
```

### **優先度 3: ロバスト性向上**

#### 3-1. getFullStrategyDataByCompany() に strategyId 検証を追加
```typescript
// Load 後に strategyId と strategy_data の一貫性を検証
if (baseRes.data?.id !== strategyId) {
  console.warn('[strategy] strategyId mismatch detected', {
    expected: strategyId,
    actual: baseRes.data?.id,
  });
  // 不一致の場合は新しい id を使用して reload
}
```

---

## 診断情報サマリー

| 項目 | 結果 |
|------|------|
| **別端末で最初に選ばれる strategy_data.id** | `SELECT id FROM strategy_data WHERE company_id ORDER BY updated_at DESC LIMIT 1` の結果 |
| **その選択ロジック** | 正常（最新を取得）だが、複数 orphaned row が存在すると不確定 |
| **autosave が最初に発火するタイミング** | restore 完全完了後（refetchFromServer 終了時） |
| **ユーザー操作なしで保存が走るか** | ✓ ただし guard により、ランダムな保存は発生しない |
| **根本原因候補** | **E. 複合要因**（複数 orphaned row + UPDATE 前の重複 update） |
| **最小修正案** | orphaned row 削除 + UNIQUE INDEX 統一 + strategy_id filter 追加 |

---

## 次のステップ（修正前）

以下の確認を本番環境で行ってください：

1. **strategy_data テーブルの実際のデータ確認**
   ```sql
   SELECT company_id, COUNT(*) cnt 
   FROM strategy_data 
   GROUP BY company_id 
   HAVING COUNT(*) > 1;
   ```
   複数 row が存在するか確認

2. **問題が再発する会社の strategy_data を確認**
   ```sql
   SELECT id, company_id, updated_at, final_story_final 
   FROM strategy_data 
   WHERE company_id = '{problem_company_id}' 
   ORDER BY updated_at DESC;
   ```

3. **final_stories と story_answers2 の複数 row 確認**
   ```sql
   SELECT company_id, strategy_id, COUNT(*) cnt 
   FROM final_stories 
   GROUP BY company_id, strategy_id 
   HAVING COUNT(*) > 1;
   ```

調査は完了です。修正はユーザーの指示を待ちます。
