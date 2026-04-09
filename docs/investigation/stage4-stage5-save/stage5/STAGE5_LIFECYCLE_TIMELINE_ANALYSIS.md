# STAGE5 画面遷移後の lifecycle 時系列分析

**分析日**: 2026-04-09
**問題**: STAGE5 初回訪問時は save 成功 (restoreReady=true) だが、別画面へ移動して戻ると save 失敗 (restoreReady=false)

---

## A. STAGE5 初回訪問フロー

### Timeline: T0 → T10（すべて synchronous または同じ render cycle）

```
T0: STAGE5 ページ マウント
  └ accessCompanyId が設定される（props または useAccess()）
  └ scopeCompanyId: 初期値？（undefined または前回のcompanyId）
  └ hydrated: false（初回なので未復元）
  └ 両方の useEffect が dependency check

T1: 🔵 Effect-1 実行（company scope effect）
  └ [LINE 1564-1571]
  └ if (!accessCompanyId) return; // accessCompanyId がある
  └ if (scopeCompanyId && scopeCompanyId !== accessCompanyId)
     └ 通常は false（最初の訪問なので scopeCompanyId=undefined）
  └ else:
     └ setCompanyScope(accessCompanyId) 実行
        └ strategyStore.ts:1894 で呼ばれる
        └ 設定値:
           ├ pendingCompanyId: accessCompanyId
           ├ boot: { isHydrating: true, isHydrated: false }
           ├ __isFetchingFromServer: true
           ├ _loadingRefetch: false
           ├ __lastServerError: undefined
           ├ 🔴 restoreReady: false
           └ isRestoring: true

T2: State 更新完了（Zustand）
  └ hydrated: false のまま
  └ scopeCompanyId: accessCompanyId に更新される
  └ restoreReady: false（setCompanyScope で設定）
  └ isRestoring: true（setCompanyScope で設定）
  └ __isFetchingFromServer: true（setCompanyScope で設定）
  └ boot.isHydrating: true（setCompanyScope で設定）

T3: React は dependency 変更を検出して Effect-2 も実行
  └ [LINE 1573-1598]
  └ accessCompanyId: 値あり
  └ hydrated: false
  └ scopeCompanyId: accessCompanyId と同じになった
  └ 実行開始

T4: 🔵 Effect-2 の condition チェック
  └ if (hydrated && scopeCompanyId === accessCompanyId) return;
  └ hydrated: false だから condition は false
  └ ✅ 続行（early return せず）

T5: loadAndHydrate(accessCompanyId) 実行
  └ [utils/loader.ts:62]
  └ setHydrating(true) → boot.isHydrating: true（既に true）
  └ setCompanyScope(accessCompanyId) → 🔴 restoreReady: false に再設定
  └ refetchFromServer() 実行
     └ [strategyStore.ts:3766]
     └ API call: getFullStrategyDataByCompany(accessCompanyId)
     └ 成功時: restoreReady: true に設定（LINE 4060 or 4130）
     └ 失敗時: restoreReady: false のまま

T6: refetchFromServer 成功パス
  └ [strategyStore.ts:4060 or 4130]
  └ 設定値:
     ├ __isFetchingFromServer: false
     ├ 🟢 restoreReady: true
     ├ isRestoring: false
     └ hydrated は markLoaded() で設定

T7: setHydrated() 実行
  └ [strategyStore.ts:4053 or 4140]
  └ hydrated: true に設定

T8: loadAndHydrate finally ブロック
  └ markLoaded() → hydrated: true, loaded: true
  └ setHydrating(false) → boot.isHydrating: false

T9: 最終状態
  ✅ hydrated: true
  ✅ restoreReady: true
  ✅ isRestoring: false
  ✅ __isFetchingFromServer: false
  ✅ boot.isHydrating: false
  └ → saveStrategyData のmaster guard を通過可能

T10: Save ボタンクリック
  └ saveStrategyData({ reason: 'manual' }) 実行
  └ master guard: canSave = true && true && !false = true ✅
  └ 保存成功
  └ dirty: false に設定
  └「✅ 記録しました」notice 表示
```

---

## B. 別画面へ移動して STAGE5 に戻るフロー

### Timeline: T11 → T25（問題発生箇所）

```
T11: ユーザーが別画面へ移動
  └ STAGE5 が unmount
  └ useEffect cleanup 実行
  └ ... (他の画面で作業) ...

T12: ユーザーが STAGE5 に戻る
  └ STAGE5 ページ再マウント
  └ accessCompanyId: 同じ（コンポーネント props の accessCompanyId）
  └ scopeCompanyId: accessCompanyId（前回の状態が保持されている）← 🔴 重要
  └ hydrated: true ← 🔴 重要！localStorage から復元されている
  └ restoreReady: false（何か他の理由で false）
  └ isRestoring: false
  └ __isFetchingFromServer: false
  └ boot.isHydrating: false

T13: 🔵 Effect-1 実行（company scope effect）
  └ [LINE 1564-1571]
  └ if (!accessCompanyId) return; // accessCompanyId がある
  └ if (scopeCompanyId && scopeCompanyId !== accessCompanyId)
     └ 同じ company なので false（scopeCompanyId === accessCompanyId）
  └ else:
     └ setCompanyScope(accessCompanyId) 実行 ← 🔴 同じ company なのに実行される！
        └ 設定値:
           ├ pendingCompanyId: accessCompanyId
           ├ boot: { isHydrating: true, isHydrated: false }
           ├ __isFetchingFromServer: true
           ├ _loadingRefetch: false
           ├ __lastServerError: undefined
           ├ 🔴 restoreReady: false ← ここで false に戻される！
           └ isRestoring: true

T14: State 更新完了
  └ hydrated: true（変更なし）
  └ scopeCompanyId: accessCompanyId（変更なし）
  └ restoreReady: 🔴 false に設定された（重要！）
  └ isRestoring: true
  └ __isFetchingFromServer: true
  └ boot.isHydrating: true

T15: React は dependency 変更を検出...するか？
  └ Effect-2 の dependency: [accessCompanyId, hydrated, scopeCompanyId]
  └ T12 時点で既に：
     ├ accessCompanyId: 変更なし（同じ）
     ├ hydrated: true（変更なし）
     └ scopeCompanyId: accessCompanyId（変更なし）
  └ 🔴 **Effect-2 は実行されない可能性がある！**
     └ （すべての dependency が同じなので React は skip する）
  └ または、T13 で scopeCompanyId が更新された場合、effect-2 は実行される

T16a: シナリオA - Effect-2 が実行される場合
  └ 実行開始

T17a: 🔵 Effect-2 の condition チェック
  └ if (hydrated && scopeCompanyId === accessCompanyId) return;
  └ hydrated: true AND scopeCompanyId === accessCompanyId: true
  └ 🔴 両方 true なので condition は true → early return！
  └ ❌ loadAndHydrate は実行されない

T18a: 最終状態（Effect-2 が実行されたがスキップされた場合）
  ❌ restoreReady: false（T13 で false に設定されたまま）
  ❌ isRestoring: true
  ❌ __isFetchingFromServer: true
  ❌ boot.isHydrating: true
  └ → saveStrategyData のmaster guard で失敗
     └ canSave = true && false && !true = false
     └ reason: 'restore_not_ready'

T16b: シナリオB - Effect-2 が実行されない場合（dependency が変わらない）
  └ 実行されない

T18b: 最終状態（Effect-2 がまったく実行されない場合）
  ❌ 同上（restoreReady: false のまま）

T19: Save ボタンクリック
  └ saveStrategyData({ reason: 'manual' }) 実行
  └ master guard:
     └ canSave = hydrated(true) && restoreReady(false) && !isRestoring(true) = false
  └ 🔴 保存失敗
  └ reason: 'restore_not_ready'
  └「⚠️ 同期中のため...」notice 表示
```

---

## C. 問題の根本原因

### 🔴 二重設定の問題

**setCompanyScope が同じ company に対して再度呼ばれる（T13）**

```typescript
// execution/page.tsx:1564-1571
useEffect(() => {
  if (!accessCompanyId) return;
  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);  // 異なる company 場合
  } else {
    setCompanyScope(accessCompanyId);  // 同じ company でも呼ばれる！← 🔴
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

**このeffect の dependency array の問題：**
- `setCompanyScope` が dependency に含まれている
- Zustand store method なので毎 render で新しい reference が生成される可能性
- または、単に accessCompanyId/scopeCompanyId の初期化フロー上で常に通る

**結果:**
- T13 で setCompanyScope が呼ばれ、restoreReady: false に設定
- T17a で Effect-2 が early return して loadAndHydrate が実行されない
- restoreReady が false のまま

---

### 🔴 early return condition の問題

```typescript
// execution/page.tsx:1577
useEffect(() => {
  // ...
  const run = async () => {
    if (hydrated && scopeCompanyId === accessCompanyId) return;  // 🔴 この条件
    await loadAndHydrate(accessCompanyId);
  };
}, [accessCompanyId, hydrated, scopeCompanyId]);
```

**この condition は何を意図しているか：**
- `hydrated: true` = 既に初期化済み
- `scopeCompanyId === accessCompanyId` = scope と access が一致している
- つまり「既に初期化済みで、かつ company も一致している場合は skip」

**問題：**
- 初回訪問: hydrated=false なので condition=false → loadAndHydrate 実行 ✅
- 再訪問: hydrated=true で scopeCompanyId=accessCompanyId なので condition=true → skip ❌
- しかし、T13 で setCompanyScope が restoreReady を false に設定してしまった
- その false 状態のまま loadAndHydrate が実行されない

---

## D. なぜ初回は成功するか

**T0-T10 では成功する理由：**
1. T1 で setCompanyScope が restoreReady=false に設定
2. T4 で hydrated=false なので条件 false → loadAndHydrate 実行
3. T5 で loadAndHydrate 内部で再度 setCompanyScope が呼ばれるが、その直後に refetchFromServer が実行
4. refetchFromServer で restoreReady: true に設定される
5. リセット→復元 の cycle が一度に完了

**再訪問では失敗する理由：**
1. T12 で hydrated=true で復帰
2. T13 で setCompanyScope が restoreReady=false に設定
3. T17a で hydrated=true だから condition=true → loadAndHydrate が実行されない
4. restoreReady が false のまま放置

---

## E. 修正の候補（force なし、guard 削除なし）

### 🟢 修正案1: Effect-1 の condition を改善（推奨）

**問題:** 同じ company に対して setCompanyScope が呼ばれ、restoreReady が false に上書きされる

**修正:**
```typescript
// execution/page.tsx:1564-1571
useEffect(() => {
  if (!accessCompanyId) return;

  // ★ 修正: scopeCompanyId が既に一致している場合は何もしない
  if (scopeCompanyId === accessCompanyId) return;

  // company が異なる場合のみ切り替え
  if (scopeCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

**効果:**
- 同じ company の再訪問では setCompanyScope が呼ばれない
- restoreReady が false に上書きされない
- Effect-2 で loadAndHydrate が実行できる環境が保たれる

**リスク：低い**
- 初回訪問時: scopeCompanyId=undefined → condition false → setCompanyScope 実行 ✅
- 再訪問時: scopeCompanyId=accessCompanyId → condition true → skip ✅
- company 切り替え時: scopeCompanyId≠accessCompanyId → continue → hardReset 実行 ✅

---

### 🟠 修正案2: Effect-2 の condition を緩和

**問題:** hydrated=true だと loadAndHydrate がスキップされる

**修正:**
```typescript
// execution/page.tsx:1573-1598
useEffect(() => {
  if (!accessCompanyId) return;
  let cancelled = false;
  const run = async () => {
    // ★ 修正: restoreReady も確認してから skip する
    const state = useStrategyStore.getState();
    if (state.hydrated && state.restoreReady && scopeCompanyId === accessCompanyId) {
      return;  // 初期化済み且つ復元完了
    }

    try {
      await loadAndHydrate(accessCompanyId);
    } catch (err) {
      // ...
    }
  };
  run();
}, [accessCompanyId, hydrated, scopeCompanyId]);
```

**効果:**
- restoreReady=false の場合は loadAndHydrate が実行される
- hydrated=true でも restoreReady=false なら再実行

**リスク：中**
- loadAndHydrate が何度も実行される可能性
- 無限ループ防止が必要（currently setCompanyScope の dependency）

---

### 🟡 修正案3: setCompanyScope の dependency を削除

**問題:** setCompanyScope method が dependency に含まれると毎 render で effect が走る可能性

**修正:**
```typescript
// execution/page.tsx:1564-1571
useEffect(() => {
  if (!accessCompanyId) return;
  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId]);  // ★ setCompanyScope を削除
```

**効果:**
- setCompanyScope method の reference change で無駄な実行が減る

**リスク：低い**
- setCompanyScope function は side-effect free（内部的に store.set を呼ぶだけ）

---

## F. 推奨修正：修正案1（Effect-1 の condition 改善）

**理由:**
1. 最小限の変更（condition を追加するだけ）
2. logic の意図が明確（同じ company は skip）
3. リスクが最小（dependency 変更なし）
4. master guard、force、hydrating/isFetching 変更なし

**修正差分:**
```diff
useEffect(() => {
  if (!accessCompanyId) return;
+  // 既に同じ company に設定済みの場合は skip
+  if (scopeCompanyId === accessCompanyId) return;
+
  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

**期待結果:**
- 初回: scopeCompanyId=undefined → skip しない → setCompanyScope 実行 ✅
- 再訪問: scopeCompanyId=accessCompanyId → skip → restoreReady 保持 ✅
- 別 company: scopeCompanyId≠accessCompanyId → skip しない → hardReset/setCompanyScope 実行 ✅
- restore workflow: Effect-2 で loadAndHydrate 実行 → refetchFromServer → restoreReady=true ✅

---

## G. 次のステップ

### Step 1: 現在の動作を検証（console log）

修正前に、現在の挙動を確認：

```typescript
useEffect(() => {
  if (!accessCompanyId) return;
  console.log('[STAGE5-effect-1]', {
    event: 'start',
    accessCompanyId,
    scopeCompanyId,
    condition_willCall_hardReset: scopeCompanyId && scopeCompanyId !== accessCompanyId,
    condition_willCall_setCompanyScope: !scopeCompanyId || scopeCompanyId === accessCompanyId,
  });

  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

### Step 2: 修正案1 を適用

### Step 3: 修正後の挙動を検証

```typescript
useEffect(() => {
  if (!accessCompanyId) return;

  console.log('[STAGE5-effect-1-improved]', {
    event: 'start',
    accessCompanyId,
    scopeCompanyId,
    skip_because_same_company: scopeCompanyId === accessCompanyId,
  });

  // ★ 修正: 同じ company なら skip
  if (scopeCompanyId === accessCompanyId) {
    console.log('[STAGE5-effect-1-improved]', { event: 'skip_same_company' });
    return;
  }

  if (scopeCompanyId) {
    console.log('[STAGE5-effect-1-improved]', { event: 'hardReset' });
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    console.log('[STAGE5-effect-1-improved]', { event: 'setCompanyScope' });
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

---

**この分析で、STAGE5 の lifecycle 問題の根本原因が明確になります：setCompanyScope が同じ company に対して再度呼ばれ、restoreReady を false に戻してしまうこと。**

