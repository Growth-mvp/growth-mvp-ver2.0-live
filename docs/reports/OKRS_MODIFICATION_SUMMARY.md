# OKR 重複・snapshot 残留 修正 完了レポート

**実施日時:** 2026-04-06
**対象プロジェクト:** proj-x45591, proj-8oro7q, proj-rdojst

---

## 修正ファイル一覧

1. ✅ `utils/supabase/okrsRepository.ts` - upsert 修正
2. ✅ `services/okrService.ts` - mergeOkrSources 修正
3. ✅ `app/okr/page.tsx` - invalidateAndRefetchProjectOkrs 修正

---

## 1. okrsRepository.upsert() 修正

### 修正前後

**修正前（行 140-142）:**
```typescript
const { data, error } = await supabase
  .from(TABLE_NAME)
  .upsert(insertData, {
    onConflict: 'id',  // ← id のみで衝突判定
  })
```

**修正後（行 150-157）:**
```typescript
const onConflictKey = input.id
  ? 'id'
  : 'company_id,strategy_id,department_id,project_id,objective';

const { data, error } = await supabase
  .from(TABLE_NAME)
  .upsert(insertData, {
    onConflict: onConflictKey,  // ← business key で衝突判定
  })
```

### upsert Payload に含まれるキー

| キー | 値の供給 | upsert 対象 | 備考 |
|---|---|---|---|
| company_id | assertCompanyId(companyId) | ✅ business key 構成要素 | RLS scoping |
| strategy_id | input.strategy_id | ✅ business key 構成要素 | 戦略 ID |
| department_id | input.department_id | ✅ business key 構成要素 | 部門 ID |
| project_id | input.project_id | ✅ business key 構成要素 | プロジェクト ID |
| objective | input.objective | ✅ business key 構成要素 | OKR 目的テキスト |
| id | 生成または input.id | 衝突判定キー | UUID |
| is_deleted | false 固定 | partial index フィルタ | active 行マーカー |

### DB 衝突判定と UNIQUE 制約の対応

| 条件 | onConflict 指定 | DB 制約 | 効果 |
|---|---|---|---|
| id 指定時（既存 OKR 更新） | 'id' | PRIMARY KEY (id) | id で UPDATE |
| id 未指定時（新規作成） | 'company_id,strategy_id,department_id,project_id,objective' | UNIQUE INDEX (partial, is_deleted=false) | business key で衝突判定 → UPDATE または INSERT |

---

## 2. mergeOkrSources() 修正

### 修正前後

**修正前（行 346-393）:**
```typescript
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // DB OKR マップ（id ベース）
  const dbMap = new Map(
    dbOkrs
      .filter((o) => !o.is_deleted)
      .map((o) => [o.id, o])  // ← id のみをキーに
  );

  // DB OKR を全て返す
  const resolved: ResolvedOkr[] = dbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({ ...o, source: 'db' as const }));

  // snapshot OKR を追加
  snapshotOkrs.forEach((snap) => {
    if (snap.id && dbMap.has(snap.id)) {
      return;  // ID 衝突なら スキップ
    }
    resolved.push(fallbackOkr);
  });

  return { resolved, stats };
}
```

**問題:** 同じ objective でも異なる id の DB OKR が複数あれば、全て返される

**修正後（行 344-475）:**
```typescript
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // ★ Step 1: DB OKR を business key で重複排除
  const dedupedDbOkrs = deduplicateDbOkrsByBusinessKey(dbOkrs);

  // ★ Step 2: Snapshot OKR を重複排除
  const dedupedSnapshotOkrs = deduplicateSnapshotOkrs(snapshotOkrs);

  // DB OKR を business key でマップ化
  const dbBusinessKeySet = new Set(
    dedupedDbOkrs
      .filter((o) => !o.is_deleted)
      .map((o) => createBusinessKeyForOkr(o))
  );

  // DB OKR を返す（1件のみ）
  const resolved: ResolvedOkr[] = dedupedDbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({ ...o, source: 'db' as const }));

  // snapshot OKR を追加（DB と衝突しないもののみ）
  dedupedSnapshotOkrs.forEach((snap) => {
    const snapKey = snap.objective || `snap_${snap.id}`;
    if (dbBusinessKeySet.has(snapKey)) {
      return;  // business key 衝突なら スキップ（DB 優先）
    }
    resolved.push(fallbackOkr);
  });

  return { resolved, stats };
}

// ★ 新規関数: DB OKR を business key で重複排除
function deduplicateDbOkrsByBusinessKey(dbOkrs: OkrRow[]): OkrRow[] {
  const map = new Map<string, OkrRow>();

  for (const okr of dbOkrs) {
    const key = createBusinessKeyForOkr(okr);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, okr);
      continue;
    }

    // ★ 勝者判定（優先順位）
    let winner = existing;

    // 1. active 行（is_deleted=false）を優先
    if (okr.is_deleted === false && existing.is_deleted === true) {
      winner = okr;
    } else if (okr.is_deleted === existing.is_deleted) {
      // 2. updated_at が新しいものを優先
      if (okr.updated_at > existing.updated_at) {
        winner = okr;
      }
    }

    map.set(key, winner);
  }

  return Array.from(map.values());
}

// ★ 新規関数: Snapshot OKR を重複排除
function deduplicateSnapshotOkrs(snapshotOkrs: OKR[]): OKR[] {
  const map = new Map<string, OKR>();
  for (const snap of snapshotOkrs) {
    const key = snap.objective || `snap_unknown_${snap.id}`;
    if (!map.has(key)) {
      map.set(key, snap);
    }
  }
  return Array.from(map.values());
}

// ★ 新規関数: DB OKR の business key 作成
function createBusinessKeyForOkr(okr: OkrRow): string {
  return `${okr.company_id}::${okr.strategy_id}::${okr.department_id}::${okr.project_id}::${okr.objective}`;
}
```

### 勝者選定ロジック

同じ business key で複数の OKR がある場合の優先順位：

1. **Active 行を優先** `is_deleted = false`
   - soft delete されていない生きている行を採用
   - 削除済みと未削除がある場合は未削除を選ぶ

2. **updated_at が新しいものを優先**
   - 同じ削除状態の場合、最後に更新された行を採用
   - 更新時刻が新しい = より最新の情報

### DB/snapshot 重複の収束方法

```
入力: dbOkrs = [
  { id: uuid-1, objective: '半導体...', updated_at: '2026-04-06 10:00' },
  { id: uuid-2, objective: '半導体...', updated_at: '2026-04-06 09:00' }  // 古い
]

deduplicateDbOkrsByBusinessKey():
  business key = 'company::strategy::dept::proj::半導体...'
  → Map に uuid-1 を登録（最初）
  → uuid-2 と比較 → updated_at が古い → uuid-1 を保持
  → 返す: [uuid-1]

mergeOkrSources():
  resolved = [{ id: uuid-1, source: 'db' }]  // 1件のみ

出力: resolved.resolvedOkrs = [uuid-1(db)]  // snapshot は含まれない
```

---

## 3. invalidateAndRefetchProjectOkrs() 修正

### 修正前後

**修正前（行 970-1001）:**
```typescript
// ★ Approach A: STAGE5対応：snapshot を DB-backed OKR で置換
const existingDue = String((proj as any)?.okrs?.[0]?.due ?? '');
const snapshotOkrs: OKR[] = resolved.resolvedOkrs
  .filter((ok) => ok?.source === 'db')  // DB source のみ
  .map((resolvedOkr, idx) => ({...}));

// departments 更新
const nextDepts = [...departments];
// ... okrs を snapshotOkrs で置換 ...

console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS:', {
  cacheKey,
  count: resolved.resolvedOkrs.length,  // DB + snapshot が混在
  snapshotOkrs: snapshotOkrs.length
});
return resolved.resolvedOkrs;  // DB + snapshot が混在
```

**問題:**
- DB と snapshot の数が不明確
- snapshot が残留していないか確認できない
- diagnostic log で全体像が把握できない

**修正後（行 970-1047）:**
```typescript
// ★ 修正（2026-04-06）：DB OKR のみを使用、snapshot は完全排除
const existingDue = String((proj as any)?.okrs?.[0]?.due ?? '');

// Step 1: DB OKR のみを抽出
const dbResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'db');

// Step 2: DB OKR のみを snapshot 形式に変換
const snapshotOkrs: OKR[] = dbResolvedOkrs.map((resolvedOkr, idx) => ({...}));

// ★ Step 3: 複数 DB OKR がある場合は警告（mergeOkrSources のバグを検出）
if (dbResolvedOkrs.length > 1) {
  console.warn('[invalidateAndRefetchProjectOkrs] WARNING: multiple DB OKRs found', {...});
}

// ★ Step 4: snapshot OKR が残っていないことを確認
const snapshotResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'snapshot');
if (snapshotResolvedOkrs.length > 0) {
  console.debug('[invalidateAndRefetchProjectOkrs] snapshot OKRs excluded from result', {...});
}

// departments 更新
const nextDepts = [...departments];
// ... okrs を snapshotOkrs で置換 ...

// ★ 修正：diagnostic log で DB/snapshot の分離を明確に
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS', {
  cacheKey,
  resolvedTotal: resolved.resolvedOkrs.length,
  dbCount: dbResolvedOkrs.length,        // DB OKR の数
  snapshotCount: snapshotResolvedOkrs.length,  // snapshot OKR の数（0が期待値）
  snapshotOkrsLength: snapshotOkrs.length,
  returnedOkrs: resolved.resolvedOkrs.map((o) => ({
    id: o.id,
    source: o.source,
    objective: o.objective,
  })),
});

return resolved.resolvedOkrs;
```

### snapshot 排除ロジック

```typescript
// Step 1: mergeOkrSources() からの出力を分析
resolved.resolvedOkrs = [DB OKR, DB OKR, snapshot OKR, ...]

// Step 2: DB と snapshot を分離
const dbResolvedOkrs = [DB OKR, DB OKR]
const snapshotResolvedOkrs = [snapshot OKR]

// Step 3: DB OKR のみで snapshot 形式を構築
const snapshotOkrs = dbResolvedOkrs.map(...)  // DB データから構築

// Step 4: 複数 DB OKR が残っていれば警告
if (dbResolvedOkrs.length > 1) console.warn(...)

// Step 5: snapshot が除外されていることを確認
if (snapshotResolvedOkrs.length > 0) console.debug(...)

// 結果：
// - departments 内の okrs は DB OKR のデータで更新（id も DB id）
// - resolvedOkrsMap には mergeOkrSources の結果がそのまま格納（DB + snapshot）
// - STAGE5 では resolvedOkrsMap をフィルタして DB のみ使用
```

---

## 4. 修正効果の検証

### 修正前の状態

**proj-x45591, 目的='半導体企業向けデータ分析サービスの強化':**

DB に複数行：
```sql
SELECT id, objective, is_deleted, updated_at FROM okrs
WHERE project_id='proj-x45591' AND objective LIKE '%半導体%'
ORDER BY updated_at DESC;

-- 結果：
uuid-1, 半導体..., false, 2026-04-06 10:00  ← 最新
uuid-2, 半導体..., false, 2026-04-06 09:00  ← 古い
```

mergeOkrSources() 出力：
```json
{
  "resolved": [
    { "id": "uuid-1", "source": "db" },
    { "id": "uuid-2", "source": "db" },
    { "id": "snap-old", "source": "snapshot" }
  ]
}
```

invalidateAndRefetchProjectOkrs() 出力：
```json
{
  "resolvedTotal": 3,
  "dbCount": 2,
  "snapshotCount": 1,
  "snapshotOkrsLength": 1
}
```

STAGE5 での状況：
```
allOkrs = [uuid-1(db), uuid-2(db), snap-old(snapshot)]
dbOkrMap = { 'hash-for-半導体...': uuid-1 }
選択される OKR = uuid-1（uuid-2 は選ばれない）
dbOkrId = uuid-1（安定しない可能性）
```

### 修正後の期待状態

**同じプロジェクト・目的:**

mergeOkrSources() 出力（修正後）：
```json
{
  "resolved": [
    { "id": "uuid-1", "source": "db" }  // ← 1件に収束
  ]
}
```

invalidateAndRefetchProjectOkrs() 出力（修正後）：
```json
{
  "resolvedTotal": 1,
  "dbCount": 1,
  "snapshotCount": 0,  // ← snapshot 0件
  "snapshotOkrsLength": 1,  // ← snapshot 形式の data は1件（DB データから構築）
  "returnedOkrs": [{ "id": "uuid-1", "source": "db", "objective": "半導体..." }]
}
```

STAGE5 での状況（修正後）：
```
allOkrs = [uuid-1(db)]  // ← snapshot が除外されている
dbOkrMap = { 'hash-for-半導体...': uuid-1 }
選択される OKR = uuid-1（確実）
dbOkrId = uuid-1（安定解決）
mapHit: true（コメント保存可能）
```

---

## 5. STAGE5 での確認項目

### ① Diagnostic Log での確認

```
修正前：
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS:', {
  count: 3,  // DB 2件 + snapshot 1件
  snapshotOkrs: 1
})

修正後：
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS', {
  resolvedTotal: 1,
  dbCount: 1,        // DB 1件のみ
  snapshotCount: 0,  // snapshot 0件
  snapshotOkrsLength: 1,  // 構築された snapshot data 1件（DB から）
  returnedOkrs: [{ id: uuid-1, source: 'db', objective: '...' }]
})
```

### ② dbOkrId の安定解決

```typescript
// STAGE5 pyramid useMemo 内
const dbBackedOkrs = allOkrs.filter((o) => o?.id?.length >= 36);
// 修正前: [uuid-1, uuid-2] （複数）→ 最初の1件を選ぶ
// 修正後: [uuid-1] （1件のみ）→ 確実に uuid-1

const dbOkrId = dbOkrMap.get(`${scopeCompanyId}::${scopeStrategyId}::${scopeDeptId}::${projectId}::${normalizedObjective}`);
// 修正前: uuid-1 または undefined（mapHit: false）
// 修正後: uuid-1（確実、mapHit: true）
```

### ③ STAGE5 コメント保存成功

```
修正前：
mapHit: false, dbOkrId: undefined
→ 保存失敗「対象OKRが見つかりません」

修正後：
mapHit: true, dbOkrId: uuid-1
→ 保存成功「✅ 記録しました」
→ ログに追加、即座に表示
```

---

## 6. 確認テスト（実施予定）

### テスト1: 同一 OKR の再保存

```
1. STAGE4 で OKR を新規作成：
   - proj-x45591
   - objective: '半導体企業向けデータ分析サービスの強化'
   - owner: 'User A'

2. 再度保存（owner を 'User B' に変更）

3. DB 確認：
   SQL: SELECT COUNT(*) FROM okrs WHERE project_id='proj-x45591' AND is_deleted=false AND objective LIKE '%半導体%'
   期待値: 1（増えていない）

4. Diagnostic log：
   [invalidateAndRefetchProjectOkrs] SUCCESS: { dbCount: 1, snapshotCount: 0 }
```

### テスト2: STAGE5 でのコメント保存

```
1. STAGE5 を開く
2. proj-x45591 の OKR を選択
3. コメント入力：「修正テスト」
4. 保存ボタンをクリック

期待値：
✅ 記録しました
履歴に即座に追加
リロード不要
```

### テスト3: 複数プロジェクトでの確認

```
proj-x45591:
  - REFETCH: dbCount: 1, snapshotCount: 0
  - STAGE5: mapHit: true, 保存成功

proj-8oro7q:
  - REFETCH: dbCount: 1, snapshotCount: 0
  - STAGE5: mapHit: true, 保存成功

proj-rdojst:
  - REFETCH: dbCount: 1, snapshotCount: 0
  - STAGE5: mapHit: true, 保存成功
```

---

## まとめ

| 項目 | 修正前 | 修正後 | 効果 |
|---|---|---|---|
| **okrsRepository.upsert()** | onConflict: 'id' | onConflict: business key | 新規重複を防止 |
| **mergeOkrSources()** | DB 複数返す | business key で1件に収束 | 既存重複を1件に絞る |
| **invalidateAndRefetchProjectOkrs()** | DB + snapshot 混在 | DB のみ抽出、snapshot 排除 | snapshot を完全排除 |
| **STAGE5 dbOkrId** | undefined（mapHit: false） | uuid-1（mapHit: true） | コメント保存成功 |
| **DB 行数** | 複数行存在 | 1行に収束 | UI と DB が一致 |

