# mergeOkrSources() 修正 - business key ベース重複収束

**日時:** 2026-04-06
**対象ファイル:** services/okrService.ts (line 344-404)

---

## 1. 修正の必要性

### 現況

診断ログで REFETCH RESULT：
```json
{
  "count": 2,
  "resolvedOkrs": [
    { "id": "uuid-1", "objective": "半導体...", "project_id": "proj-x45591", "source": "db" },
    { "id": "uuid-2", "objective": "半導体...", "project_id": "proj-x45591", "source": "db" }
  ]
}
```

**問題:**
- 同じ objective でも異なる id の DB OKR が複数返されている
- mergeOkrSources() は id ベースの重複排除のみ行う
- business key ベースの重複判定がない

### 修正後の期待値

```json
{
  "count": 1,
  "resolvedOkrs": [
    { "id": "uuid-1", "objective": "半導体...", "project_id": "proj-x45591", "source": "db" }
  ]
}
```

---

## 2. 修正前の実装

### mergeOkrSources() (line 344-404)

```typescript
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // DB OKR マップ（is_deleted = false のみを有効）
  const dbMap = new Map(
    dbOkrs
      .filter((o) => !o.is_deleted)
      .map((o) => [o.id, o])  // ← id のみをキーにしている
  );

  // DB OKR を抽出
  const resolved: ResolvedOkr[] = dbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({ ...o, source: 'db' as const }));

  // snapshot-only OKR を追加
  snapshotOkrs.forEach((snap) => {
    if (snap.id && dbMap.has(snap.id)) {
      return;  // DB に同じ id がある → スキップ
    }
    // snapshot-only OKR を追加
    resolved.push(fallbackOkr);
  });

  return { resolved, stats };
}
```

**問題:**
- dbOkrs に `{ id: uuid-1, objective: '半導体...' }` と `{ id: uuid-2, objective: '半導体...' }` が両方あれば、両方とも resolved に入る
- business key での重複判定がない
- snapshot との優先順位も ID ベース

---

## 3. 修正後の実装設計

### 修正方針

```typescript
export function mergeOkrSources(dbOkrs: OkrRow[], snapshotOkrs: OKR[]): OkrMergeResult {
  // Step 1: DB OKR を business key で重複排除
  const dedupedDbOkrs = deduplicateDbOkrsByBusinessKey(dbOkrs);

  // Step 2: Snapshot OKR を business key で重複排除
  const dedupedSnapshotOkrs = deduplicateSnapshotByBusinessKey(snapshotOkrs);

  // Step 3: DB OKR を抽出
  const dbMap = new Map(
    dedupedDbOkrs
      .filter((o) => !o.is_deleted)
      .map((o) => createBusinessKey(o))  // ← business key をマップキーに
  );

  const resolved: ResolvedOkr[] = dedupedDbOkrs
    .filter((o) => !o.is_deleted)
    .map((o) => ({ ...o, source: 'db' as const }));

  // Step 4: Snapshot OKR を追加（DB にないもののみ）
  dedupedSnapshotOkrs.forEach((snap) => {
    const snapKey = createSnapshotBusinessKey(snap);
    if (dbMap.has(snapKey)) {
      return;  // DB に同じ business key がある → スキップ（DB 優先）
    }
    resolved.push(fallbackOkr);
  });

  return { resolved, stats };
}

/**
 * DB OKR を business key で重複排除
 * 同じキーの複数行がある場合：
 *   1. DB source を優先（当たり前だが明示）
 *   2. active 行（is_deleted=false）を優先
 *   3. updated_at が新しいものを優先
 */
function deduplicateDbOkrsByBusinessKey(dbOkrs: OkrRow[]): OkrRow[] {
  const map = new Map<string, OkrRow>();

  for (const okr of dbOkrs) {
    const key = createBusinessKey(okr);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, okr);
      continue;
    }

    // ★ 勝者判定ロジック
    let winner = existing;

    // 1. active 行を優先
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

/**
 * Snapshot OKR を business key で重複排除
 * snapshot 側での重複は稀だが、念のため実装
 */
function deduplicateSnapshotByBusinessKey(snapshotOkrs: OKR[]): OKR[] {
  // snapshot は project_id が不詳な場合があるため、単純に objective だけで重複排除
  const map = new Map<string, OKR>();
  for (const snap of snapshotOkrs) {
    const key = snap.objective || `unknown_${snap.id}`;
    if (!map.has(key)) {
      map.set(key, snap);
    }
  }
  return Array.from(map.values());
}

/**
 * DB OKR の business key を作成
 */
function createBusinessKey(okr: OkrRow): string {
  return `${okr.company_id}::${okr.strategy_id}::${okr.department_id}::${okr.project_id}::${okr.objective}`;
}

/**
 * Snapshot OKR の business key を作成
 * snapshot は project_id が詳細でない可能性があるため、objective のみ
 */
function createSnapshotBusinessKey(snap: OKR): string {
  return snap.objective || `unknown_${snap.id}`;
}
```

---

## 4. 勝者選定ロジック

### DB OKR 内の重複排除

同じ business key の複数 DB OKR がある場合：

| 優先順位 | 判定基準 | 例 |
|---|---|---|
| 1 | active 行（is_deleted=false）を優先 | 行A: is_deleted=false, 行B: is_deleted=true → 行A を採用 |
| 2 | updated_at が新しいものを優先 | 行A: updated_at='2026-04-06 10:00', 行B: updated_at='2026-04-06 09:00' → 行A を採用 |

### DB と Snapshot の重複排除

同じ business key で DB OKR と snapshot OKR が両方ある場合：

| 優先順位 | 判定基準 |
|---|---|
| 1 | DB OKR を常に優先（snapshot は追加しない） |

---

## 5. コード変更箇所

### 追加する関数

1. `deduplicateDbOkrsByBusinessKey(dbOkrs: OkrRow[]): OkrRow[]`
   - DB OKR を business key で重複排除
   - 勝者判定ロジックを含む

2. `deduplicateSnapshotByBusinessKey(snapshotOkrs: OKR[]): OKR[]`
   - Snapshot OKR を business key で重複排除（念のため）

3. `createBusinessKey(okr: OkrRow): string`
   - DB OKR の business key 作成

4. `createSnapshotBusinessKey(snap: OKR): string`
   - Snapshot OKR の business key 作成

### 修正する関数

- `mergeOkrSources()`
  - Step 1: `deduplicateDbOkrsByBusinessKey()` を呼び出し
  - Step 2: `deduplicateSnapshotByBusinessKey()` を呼び出し
  - Step 3-4: 既存ロジックはそのまま（重複排除後の DB/snapshot マップが変わるだけ）

---

## 6. 効果の検証

### Before

```sql
SELECT id, objective, project_id, is_deleted, updated_at
FROM okrs
WHERE project_id = 'proj-x45591'
  AND objective = '半導体企業向けデータ分析サービスの強化'
ORDER BY updated_at DESC;

-- 結果：
--   uuid-1, 半導体..., proj-x45591, false, 2026-04-06 10:00
--   uuid-2, 半導体..., proj-x45591, false, 2026-04-06 09:00
```

mergeOkrSources() の出力：
```json
{
  "resolved": [
    { "id": "uuid-1", ..., "source": "db" },
    { "id": "uuid-2", ..., "source": "db" }
  ],
  "stats": { "mergedCount": 2, "snapshotOnlyCount": 0 }
}
```

### After

同じ DB query（行は変わらない、DB の重複は別の整理が必要）

mergeOkrSources() の出力（修正後）：
```json
{
  "resolved": [
    { "id": "uuid-1", ..., "source": "db" }
  ],
  "stats": { "mergedCount": 1, "snapshotOnlyCount": 0 }
}
```

**mergeOkrSources() だけで重複を1件に絞る**

---

## 7. 次のステップ

1. ✅ okrsRepository.upsert() を修正（business key で新規重複防止）
2. 🔄 mergeOkrSources() を修正（business key で既存重複を1件に収束）
3. 🔄 invalidateAndRefetchProjectOkrs() を修正（snapshot を排除）
4. 🔄 STAGE5 で保存成功確認

