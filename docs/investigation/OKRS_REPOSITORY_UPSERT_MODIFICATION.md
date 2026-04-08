# okrsRepository.upsert() 修正 - business key 対応

**日時:** 2026-04-06
**対象ファイル:** utils/supabase/okrsRepository.ts (line 104-156)

---

## 1. 修正内容

### 修正前（行 138-142）

```typescript
const { data, error } = await supabase
  .from(TABLE_NAME)
  .upsert(insertData, {
    onConflict: 'id',  // ← id のみで衝突判定
  })
  .select()
  .single();
```

**問題：**
- `onConflict: 'id'` は「既存 id と衝突したら UPDATE」という意味
- しかし `ensureMainOkrIsDbBacked()` では id を指定していないため、毎回新しい id が生成される
- 結果：衝突しない → 毎回 INSERT → 同じ project_id + objective でも複数行が作成される

---

### 修正後

```typescript
const onConflictKey = input.id
  ? 'id'
  : 'company_id,strategy_id,department_id,project_id,objective';

const { data, error } = await supabase
  .from(TABLE_NAME)
  .upsert(insertData, {
    onConflict: onConflictKey,  // ← business key で衝突判定
  })
  .select()
  .single();
```

**改善：**
- id がない場合：`company_id,strategy_id,department_id,project_id,objective` で衝突判定
- DB partial unique index `okrs_unique_active_business_key` に対応
- 同じ project_id + objective なら UPDATE（新規 INSERT ではなく）
- 新しい id が生成されても、business key で既存行と認識 → UPDATE
- 既存行の updated_at が自動更新される

---

## 2. upsert Payload の検証

### Payload 構造

```typescript
const insertData = {
  id: okrId,
  company_id: companyId,                      // ★ upsert key に含まれる
  strategy_id: input.strategy_id,             // ★ upsert key に含まれる
  department_id: input.department_id,         // ★ upsert key に含まれる
  project_id: input.project_id,               // ★ upsert key に含まれる
  objective: input.objective,                 // ★ upsert key に含まれる

  key_results_json: input.key_results_json || [],
  owner_user_id: input.owner_user_id || null,
  owner_name: input.owner_name || null,
  status: input.status || 'draft',
  sort_order: input.sort_order ?? 0,
  source_stage: input.source_stage || 'migration',
  source_okr_id: input.source_okr_id || null,
  is_deleted: false,                          // ← partial index の条件（active 行のみ衝突判定対象）
  meta_json: input.meta_json || {},
  updated_at: new Date().toISOString(),
};
```

### 5列の確認リスト

| 列 | 値の取得元 | null チェック | 備考 |
|---|---|---|---|
| company_id | assertCompanyId(companyId) 後 | N/A | 入力時点で検証済み |
| strategy_id | input.strategy_id | 呼び出し側で確認必須 | OKR 作成時に指定される |
| department_id | input.department_id | 呼び出し側で確認必須 | 部門 ID（必須） |
| project_id | input.project_id | 呼び出し側で確認必須 | プロジェクト ID（必須） |
| objective | input.objective | 呼び出し側で確認必須 | OKR 目的（必須） |

---

## 3. 動作フロー

### シナリオ：同一 OKR の再保存

#### Step 1: 初回保存（新規 OKR）
```
入力：{ strategy_id: 's1', department_id: 'd1', project_id: 'proj-x45591', objective: '半導体...' }
↓
id を生成：okrId = uuid-1
↓
upsert payload：
  { id: uuid-1, company_id, strategy_id: s1, department_id: d1, project_id: proj-x45591, objective: 半導体, ... }
↓
onConflict: 'company_id,strategy_id,department_id,project_id,objective'
→ DB に該当行なし → INSERT
↓
DB 結果：
  id=uuid-1, company_id, strategy_id=s1, department_id=d1, project_id=proj-x45591, objective=半導体, is_deleted=false
```

#### Step 2: 同じ OKR の再保存（owner 更新など）
```
入力：{ strategy_id: 's1', department_id: 'd1', project_id: 'proj-x45591', objective: '半導体...', owner_name: '新しい担当者' }
↓
id を生成：okrId = uuid-2（新しい id！）
↓
upsert payload：
  { id: uuid-2, company_id, strategy_id: s1, department_id: d1, project_id: proj-x45591, objective: 半導体, owner_name: 新しい担当者, ... }
↓
onConflict: 'company_id,strategy_id,department_id,project_id,objective'
→ DB に該当行あり（uuid-1） → UPDATE
↓
DB 結果：
  id=uuid-1（変更なし）
  company_id, strategy_id=s1, department_id=d1, project_id=proj-x45591, objective=半導体, owner_name=新しい担当者
  updated_at=現在時刻（更新された）
```

**重要：**
- id uuid-2 は使用されず
- 既存行 uuid-1 が UPDATE される
- DB 行数が増えない
- 複数ある場合の挙動：partial index のため、is_deleted=false の行のみが衝突判定対象

---

## 4. is_deleted=true との関係

### Partial Index の効果

```sql
CREATE UNIQUE INDEX okrs_unique_active_business_key
ON okrs(company_id, strategy_id, department_id, project_id, objective)
WHERE is_deleted = false;  -- ← active 行のみを unique 制約対象に
```

### 再保存シナリオ（soft delete 後の再作成）

```
Step 1: 初回作成
  id=uuid-1, objective=半導体..., is_deleted=false

Step 2: 削除（soft delete）
  id=uuid-1, objective=半導体..., is_deleted=true

Step 3: 同じ objective を再作成（ユーザーが再度入力）
  入力：{ project_id: proj-x45591, objective: 半導体... }
  ↓
  id を生成：uuid-3
  ↓
  onConflict: 'company_id,strategy_id,department_id,project_id,objective'
  → DB に is_deleted=false の該当行なし（uuid-1 は is_deleted=true だから partial index から除外）
  → INSERT
  ↓
  DB 結果：
    uuid-1, objective=半導体..., is_deleted=true    （変更なし）
    uuid-3, objective=半導体..., is_deleted=false   （新規行）
```

**重要：**
- soft delete された行と active な行は独立している
- 同じ objective でも、soft delete 後なら新規行が作成される（これは正常動作）

---

## 5. 戻り値と id 処理

### 戻り値型

```typescript
export async function upsert(
  input: OkrWriteInput,
  companyId: string
): Promise<OkrRow> {
  // ...
  return data as OkrRow;
}
```

### INSERT 時（初回）
```
入力 id：指定なし
生成 id：uuid-1
戻り値 id：uuid-1
```

### UPDATE 時（再保存、id 指定）
```
入力 id：uuid-1
生成 id：uuid-1（input.id がある場合は生成しない）
戻り値 id：uuid-1（変更なし）
```

### UPDATE 時（再保存、id 未指定、business key 衝突）
```
入力 id：指定なし
生成 id：uuid-2
実際に UPDATE された行の id：uuid-1
戻り値 id：uuid-1（DB から返されたもの）
```

**重要：**
- 戻り値は DB から返された OkrRow なので、id は実際の DB id
- 生成した id と異なる可能性がある（business key 衝突時）
- 呼び出し側でこの id を正しく使用する必要がある

---

## 6. 確認方法

### 方法1: console.log で payload を確認

```typescript
console.log('[okrsRepository.upsert] payload keys:', Object.keys(insertData));
console.log('[okrsRepository.upsert] onConflict:', onConflictKey);
```

期待値：
```
onConflict: 'company_id,strategy_id,department_id,project_id,objective'
payload keys: ['id', 'company_id', 'strategy_id', 'department_id', 'project_id', 'objective', ...]
```

### 方法2: Supabase の audit log で確認

Supabase Dashboard → SQL Editor で以下のクエリ実行：

```sql
-- 同じ project_id + objective で複数回保存後
SELECT
  id,
  project_id,
  objective,
  created_at,
  updated_at,
  is_deleted
FROM okrs
WHERE project_id = 'proj-x45591'
  AND objective = '半導体企業向けデータ分析サービスの強化'
ORDER BY created_at DESC;

-- 期待値：
-- - id は1件のみ（同じ行が UPDATE されている）
-- - updated_at が複数回更新されている
-- - is_deleted=false は1件のみ
```

### 方法3: 実際のアプリで確認

1. STAGE4 で新しい OKR を作成
2. 同じ objective で再度保存（owner 変更など）
3. 同じ project_id + objective のログを確認
4. DB 行が増えていないことを確認

---

## 7. 修正の影響範囲

### 呼び出し元

1. `addProjectOKR()` (app/okr/page.tsx:1320)
   - id を指定していない → business key で衝突判定
   - 同じ objective で再度 addProjectOKR() が呼ばれると UPDATE

2. `ensureMainOkrIsDbBacked()` (app/okr/page.tsx:1022)
   - id を指定していない → business key で衝突判定
   - snapshot OKR の DB 化時に重複防止

3. `updateProjectOKRDb()` (app/okr/page.tsx:1097)
   - id を指定している → id で衝突判定（従来通り）
   - 既存 OKR の修正時に id 指定されるため、動作変わらず

### 既存データへの影響

- 既存の active OKR には影響なし（新規保存時のみ動作変わる）
- is_deleted=true の履歴行は影響なし（partial index で除外）

---

## 8. 次のステップ

1. ✅ okrsRepository.upsert() を修正
2. 🔄 mergeOkrSources() を修正（重複 OKR を1件に収束）
3. 🔄 invalidateAndRefetchProjectOkrs() を修正（snapshot を排除）
4. 🔄 STAGE5 で保存成功確認

