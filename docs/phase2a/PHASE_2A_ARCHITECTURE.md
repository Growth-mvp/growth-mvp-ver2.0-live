# Phase 2A アーキテクチャ詳細設計

## Ⅰ. レイヤー構成図

```
┌─────────────────────────────────────────────────────────────┐
│                    UI層（各 STAGE）                          │
│  STAGE3 (cascade/page.tsx)                                  │
│  STAGE4 (okr/page.tsx)          ← 最優先切替対象             │
│  STAGE5 (execution/page.tsx)                                │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│            Service層（新規：services/okrService.ts）         │
│                                                              │
│  resolveProjectsWithOkrs()                                  │
│    → okrs テーブルから読込                                   │
│    → snapshot fallback 併用                                 │
│    → merge ロジック一元化                                    │
│                                                              │
│  upsertOkr()                                                │
│    → okrs テーブルへ save                                    │
│    → snapshot sync (syncOkrsSnapshotToStrategyData)        │
│                                                              │
│  deleteOkr() / reorderOkrs()                                │
│    → soft delete / sort_order 更新                          │
│    → snapshot 同期                                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
         ┌─────────┴──────────┐
         ↓                    ↓
┌────────────────────┐  ┌──────────────────────────┐
│  Repository層      │  │  Store層                 │
│ (okrsRepository)   │  │ (strategyStore)          │
│                    │  │                          │
│ - query()          │  │ - departments            │
│ - upsert()         │  │ - projects               │
│ - softDelete()     │  │ - snapshot OKRs (okrs[])│
│ - batchUpsert()    │  │                          │
└────────────────────┘  └──────────────────────────┘
         ↓                    ↓
    ┌────┴──────────────────┬─────────┐
    ↓                       ↓         ↓
[okrs table]       [strategy_data]  [progress_logs]
 (正本)            (snapshot/sync)  (reference)
```

---

## Ⅱ. コンポーネント詳細

### A. Service層: `services/okrService.ts`

#### 主要関数仕様

```typescript
// 1. OKR解決（読込）
async function resolveProjectsWithOkrs(
  projectId: string,
  strategyData: StrategyData
): Promise<ProjectWithResolvedOkrs> {
  // 1. okrs テーブルから該当プロジェクトの OKR を取得
  const dbOkrs = await okrsRepository.queryByProjectId(projectId);

  // 2. strategy_data snapshot から fallback OKR を取得
  const project = strategyData.departments
    .flatMap(d => d.projects)
    .find(p => p.id === projectId);
  const snapshotOkrs = project?.okrs ?? [];

  // 3. Merge（DB優先）
  const resolvedOkrs = mergeOkrSources(dbOkrs, snapshotOkrs);
  // 結果: ResolvedOkr[] with source: 'db' | 'snapshot'

  return {
    ...project,
    resolvedOkrs
  };
}

// 2. OKR保存
async function upsertOkr(
  input: OkrWriteInput,
  projectId: string
): Promise<ResolvedOkr> {
  try {
    // 1. DB保存（正本）
    const okrRow = await okrsRepository.upsert(input);

    // 2. Snapshot同期（実行必須）
    await syncOkrsSnapshotToStrategyData(projectId);

    return { ...okrRow, source: 'db' };
  } catch (error) {
    // ロールバック：snapshot は更新しない
    throw error;
  }
}

// 3. OKR削除（soft delete）
async function deleteOkr(
  okrId: string,
  projectId: string
): Promise<void> {
  try {
    // 1. DB: soft delete
    await okrsRepository.softDelete(okrId);

    // 2. Snapshot同期
    await syncOkrsSnapshotToStrategyData(projectId);
  } catch (error) {
    throw error;
  }
}

// 4. OKR並べ替え
async function reorderOkrs(
  projectId: string,
  orderedIds: string[]
): Promise<void> {
  try {
    // 1. DB: sort_order 更新（batch）
    await okrsRepository.batchUpdateSortOrder(
      orderedIds.map((id, idx) => ({ id, sort_order: idx }))
    );

    // 2. Snapshot同期
    await syncOkrsSnapshotToStrategyData(projectId);
  } catch (error) {
    throw error;
  }
}

// 5. Snapshot同期（内部用）
async function syncOkrsSnapshotToStrategyData(
  projectId: string
): Promise<void> {
  // 1. okrs テーブルから最新の OKR リストを取得
  const dbOkrs = await okrsRepository.queryByProjectId(projectId);

  // 2. strategy_data の該当プロジェクトを特定
  const store = useStrategyStore.getState();
  const project = findProjectById(store.departments, projectId);

  if (!project) return;

  // 3. snapshot 更新（DB内容で上書き）
  const newOkrs = dbOkrs.map(okr => ({
    objective: okr.objective,
    keyResults: okr.key_results_json,
    owner: okr.owner_name,  // ← 命名注意
    id: okr.id
  }));

  // 4. store.setDepartments() で保存
  const updated = updateProjectInStore(store.departments, projectId, {
    okrs: newOkrs
  });

  store.setDepartments(updated);
  // saveStrategyData() は自動 (useAutoSave)
}

// 6. Merge ロジック（統一）
function mergeOkrSources(
  dbOkrs: OkrRow[],
  snapshotOkrs: OKR[]
): ResolvedOkr[] {
  // DB が primary
  const dbMap = new Map(dbOkrs.map(o => [o.id, o]));

  // DB OKR → ResolvedOkr に変換
  const resolved = dbOkrs.map(o => ({
    ...o,
    source: 'db' as const
  }));

  // Snapshot のみの OKR を追加（fallback）
  snapshotOkrs.forEach(snap => {
    if (!dbMap.has(snap.id)) {
      resolved.push({
        id: snap.id || genId(),
        objective: snap.objective,
        key_results_json: snap.keyResults,
        owner_name: snap.owner,
        // ... 他フィールド埋める
        source: 'snapshot' as const
      });
    }
  });

  return resolved;
}
```

### B. Repository層: `utils/supabase/okrsRepository.ts`

```typescript
class OkrsRepository {
  // Query
  async queryByProjectId(projectId: string): Promise<OkrRow[]> {
    const { data, error } = await supabase
      .from('okrs')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }

  async queryByStrategyId(strategyId: string): Promise<OkrRow[]> {
    const { data, error } = await supabase
      .from('okrs')
      .select('*')
      .eq('strategy_id', strategyId)
      .eq('is_deleted', false);

    if (error) throw error;
    return data ?? [];
  }

  // Write
  async upsert(input: OkrWriteInput): Promise<OkrRow> {
    const okrId = input.id || genId();

    const { data, error } = await supabase
      .from('okrs')
      .upsert({
        ...input,
        id: okrId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      })
      .select();

    if (error) throw error;
    return data?.[0] ?? null;
  }

  async softDelete(okrId: string): Promise<void> {
    const { error } = await supabase
      .from('okrs')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', okrId);

    if (error) throw error;
  }

  async batchUpdateSortOrder(
    items: Array<{ id: string; sort_order: number }>
  ): Promise<void> {
    for (const item of items) {
      await supabase
        .from('okrs')
        .update({ sort_order: item.sort_order, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    }
  }
}

export const okrsRepository = new OkrsRepository();
```

---

## Ⅲ. STAGE別の変更内容

### STAGE4（最優先）

#### 現在
```typescript
// 読込: strategy_data から直接
const projects = dept.projects;
const okrs = project.okrs;  // snapshot のみ

// 保存
project.okrs = newOkrs;
setDepartments([...depts]);  // 直接保存
```

#### Phase 2A 後
```typescript
// 読込: okrs テーブル優先
const resolvedOkrs = await resolveProjectsWithOkrs(projectId, strategyData);

// 保存
await upsertOkr(okrInput, projectId);  // okrs テーブル + snapshot 同期
// saveStrategyData() は自動
```

### STAGE5（次優先）

#### 現在
```typescript
// 進捗ログ → OKR 参照（okrId文字列）
const okrId = progressLog.okr_id;  // undefined の場合多い
// fallback: department + project 名から推測
```

#### Phase 2A 後
```typescript
// 進捗ログは okr_id を必須に（段階的）
const okrRow = await okrsRepository.queryById(progressLog.okr_id);
// fallback: 無い場合は text 検索
```

### STAGE3（最後）

#### 現在
```typescript
// 読込: strategy_data のみ
const krs = getProjectKpiLabels(project);

// 保存: okrsV2 + canonical sync
const okrsV2 = [...project.okrsV2];
okrsV2.push(stringToKRStructured(''));
proj = syncProjectKrRepresentations({ ...proj, okrsV2 });
```

#### Phase 2A 後
```typescript
// 読込: resolveProjectsWithOkrs() で統一
const resolvedOkrs = await resolveProjectsWithOkrs(projectId, strategyData);
const krs = resolvedOkrs.map(o => o.objective);

// 保存: OkrService 経由
await upsertOkr(okrInput, projectId);
// canonical sync は Service 層へ移行
```

---

## Ⅳ. 注意点・禁止事項

### 禁止

❌ **各 STAGE で異なる merge ロジック**
```typescript
// STAGE4 で: snapshotOkrs ?? dbOkrs
// STAGE3 で: okrs[0].keyResults ?? okrsV2
→ これらを統一する！
```

❌ **Project owner と KPI owner の混同**
```typescript
// ❌ 間違い
project.owner = okr.owner;

// ✅ 正し
project.ownerName = value;     // Project owner
okr.owner_name = value;        // KPI owner
```

❌ **strategy_data だけ更新**
```typescript
// ❌ 間違い
project.okrs = newOkrs;
setDepartments([...depts]);

// ✅ 正し
await upsertOkr(...);  // okrs テーブル保存
// snapshot 同期は自動
```

### 必須

✅ **常に okrs テーブルを正本として扱う**

✅ **snapshot は fallback / sync ターゲット**

✅ **merge / resolve は Service 層で一元化**

✅ **source フィールドで db / snapshot を区別**

✅ **Soft delete で物理削除しない**

---

## Ⅴ. Migration & Backfill

### 実行順序

```
1. okrs テーブル新設（SQL）
   ↓
2. types/okrs.ts 追加
   ↓
3. OkrsRepository + Service 作成
   ↓
4. Backfill script 実装
   ↓
5. Staging でテスト実行
   ↓
6. 本番 backfill（transaction）
   ↓
7. STAGE4 コード切替
   ↓
8. 運用テスト
```

### Backfill の安全性

**冪等性（Idempotent）:**
```sql
-- 何度実行しても安全
INSERT INTO okrs (...)
SELECT ...
ON CONFLICT (strategy_id, department_id, project_id, id) DO NOTHING;
```

**ロールバック可能:**
```sql
-- 失敗時は DELETE で元に戻す
DELETE FROM okrs
WHERE source_stage = 'migration'
  AND created_at > '2026-03-16T12:00:00'::timestamp;
```

**検証:**
```typescript
// Backfill 前後で件数確認
const before = strategyData.departments
  .flatMap(d => d.projects)
  .flatMap(p => p.okrs ?? []).length;

const after = await okrsRepository.queryByStrategyId(strategyId);

console.assert(before === after.length);
```

---

## Ⅵ. 監視・デバッグ

### Debug API

```typescript
// GET /api/debug/okrs?strategyId=xxx
{
  okrsTableCount: 42,
  strategyDataOkrsCount: 40,  // fallback のみ
  syncStatus: 'ok' | 'drifting',
  recentUpdates: [
    { id, objective, updated_at, source_stage }
  ],
  orphanedOkrs: [  // DB にあるが project が無い
    { id, project_id }
  ]
}
```

### Alert

```typescript
// Backfill 後に不整合を検知
if (dbOkrCount !== snapshotOkrCount) {
  console.warn('OKR count mismatch', {
    dbOkrCount,
    snapshotOkrCount,
    drift: dbOkrCount - snapshotOkrCount
  });
  // → 手動で syncOkrsSnapshotToStrategyData() 実行
}
```

---

**最終確認:** Phase 2A-2 着手前に本設計の 技術 review を実施すること
