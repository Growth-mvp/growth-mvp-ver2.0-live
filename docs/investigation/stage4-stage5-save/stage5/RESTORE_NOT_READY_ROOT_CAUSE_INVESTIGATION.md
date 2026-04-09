# restore_not_ready 根本原因調査

**調査日**: 2026-04-09
**現象**: STAGE5 で saveStrategyData が ok=false, reason="restore_not_ready" を返す
**直接原因**: saveStrategyData の master guard で ブロック

```typescript
// strategyStore.ts:3318
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}
```

restoreReady=false（または hydrated=false または isRestoring=true）になっている。

---

## A. restoreReady が true になるべき経路

### 1. STAGE5 初期化フロー

```
execution/page.tsx:1543 useEffect 実行
  ↓
accessCompanyId が存在する & hydrated=false & scopeCompanyId !== accessCompanyId
  ↓
loadAndHydrate(accessCompanyId) 呼び出し（utils/loader.ts:62）
  ↓
  1. setHydrating(true) - hydrating を on（LINE 70）
  2. setCompanyScope(accessCompanyId) - company 切替（LINE 73）
     → restoreReady: false, isRestoring: true, __isFetchingFromServer: true に設定
  3. refetchFromServer() 実行（LINE 78）
     ↓
     3a. 認証チェック（LINE 3766-3785）
     3b. API call: getFullStrategyDataByCompany(companyId)（LINE 3810）
     3c. エラー処理（LINE 3849-3882）
         → エラーなら restoreReady: false のまま
         → 成功なら 3d へ
     3d. データ正規化・merge（LINE 3909-4050 or 4100-4130）
         → restoreReady: true に設定（LINE 4060 or 4130）
     3e. setHydrated() 実行（LINE 4053 or 4140）
  4. markLoaded()（loader.ts:106）
     → hydrated: true, loaded: true
  5. setHydrating(false)（loader.ts:113）
     → boot.isHydrating: false
  ↓
restore 完了
restoreReady: true, hydrated: true, isRestoring: false, __isFetchingFromServer: false
  ↓
save 可能
```

---

## B. restoreReady が false のままになる理由（3つの候補）

### 🔴 第一候補（確度 85%）：refetchFromServer が失敗している

**根拠:**
- `[refetchFromServer:error] ❌ Data fetch failed` ログが出ている
- API call が失敗（401, 404, 500, network error など）
- restoreReady: false のまま（LINE 3873）
- throw される → loadAndHydrate で catch → console.error

**エラー箇所:**
```typescript
// strategyStore.ts:3849-3882
if (error) {
  set((s) => ({
    ...s,
    __isFetchingFromServer: false,
    loaded: false,
    isRestoring: false,
    restoreReady: false,  // ← false のまま
  }));
  throw new Error(errMsg);
}
```

**検証方法:**
console で以下を確認：
```
[refetchFromServer:error] ❌ Data fetch failed
```
または
```
[execution] ❌ loadAndHydrate error:
```

---

### 🟠 第二候補（確度 65%）：refetchFromServer が実行されていない

**根拠:**
- `[refetchFromServer:start]` ログが出ていない
- loadAndHydrate の useEffect が実行されていない
- または execution/page.tsx:1547 の条件で early return

```typescript
// execution/page.tsx:1547
if (hydrated && scopeCompanyId === accessCompanyId) return;
```

**シナリオ:**
```
T0: hydrated が既に true になっている（前回の company から）
T1: setCompanyScope で scopeCompanyId を切り替える
T2: 同じ accessCompanyId で再度 useEffect が走る
T3: `if (hydrated && scopeCompanyId === accessCompanyId) return;`
   → LINE 1547 でいったん return（早期終了）
T4: その後、scopeCompanyId が accessCompanyId と異なる状態で
   → 保存ボタンを押す
T5: restoreReady は前回の company の値のままになっている可能性
```

**検証方法:**
console で以下を確認：
```
[execution] 📥 loadAndHydrate 開始
```
このログが最後に出たのはいつか？

---

### 🟡 第三候補（確度 50%）：refetchFromServer が成功したが restoreReady が false に戻されている

**根拠:**
- `[refetchFromServer:done] ✅ Fetch and restore complete` ログが出ている
- しかし save 時には restoreReady=false

**シナリオ:**
```
T0: refetchFromServer 実行 → restoreReady: true に設定（LINE 4060 or 4130）
T1: その直後に何か別の処理が restoreReady を false に戻す
     → setCompanyScope が再度呼ばれる？
     → 別の company に遷移する？
     → modal が close される？

T2: save ボタンをクリック（その時には restoreReady=false）
```

**リセットが起きる箇所:**
- setCompanyScope（LINE 1894）
- refetchFromServer エラー（LINE 3873, 3778）
- 他？

**検証方法:**
console で以下の時系列を確認：
```
[refetchFromServer:done] ✅ Fetch and restore complete → restoreReady: true 設定
↓
(時刻 T)
↓
[STAGE5-save-checkin-result] ← save 呼び出し時 → restoreReady: ?
```

もし T の間に `setCompanyScope` や `refetchFromServer:error` が出ていたら、
そこで false に戻されている。

---

## C. 保存ボタン押下時の状態確認（実装案）

### 現在のコード（execution/page.tsx:621-643）

```typescript
if (result?.ok) {
  setNotice('✅ 記録しました');
  console.log('[STAGE5-save-checkin-result]', {
    ok: true,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
} else {
  setNotice(`⚠️ 同期中のため...`);
  console.log('[STAGE5-save-checkin-result]', {
    ok: false,
    reason: result?.reason,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
  // ...
}
```

### 追加すべきログ（最小限のデバッグ情報）

save 呼び出し直前に状態を記録：

```typescript
// execution/page.tsx:621 の直前（既存の state チェック後）
const preState = useStrategyStore.getState();
console.log('[STAGE5-save-checkin-before-saveStrategyData]', {
  hydrated: preState.hydrated,
  restoreReady: preState.restoreReady,
  isRestoring: preState.isRestoring,
  __isFetchingFromServer: preState.__isFetchingFromServer,
  'boot.isHydrating': preState.boot?.isHydrating,
  dirty: preState.dirty,
  loaded: preState.loaded,
  companyId: preState.companyId,
  pendingCompanyId: preState.pendingCompanyId,
  scopeCompanyId: scopeCompanyId,  // 親 component の props
  timestamp: new Date().toISOString(),
});

// その後、save 呼び出し
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
```

このログで、master guard の 3 つの条件すべてが確認できる。

---

## D. 原因候補の優先順位付け

### 🔴 第一候補：refetchFromServer が失敗している（確度 85%）

**根拠コード：**
```typescript
// strategyStore.ts:3849-3882
if (error) {
  console.warn('[refetchFromServer:error] ❌ Data fetch failed', {
    errorCode,
    errorStatus,
    isTransientError,
    message: (error as any)?.message,
    timestamp,
  });
  set((s) => ({
    ...s,
    __isFetchingFromServer: false,
    loaded: false,
    isRestoring: false,
    restoreReady: false,  // ← ここで false
  }));
  throw new Error(errMsg);
}
```

**修正リスク：** 低い（API エラーは根本原因で guard ではない）

**次のステップ：**
- console に `[refetchFromServer:error]` が出ているか確認
- errorCode と errorStatus を確認
- API call が本当に失敗しているのか確認

---

### 🟠 第二候補：refetchFromServer が実行されていない（確度 65%）

**根拠コード：**
```typescript
// execution/page.tsx:1547
if (hydrated && scopeCompanyId === accessCompanyId) return;
```

**修正リスク：** 中（condition の理由を理解する必要がある）

**next のステップ：**
- `[execution] 📥 loadAndHydrate 開始` が出ているか
- 最後に出た時刻を確認
- save 時刻との差を確認

---

### 🟡 第三候補：refetchFromServer 後に restoreReady が false に戻されている（確度 50%）

**根拠コード：**
```typescript
// setCompanyScope（LINE 1894）
restoreReady: false,
```

**修正リスク：** 高（画面遷移・modal などの UX に関わる）

**next のステップ：**
- `[refetchFromServer:done]` の時刻
- その後の ログ（setCompanyScope など）
- save 時刻
- 時系列を追跡

---

## E. 最小修正案（force/guard 削除なし）

### 修正案A：デバッグログの追加（リスク最小）

**対象：** execution/page.tsx の onSaveCheckin / onSaveFeedback

**修正内容：** save 呼び出し直前に状態ログを追加

```typescript
// save 呼び出し直前
const preState = useStrategyStore.getState();
console.log('[STAGE5-save-checkin-before-saveStrategyData]', {
  hydrated: preState.hydrated,
  restoreReady: preState.restoreReady,
  isRestoring: preState.isRestoring,
  __isFetchingFromServer: preState.__isFetchingFromServer,
  'boot.isHydrating': preState.boot?.isHydrating,
  dirty: preState.dirty,
  loaded: preState.loaded,
  companyId: preState.companyId,
  timestamp: new Date().toISOString(),
});

const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
```

**効果：**
- 何が false なのかが明確になる
- 第一候補を検証できる

**リスク：** ゼロ（ログのみ）

---

### 修正案B：refetchFromServer 失敗時の自動 retry（リスク低）

もし第一候補が確認されたら、refetchFromServer が失敗した場合に自動で再試行する。

```typescript
// utils/loader.ts:78
try {
  await store.refetchFromServer();
} catch (e) {
  // 第一候補：API エラーで失敗
  console.warn('[loadAndHydrate] refetchFromServer failed, will retry', e);
  // ← 現在は throw するだけで、useAutoSave が retry する
  // より主動的に retry する方法も検討
  throw e;
}
```

---

### 修正案C：loadAndHydrate の condition を見直す（リスク中）

もし第二候補が確認されたら、condition を修正

```typescript
// execution/page.tsx:1547
// 修正前：
if (hydrated && scopeCompanyId === accessCompanyId) return;

// 修正後：
// - scopeCompanyId !== accessCompanyId ならば常に loadAndHydrate
// - hydrated の条件を削除？
// （ただし、無限ループ防止が必要）
```

---

## F. STAGE4 に影響しない理由

### STAGE4 の save フロー

```
okr/page.tsx:persists Stage4Snapshot
  ↓
refetchFromServer 常実行（既に修正済み）
  ↓
setHydrated(true)
```

STAGE4 は独立した flow で、refetchFromServer と restoreReady に依存しない。

**確認：** okr/page.tsx:543 の persistStage4Snapshot guard

```typescript
if (restoreReady === false) return;
```

STAGE4 でも restoreReady をチェックしているが、STAGE5 での修正（restore_not_ready を解決）は、STAGE4 の condition に影響しない。

---

## G. 最重要ポイント

**restore_not_ready が出る直接原因：**

master guard の 3 つの条件のいずれかが false

```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
```

- `hydrated=false` → STAGE5 初期化されていない
- `restoreReady=false` → 最重要。以下の理由のいずれか：
  1. refetchFromServer が失敗している（第一候補）
  2. refetchFromServer が実行されていない（第二候補）
  3. refetchFromServer 完了後に false に戻されている（第三候補）
- `isRestoring=true` → 復元中（restoreReady=false の派生）

---

## H. 実装の次のステップ

### Step 1: デバッグログを追加（今すぐ）

execution/page.tsx の onSaveCheckin/onSaveFeedback に、save 呼び出し直前の状態ログを追加

### Step 2: ログを確認（運用時）

console で：
```
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: ?,
  restoreReady: ?,
  isRestoring: ?,
  __isFetchingFromServer: ?,
  ...
}

[STAGE5-save-checkin-result] {
  ok: false,
  reason: "restore_not_ready",
  ...
}
```

### Step 3: 根本原因を特定

- `restoreReady: false` なら、refetchFromServer の エラーログを探す
- ログがなければ、loadAndHydrate が実行されていない可能性
- 時系列を確認して、false に戻された箇所を特定

### Step 4: 最小修正を実装

- 第一候補なら：API エラー対応（再試行など）
- 第二候補なら：condition の修正
- 第三候補なら：画面遷移の整理

---

**この調査により、force を使わずに restore_not_ready の根本原因が特定できます。**

