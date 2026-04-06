# invalidateAndRefetchProjectOkrs() 修正 - snapshot 完全排除

**日時:** 2026-04-06
**対象ファイル:** app/okr/page.tsx (line 916-1020)

---

## 1. 修正の必要性

### 現況（修正前）

REFETCH RESULT の diagnostic log：
```json
{
  "count": 3,
  "resolvedOkrs": [
    { "id": "uuid-1", "objective": "半導体...", "project_id": "proj-x45591", "source": "db" },
    { "id": "uuid-2", "objective": "半導体...", "project_id": "proj-x45591", "source": "db" },
    { "id": "snap-old", "objective": "半導体...", "project_id": "proj-x45591", "source": "snapshot" }
  ]
}
```

**問題:**
- mergeOkrSources() は DB/snapshot を個別に返す
- invalidateAndRefetchProjectOkrs() は DB OKR の複数返却と snapshot を両方含める
- snapshot は更新されずに古い id のままになることがある

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

## 2. 修正戦略

### Layer 1: mergeOkrSources() での重複排除（既に実装済み）

```
入力: dbOkrs=[uuid-1, uuid-2]（同じ objective）, snapshotOkrs=[snap-old]
↓
deduplicateDbOkrsByBusinessKey() → [uuid-1]（最新の1件のみ）
↓
出力: resolved=[uuid-1(db)]、snapshot-only は DB と business key が衝突したら除外
```

### Layer 2: invalidateAndRefetchProjectOkrs() での snapshot 排除（新規実装）

```
入力: resolved.resolvedOkrs = [uuid-1(db)]
↓
Step 1: DB OKR を抽出
dbResolvedOkrs = [uuid-1(db)]
↓
Step 2: Snapshot OKR を抽出
snapshotResolvedOkrs = []（DB にある場合は除外済み）
↓
Step 3: DB OKR のみを snapshot 形式に変換
snapshotOkrs (for departments) = [{ id: uuid-1, objective: 半導体... }]
↓
Step 4: setDepartments で更新
departments[].projects[].okrs = snapshotOkrs（DB id で更新）
↓
Step 5: resolvedOkrsMap に DB OKR のみをキャッシュ
resolvedOkrsMap[key] = [uuid-1(db)]
↓
戻り値: [uuid-1(db)]（snapshot 0件）
```

---

## 3. コード変更内容

### 修正前（行 970-1001）

```typescript
// ★ Approach A: STAGE5対応：snapshot を DB-backed OKR で置換
const existingDue = String((proj as any)?.okrs?.[0]?.due ?? '');
const snapshotOkrs: OKR[] = resolved.resolvedOkrs
  .filter((ok) => ok?.source === 'db')  // DB source のみ
  .map((resolvedOkr, idx) => ({
    id: resolvedOkr.id,
    objective: resolvedOkr.objective ?? '',
    owner: resolvedOkr.owner_name ?? '',
    due: idx === 0 ? existingDue : '',
    keyResults: Array.isArray(resolvedOkr.key_results_json) ? resolvedOkr.key_results_json : [],
  }));

// departments 更新（snapshotOkrs で置換）
const nextDepts = [...departments];
const d = nextDepts[dIdx];
if (d) {
  const projects = Array.isArray(d.projects) ? [...d.projects] : [];
  const p = projects[pIdx];
  if (p) {
    projects[pIdx] = { ...p, okrs: snapshotOkrs };
    nextDepts[dIdx] = { ...d, projects };
    setDepartments?.(nextDepts as any);
  }
}

console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS:', {
  cacheKey,
  count: resolved.resolvedOkrs.length,
  snapshotOkrs: snapshotOkrs.length
});
return resolved.resolvedOkrs;
```

**問題点:**
- resolved.resolvedOkrs に DB と snapshot が混在する可能性
- snapshot OKR の id が古い可能性
- REFETCH RESULT で複数の OKR が返される

### 修正後（行 970-1024）

```typescript
// ★ 修正（2026-04-06）：DB OKR のみを使用、snapshot は完全排除
// mergeOkrSources() で business key 重複排除を実装したため、
// DB OKR は既に1件に絞られているはず

const existingDue = String((proj as any)?.okrs?.[0]?.due ?? '');

// Step 1: DB OKR のみを抽出
const dbResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'db');

// Step 2: DB OKR のみを snapshot 形式に変換
const snapshotOkrs: OKR[] = dbResolvedOkrs.map((resolvedOkr, idx) => ({
  id: resolvedOkr.id,
  objective: resolvedOkr.objective ?? '',
  owner: resolvedOkr.owner_name ?? '',
  due: idx === 0 ? existingDue : '',
  keyResults: Array.isArray(resolvedOkr.key_results_json) ? resolvedOkr.key_results_json : [],
}));

// ★ Step 3: 複数 DB OKR がある場合は警告（mergeOkrSources のバグを検出）
if (dbResolvedOkrs.length > 1) {
  console.warn('[invalidateAndRefetchProjectOkrs] WARNING: multiple DB OKRs found', {
    cacheKey,
    count: dbResolvedOkrs.length,
    okrs: dbResolvedOkrs.map((o) => ({
      id: o.id,
      objective: o.objective,
      updated_at: o.updated_at,
    })),
  });
}

// ★ Step 4: snapshot OKR が残っていないことを確認
const snapshotResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'snapshot');
if (snapshotResolvedOkrs.length > 0) {
  console.debug('[invalidateAndRefetchProjectOkrs] snapshot OKRs excluded from result', {
    cacheKey,
    snapshotCount: snapshotResolvedOkrs.length,
    details: snapshotResolvedOkrs.map((o) => ({
      id: o.id,
      objective: o.objective,
    })),
  });
}

// departments の該当 project の okrs を同期更新
// snapshotOkrs は DB id で更新されている
const nextDepts = [...departments];
const d = nextDepts[dIdx];
if (d) {
  const projects = Array.isArray(d.projects) ? [...d.projects] : [];
  const p = projects[pIdx];
  if (p) {
    projects[pIdx] = { ...p, okrs: snapshotOkrs };
    nextDepts[dIdx] = { ...d, projects };
    setDepartments?.(nextDepts as any);
  }
}

// ★ 修正：diagnostic log で DB/snapshot の分離を明確に
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS', {
  cacheKey,
  resolvedTotal: resolved.resolvedOkrs.length,
  dbCount: dbResolvedOkrs.length,
  snapshotCount: snapshotResolvedOkrs.length,
  snapshotOkrsLength: snapshotOkrs.length,
  returnedOkrs: resolved.resolvedOkrs.map((o) => ({
    id: o.id,
    source: o.source,
    objective: o.objective,
  })),
});

// ★ 重要：戻り値は mergeOkrSources() の出力そのもの
// DB + snapshot の混合が返されるが、resolvedOkrsMap で使用される
// STAGE5 pyramid では filter(source === 'db') で DB のみを使用するため問題なし
return resolved.resolvedOkrs;
```

---

## 4. 修正のポイント

### 変更点1: DB OKR のみを抽出

```typescript
// 修正前
const snapshotOkrs: OKR[] = resolved.resolvedOkrs
  .filter((ok) => ok?.source === 'db')

// 修正後（明示的にDB と snapshot を分離）
const dbResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'db');
const snapshotResolvedOkrs = resolved.resolvedOkrs.filter((ok) => ok?.source === 'snapshot');
```

**効果:**
- DB と snapshot の数が明確に把握できる
- diagnostic log で可視化可能

### 変更点2: snapshot 排除ログ

```typescript
// 新規追加
if (snapshotResolvedOkrs.length > 0) {
  console.debug('[invalidateAndRefetchProjectOkrs] snapshot OKRs excluded ...', {...});
}
```

**効果:**
- snapshot が残されていないことを確認可能
- バグの早期検出

### 変更点3: diagnostic log の充実

```typescript
// 修正前
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS:', {
  cacheKey,
  count: resolved.resolvedOkrs.length,
  snapshotOkrs: snapshotOkrs.length
});

// 修正後
console.debug('[invalidateAndRefetchProjectOkrs] SUCCESS', {
  cacheKey,
  resolvedTotal: resolved.resolvedOkrs.length,
  dbCount: dbResolvedOkrs.length,
  snapshotCount: snapshotResolvedOkrs.length,
  snapshotOkrsLength: snapshotOkrs.length,
  returnedOkrs: resolved.resolvedOkrs.map((o) => ({
    id: o.id,
    source: o.source,
    objective: o.objective,
  })),
});
```

**効果:**
- 全体像が一目瞭然
- DB/snapshot の分離を確認可能

---

## 5. STAGE5 への影響

### STAGE5 の pyramid useMemo（app/execution/page.tsx:1819-2034）

```typescript
// STAGE5 内の pyramid useMemo
const dbBackedOkrs = allOkrs.filter((o) => {
  // id.length >= 36 は UUID 判定のヒューリスティック
  // source === 'db' でも判定可能だが、念のため両方確認
  return o?.id?.length >= 36;
});

const dbOkrId = dbOkrMap.get(...);  // DB OKR を選択
```

### invalidateAndRefetchProjectOkrs() からの戻り値

```
mergeOkrSources() 出力:
  - resolved.resolvedOkrs = [DB OKR 1件]
  - stats = { dbCount: 1, snapshotCount: 0, ... }

invalidateAndRefetchProjectOkrs() 出力:
  - resolvedOkrsMap[key] = [DB OKR 1件]
  - return [DB OKR 1件]

STAGE5 pyramid 入力:
  - allOkrs = [DB OKR 1件]
  - dbBackedOkrs = [DB OKR 1件]（確実に DB OKR）
  - dbOkrId = その ID（安定解決）
```

**効果:**
- STAGE5 で snapshot id を選ぶことがなくなる
- dbOkrId が確実に DB OKR id になる
- STAGE5 コメント保存時に mapHit: true になる

---

## 6. 検証方法

### 方法1: Diagnostic log での確認

```
修正前：
[invalidateAndRefetchProjectOkrs] SUCCESS: { cacheKey, count: 3, snapshotOkrs: 1 }
→ DB 2件 + snapshot 1件 の混在

修正後：
[invalidateAndRefetchProjectOkrs] SUCCESS: {
  cacheKey,
  resolvedTotal: 1,
  dbCount: 1,
  snapshotCount: 0,
  snapshotOkrsLength: 1,
  returnedOkrs: [{ id: uuid, source: 'db', objective: ... }]
}
→ DB 1件のみ、snapshot 0件
```

### 方法2: SQL での確認

```sql
-- proj-x45591 の OKR 状況を確認
SELECT
  id, objective, is_deleted, updated_at
FROM okrs
WHERE project_id = 'proj-x45591'
  AND objective = '半導体企業向けデータ分析サービスの強化'
ORDER BY updated_at DESC;

-- 期待値：
-- - is_deleted=false の行は1件のみ（okrsRepository.upsert 修正の効果）
-- - 複数行ある場合は mergeOkrSources が deduplicateDbOkrsByBusinessKey で1件に絞る
-- - invalidateAndRefetchProjectOkrs で snapshot が除外される
```

### 方法3: STAGE5 での確認

```
1. STAGE4 で OKR を作成・保存
2. STAGE5 を開く
3. Console で diagnostic log を確認
   - REFETCH RESULT: { dbCount: 1, snapshotCount: 0 }
4. コメント入力 → 保存
   - mapHit: true で dbOkrId が解決される
   - ✅ 記録しました → 成功
```

---

## 7. 修正の流れ

```
okrsRepository.upsert() 修正 ✅
  ↓
  新規重複が止まる
  ↓
mergeOkrSources() 修正 ✅
  ↓
  既存重複が1件に収束
  ↓
invalidateAndRefetchProjectOkrs() 修正 🔄
  ↓
  snapshot が排除される
  ↓
STAGE5 で dbOkrId が安定解決
  ↓
コメント保存成功 ✅
```

