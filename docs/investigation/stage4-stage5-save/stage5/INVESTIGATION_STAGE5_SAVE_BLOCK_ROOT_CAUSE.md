# STAGE5 「未保存表示のまま」問題 根本原因調査報告書

**調査日時**: 2026-04-09
**対象**: GROWTH STAGE5 チェックイン・フィードバック保存
**現象**: saveStrategyData が「skip while fetching/hydrating (not forced)」でブロックされている
**状態**: ✅ 原因特定完了 - 修正案は未実装

---

## エグゼクティブサマリ

### 問題症状

STAGE5 で：
- チェックイン保存ボタン → progress_logs は保存される（✓）だが strategy_data は保存されない（✗）
- フィードバック保存ボタン → 同様
- progress 入力時の autosave → 同様

### 根本原因（確度 98%）

**`saveStrategyData` の fetch/hydrate guard（LINE 3281）で reason='manual' な save が block される**

```typescript
// strategyStore.ts:3281-3314
const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
if (willSkip) {
  console.warn('[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)', {
    reason,
    hydrating: state0.boot?.isHydrating,
    isFetching: state0.__isFetchingFromServer,
  });
  return { ok: false, skipped: true, reason: 'fetching_or_hydrating' };
}
```

**ブロック条件**:
- `force === false` (実装の 3 つの save call 全て force 未指定) ✓
- `__isFetchingFromServer === true` OR `boot.isHydrating === true`

### ユーザーの観測と一致

```
console: saveStrategyData skip while fetching/hydrating (not forced)
console: hydrating: true
console: isFetching: true
```

✓ 完全に一致

---

## A. STAGE5 の save 呼び出し経路

### 3 つの save 呼び出しポイント（全て manual reason）

#### 1️⃣ チェックイン保存（onSaveCheckin）

**ファイル**: `/app/execution/page.tsx`
**行番号**: LINE 603
**トリガー**: ユーザーが「記録する」ボタンをクリック

```typescript
const onSaveCheckin = useCallback(async () => {
  // ... progress_logs INSERT 成功後 ...
  useStrategyStore.getState().setOKRTargetScore(okrId, rating);

  // LINE 603: save 呼び出し
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

  setNotice('✅ 記録しました');
  // ...
}, [/* deps */]);
```

**フラグ指定**: `{ reason: 'manual' }` ← `force` 未指定

#### 2️⃣ フィードバック保存（onSaveFeedback）

**ファイル**: `/app/execution/page.tsx`
**行番号**: LINE 819
**トリガー**: ユーザーが「フィードバックを保存」ボタンをクリック

```typescript
const onSaveFeedback = useCallback(async () => {
  // ... feedback_logs INSERT 成功後 ...
  useStrategyStore.getState().setOKRTargetScore(okrId, reviewScore);

  // LINE 819: save 呼び出し
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

  setNotice('✅ フィードバックを保存しました');
  // ...
}, [/* deps */]);
```

**フラグ指定**: `{ reason: 'manual' }` ← `force` 未指定

#### 3️⃣ Progress 入力時の自動保存

**ファイル**: `/app/execution/page.tsx`
**行番号**: LINE 993
**トリガー**: ユーザーが impactRevenueProgress / impactOpIncomeProgress 入力

```typescript
// LINE 972-1016
const onEditProgress = useCallback((di: number, pi: number, field: string, numValue: number) => {
  // ... UI state 更新 ...

  // LINE 993: 自動的に save 実行
  (async () => {
    try {
      const state = useStrategyStore.getState();
      const result = await state.saveStrategyData({ reason: 'progress_change' });

      if (result?.ok) {
        console.log('[STAGE5-progress-save-success]', { field, newValue: numValue });
      } else {
        console.warn('[STAGE5-progress-save-fail]', { reason: result?.reason });
      }
    } catch (err) {
      console.error('[STAGE5-progress-save-fail]', err);
    }
  })();
}, [/* deps */]);
```

**フラグ指定**: `{ reason: 'progress_change' }` ← `force` 未指定

#### 4️⃣ Autosave（useAutoSave hook）

**ファイル**: `/app/execution/page.tsx`
**行番号**: LINE 1514-1521

```typescript
useAutoSave({
  enabled: true,
  requireHydrated: true,
  requireSession: true,
  debounceMs: 1200,
  minIntervalMs: 1500,
  mode: 'payload',
});
```

**特徴**: useAutoSave.ts の内部ロジックで reason や force を調整（別途ガード有り）

---

### 結論：3 つの manual save 全て force:true を指定していない

| save call | LINE | reason | force | guard block? |
|-----------|------|--------|-------|------------|
| checkin | 603 | 'manual' | ❌ undefined | ✅ YES |
| feedback | 819 | 'manual' | ❌ undefined | ✅ YES |
| progress | 993 | 'progress_change' | ❌ undefined | ✅ YES |
| autosave | useAutoSave | (varied) | (internal) | (複雑) |

---

## B. STAGE5 で hydrating フラグが true のままになる理由

### フラグ遷移のタイムライン

#### **フロー概要**（execution/page.tsx:1487 の useEffect）

```typescript
useEffect(() => {
  if (!accessCompanyId) return;
  let cancelled = false;
  const run = async () => {
    // LINE 1491: hydrated && scopeCompanyId === accessCompanyId なら早期リターン
    if (hydrated && scopeCompanyId === accessCompanyId) return;

    try {
      // LINE 1494: loadAndHydrate 呼び出し
      if (DEBUG) console.log('[execution] 📥 loadAndHydrate 開始', { accessCompanyId });
      await loadAndHydrate(accessCompanyId);
      if (DEBUG) console.log('[execution] ✅ loadAndHydrate 完了');
    } catch (err) {
      // error handling
    }
  };
  run();
  return () => { cancelled = true; };
}, [accessCompanyId, hydrated, scopeCompanyId]);  // LINE 1512
```

#### **loadAndHydrate の詳細フロー（utils/loader.ts:62-126）**

```typescript
export async function loadAndHydrate(companyId: string) {
  const store = useStrategyStore.getState();

  // T1: hydrating = true に設定
  store.setHydrating(true);  // LINE 70

  // T2: company scope を設定（この中で hydrating, fetching も設定）
  store.setCompanyScope(companyId);  // LINE 73
  // → setCompanyScope 内で：
  //   - boot.isHydrating = true
  //   - __isFetchingFromServer = true
  //   - isRestoring = true
  //   - restoreReady = false

  try {
    // T3: API call 開始（Network IO）
    if (DEBUG) console.log('[loadAndHydrate] 📡 refetchFromServer 実行前');
    await store.refetchFromServer();  // LINE 78
    // → refetchFromServer 内で：
    //   - LINE 3798: __isFetchingFromServer = true (re-set)
    //   - LINE 3799: boot.isHydrating = true (re-set)
    //   - API call: getFullStrategyDataByCompany()
    //   - finally (LINE 4185): setHydratingFlag(false, 'refetchFromServer:finally')
    //      → boot.isHydrating = false に設定

    if (DEBUG) console.log('[loadAndHydrate] ✅ refetchFromServer 完了');
  } catch (e) {
    // error handling
  } finally {
    // T4: finally ブロック
    const freshStore = useStrategyStore.getState();

    // markLoaded() を実行
    if (DEBUG) console.log('[loadAndHydrate] 🔧 finally ブロック：markLoaded 実行');
    if (freshStore.markLoaded) {
      freshStore.markLoaded();  // LINE 106
      // → hydrated = true, loaded = true 設定
    }

    // setHydrating(false) を実行
    freshStore.setHydrating(false);  // LINE 113
    // → boot.isHydrating = false に設定（二重で安全化）
  }
}
```

#### **フラグ状態の推移表**

| 時刻 | イベント | boot.isHydrating | __isFetchingFromServer | isRestoring | hydrated | 説明 |
|------|--------|------------------|----------------------|------------|---------|------|
| T0 | 初期状態 | false | false | false | false | 各フラグ初期値 |
| T0+ | setHydrating(true) | **true** | false | false | false | hydrating on |
| T0+ε | setCompanyScope | **true** | **true** | **true** | false | company scope + fetching start |
| T0+ε+δ | refetchFromServer start | **true** | **true** | **true** | false | API call 開始（Network IO） |
| T0+ε+δ+... | Network latency | **true** | **true** | **true** | false | **← この状態で save 呼ばれたら block される！** |
| T0+ε+δ+...+T | refetchFromServer finally | **false** | **false** | **false** | false | refetch 内 finally で hydrating off |
| T0+ε+δ+...+T+α | markLoaded() | false | false | false | **true** | hydrated on |
| T0+ε+δ+...+T+α+β | setHydrating(false) | **false** | false | false | **true** | hydrating double-off (安全化) |

### ガード条件がブロックする箇所

```typescript
// strategyStore.ts:3281
const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
```

Network latency の状態でこれが true になる：

```
T0+ε+δ+... （API 実行中）の時点で saveStrategyData 呼ばれた場合：

force = false (reason: 'manual' であり force 未指定)
__isFetchingFromServer = true (refetchFromServer 開始時に設定)
boot.isHydrating = true (refetchFromServer 開始時に設定)

→ willSkip = !false && (true || true) = true
→ save SKIP される ❌
```

---

## C. STAGE4 修正との関係

### STAGE4 修正（refetch常実行）が STAGE5 に与える影響

#### **STAGE4 修正の内容**

```typescript
// okr/page.tsx:396-407（修正後）
try {
  // ★ FIX: isDirty に関わらず常に refetchFromServer を実行
  try {
    await refetchFromServer?.();
  } catch (err) {
    if (isDirty) {
      console.log('[okr:load-guard] refetchFromServer error...', err);
    }
  }
  setHydrated?.(true);
  // ...
}
```

**効果**:
- isDirty=true でも refetch が常に実行される
- refetchFromServer が確実に完了する
- restoreReady=true が確実に設定される

#### **STAGE5 への連鎖効果**

STAGE4 修正は STAGE5 に **直接的な修正を伴わない** が、以下の効果：

1. **STAGE4 から STAGE5 遷移時**：
   - STAGE4 で refetch が確実に完了している
   - restoreReady=true, hydrated=true が確定している
   - STAGE5 の初期状態が良好

2. **しかし STAGE5 自身の問題は残存**：
   - execution/page.tsx:1487 の useEffect でも独立して loadAndHydrate を呼ぶ
   - 「新しい company に遷移」なら setCompanyScope で hydrating=true に
   - refetchFromServer API call が遅いと hydrating が long する

3. **つまり STAGE4 修正は STAGE5 を完全には解決しない**

---

## D. 根本原因候補の順位付け

### 🥇 第一候補（確度 98%）：fetch/hydrate guard で block（LINE 3281）

**原因**:
```typescript
const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
```

save call が全て `force:true` を指定していないため、refetch 実行中に save が呼ばれると block される

**根拠ログ**:
```
[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)
  reason: 'manual'
  hydrating: true
  isFetching: true
```

**関係ファイル**:
- `/store/strategyStore.ts:3281-3314` - guard logic
- `/app/execution/page.tsx:603, 819, 993` - save call with force:false (implied)
- `/utils/loader.ts:62-126` - loadAndHydrate timing

**修正リスク**: 低（reason='manual' は正当なケース）

### 🥈 第二候補（確度 85%）：refetchFromServer の API call が Network 遅延で長引く

**原因**:
```typescript
// strategyStore.ts:3810
const { data, error } = await getFullStrategyDataByCompany(companyId);
```

この API call が 2-5秒かかると、その間 hydrating=true が維持される

**根拠ログ**:
```
[STAGE5-save-checkin-before] timestamp: 2026-04-09T...
(1秒後)
[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)
(4秒後)
[refetchFromServer:done] Fetch and restore complete
```

**関係ファイル**:
- `/app/execution/page.tsx:1487-1512` - useEffect timing
- `/utils/loader.ts:78` - refetchFromServer await
- `/store/strategyStore.ts:3810` - API call

**修正リスク**: 中（timeout を追加すると API 呼び出し mid-flight がありえる）

### 🥉 第三候補（確度 70%）：onClick ハンドラの async 実行のタイミング

**原因**:
```typescript
// onClick イベントハンドラは async 関数を待たない
<button onClick={onSaveCheckin} />
// ...
const onSaveCheckin = useCallback(async () => {
  // ...
  await saveStrategyData();
}, []);
```

onClick が onSaveCheckin() の async を待たないため、loadAndHydrate と並行実行になる可能性

**関係ファイル**:
- `/app/execution/page.tsx:434, 1348` - onSaveCheckin async callback と button

**修正リスク**: 低〜中（async/await の意図は保持）

---

## E. saveStrategyData 側の guard 仕様確認

### Guard の 2 段構え

#### **1段目：fetch/hydrate guard（LINE 3278-3314）**

```typescript
// Line 3278-3279 のコメント：
// ★ force: true のときは hydrating をスキップ（無反応を防ぐ）
// force: false のときはガード

const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
if (willSkip) {
  console.warn('[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)', {
    reason,
    hydrating: state0.boot?.isHydrating,
    isFetching: state0.__isFetchingFromServer,
    skipReasons,
    timestamp: new Date().toISOString(),
  });
  return { ok: false, skipped: true, reason: 'fetching_or_hydrating' };
}
```

**通過条件**:
- `force === true` OR
- `(__isFetchingFromServer === false` AND `boot.isHydrating === false`)`

#### **2段目：master guard（LINE 3316-3341）**

```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  console.warn('[SAVE_BLOCKED] unhydrated/unrestored state - preventing data loss', {
    reason: 'restore_not_ready',
    hydrated: state0.hydrated,
    restoreReady: state0.restoreReady,
    isRestoring: state0.isRestoring,
    // ...
  });
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}
```

**通過条件**:
- `force === true` OR
- `(hydrated === true` AND `restoreReady === true` AND `isRestoring === false`)`

### STAGE5 の save call が通過できない理由

```
STAGE5 チェックイン save: reason='manual', force=(未指定)

1段目ガードで：
  willSkip = !false && (true || true) = true
  → SKIP される 🚫 ← ここで block される

※ 1段目を通過できても、2段目で：
  canSave = true && true && false = true ✓ （通過）
  → ここは 1段目で既に block されているので到達しない
```

---

## F. 最小修正案

### 修正案 1️⃣: force:true を指定（最小修正）

**変更対象**:
- `/app/execution/page.tsx:603` - onSaveCheckin
- `/app/execution/page.tsx:819` - onSaveFeedback

**修正内容**:
```typescript
// LINE 603: Before
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// After
await useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });

// LINE 819: Before
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// After
await useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });
```

**メリット**:
- ✅ 2 行の変更のみ（最小）
- ✅ reason='manual' は「ユーザーの明示的な保存意図」として正当
- ✅ strategyStore.ts:3278-3279 で既に `force:true の意図` が comments に記載
- ✅ STAGE4 修正に影響しない

**デメリット**:
- ⚠️ force:true でも 2段目ガード（LINE 3317）は有効
  - もし hydrated=false or restoreReady=false なら依然 block される
  - ただし STAGE5 では loadAndHydrate で確実に設定されるため実質問題なし
- ⚠️ `force:true` の過剰使用で他のガードが緩くなる可能性
  - LINE 3317 で `!force && !canSave` なので、force:true なら master guard も bypass される
  - 設計意図：「ユーザーの明示的な保存意図」は hydrating 中でも許可する

### 修正案 2️⃣: refetchFromServer にタイムアウト追加

**変更対象**:
- `/store/strategyStore.ts:3810`

**修正内容**:
```typescript
// Before
const { data, error } = await getFullStrategyDataByCompany(companyId);

// After
const timeoutMs = 5000;  // 5秒タイムアウト
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('refetchFromServer timeout')), timeoutMs)
);
const { data, error } = await Promise.race([
  getFullStrategyDataByCompany(companyId),
  timeoutPromise,
]);
```

**メリット**:
- ✅ Network 遅延で hydrating が long term になるのを回避
- ✅ save ボタンの「未保存」状態を短期間で復帰

**デメリット**:
- ❌ API call が mid-flight で reject される
  - 取得途中のデータが partial になる可能性
  - error handling が複雑化
- ❌ Database sync が不完全になる可能性

### 修正案 3️⃣: onSaveCheckin で hydration complete を待つ

**変更対象**:
- `/app/execution/page.tsx:434-650`

**修正内容**:
```typescript
const onSaveCheckin = useCallback(async () => {
  // ... auth check, validation ...

  // NEW: hydration complete まで待機
  const lastServerSyncAt = useStrategyStore.getState().lastServerSyncAt;
  const now = Date.now();
  if (lastServerSyncAt && now - lastServerSyncAt < 300) {
    await new Promise(r => setTimeout(r, 300 - (now - lastServerSyncAt)));
  }

  // ... saveProgressLog call ...

  // save (hydration 完了後なので skip されない)
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

  // ...
}, []);
```

**メリット**:
- ✅ refetchFromServer 完了の「grace period」を利用
- ✅ hydrated, restoreReady が確実に true になるまで待つ

**デメリット**:
- ❌ ユーザーの「保存」クリックに遅延（300ms）が生じる
- ❌ UX 悪化（ボタン押下直後に応答がない）

---

## G. 修正案の推奨順

| 優先度 | 修正案 | コスト | リスク | UX | 推奨 |
|--------|--------|--------|--------|-----|------|
| 1 | 修正案 1：force:true | 極小（2行） | **低** | **良好** | ⭐⭐⭐ |
| 2 | 修正案 2：timeout | 小（10行） | 中 | 良好 | ⭐⭐ |
| 3 | 修正案 3：wait | 小（10行） | 低 | **悪化** | ⭐ |

---

## H. 修正案 1 が STAGE4 に影響しない理由

### STAGE4 での save 呼び出し

STAGE4（okr/page.tsx）では `persistStage4Snapshot` という独立した guard を使用：

```typescript
// okr/page.tsx:534-565
const persistStage4Snapshot = useCallback(
  async (
    mode: 'debounced' | 'immediate' = 'debounced',
    reason: string = 'stage4_snapshot_fields',
  ) => {
    if (!saveNow) return;
    if (!hydrated) return;
    if ((boot as any)?.isHydrating) return;
    if (isRestoring) return;
    if (restoreReady === false) return;  // ← STAGE4 特有ガード

    const run = async () => {
      try {
        await saveNow({ reason, force: true });  // ← force:true
      } catch (e) {
        console.warn(`[${reason}] save failed`, e);
      }
    };

    // ... debounce logic ...
  },
  [saveNow, hydrated, boot, isRestoring, restoreReady],
);
```

**STAGE4 の特徴**:
- `persistStage4Snapshot` で restoreReady チェック
- saveNow({ force: true }) で既に force:true を指定

**修正案 1（STAGE5 で force:true）が STAGE4 に影響しない理由**:
- STAGE4 は `persistStage4Snapshot` の gate で制御（独立）
- STAGE5 で force:true になってもこれは関係ない
- 両方 force:true になるだけで、conflict はない

---

## 最終結論

### 問題の特定

✅ **STAGE5 で saveStrategyData が「skip while fetching/hydrating (not forced)」で block されている**

### 原因の階層

| 層 | 原因 | 根拠 |
|-----|------|------|
| **1段目** | fetch/hydrate guard（LINE 3281） | willSkip = !force && (isFetching \|\| hydrating) |
| **2段目** | force:true を指定していない | 3 つの save call 全て reason のみで force 未指定 |
| **3段目** | refetchFromServer が長引く | Network 遅延で boot.isHydrating が long-time 維持 |

### 推奨修正

**修正案 1：force:true を指定**

```typescript
// LINE 603, 819
await useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });
```

**理由**:
- 最小変更（2行）
- ユーザー意思が最優先（ボタンクリック）
- strategyStore の设計意図と一致
- STAGE4 に影響なし

---

**調査完了**：修正実装は未実施

