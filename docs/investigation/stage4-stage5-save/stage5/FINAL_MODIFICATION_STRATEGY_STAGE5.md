# STAGE5 保存問題 最終修正戦略

**作成日**: 2026-04-09
**対象**: STAGE5 チェックイン・フィードバック・進捗 save の fetch/hydrate ブロック問題
**結論**: force:true は使うべきではない。代わりに「explicit manual save と autosave を区別」する設計に変更する。

---

## I. executive summary

### 最終判断

#### ❌ force:true を入れてはいけない保存

1. **onSaveCheckin**（チェックイン記録）- LINE 603
2. **onSaveFeedback**（フィードバック保存）- LINE 819
3. **onEditProgress**（progress autosave）- LINE 993

### 理由

force:true は以下を迂回する：
1. fetch/hydrate guard（LINE 3281）← これだけ迂回したい
2. **master guard（hydrated && restoreReady && !isRestoring）← これを迂回すると危険**
3. revision チェック（LINE 3363）← これを迂回すると危険

restoreReady=false の状態で save を強制すると、サーバーデータの復元とローカル編集のタイミング競合が発生し、データ破損の可能性がある。

---

## II. useAutoSave が既に提供している保護

### 重大な発見：useAutoSave は既に isFetching ガードを実装している

**ファイル**: `/hooks/useAutoSave.ts:359-387`

```typescript
// ★ isFetching チェック（最重要）
if (isFetching) {
  if (mode === 'payload') {
    console.log('[AutoSave][guard-check] SKIP: isFetching');
  }
  return;  // ← isFetching=true なら autosave をスキップ
}
```

**実装場所**: execution/page.tsx:1514-1521

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

### useAutoSave のガード条件

| 条件 | チェック | 説明 |
|------|---------|------|
| enabled | LINE 325-331 | 機能が enabled かどうか |
| hydrated | LINE 333-338 | hydrated=true を待つ（requireHydrated:true） |
| userId | LINE 339-344 | ユーザーが認証されているか |
| companyId | LINE 345-350 | company が選択されているか |
| company deleting | LINE 351-356 | company 削除中でないか |
| **isFetching** | **LINE 359-387** | **🔴 __isFetchingFromServer=true OR boot.isHydrating=true の場合スキップ** |
| conflict cooldown | LINE 391-396 | conflict recovery 中でないか |
| post-restore cooldown | LINE 399-414 | post-restore グレースピリオド |
| pending conflict recovery | LINE 417-422 | conflict recovery pending でないか |
| initialDelayMs | LINE 424-433 | 初期化遅延 |
| session | LINE 435-443 | セッションが active か |
| minIntervalMs | LINE 446-455 | 最小保存間隔 |
| saving | LINE 456+ | 既に save 中でないか |

### useAutoSave が protect している内容

- **strategy_data の自動保存** は、isFetching=true の時には実行されない
- つまり、STAGE1-5 全体の autosave は既に fetch/hydrate guard が有効

---

## III. onEditProgress の実装を再検討

### 現在の実装（LINE 977-1016）

```typescript
const onProgressChange = useCallback((field, oldValue, newValue) => {
  // ... store を updateDepartments で更新 ...

  // ★ debounce をバイパスして直接 save
  (async () => {
    try {
      const state = useStrategyStore.getState();
      const result = await state.saveStrategyData({ reason: 'progress_change' });
      // ...
    } catch (err) {
      // ...
    }
  })();
}, [di, pi, isVariant, stage4Proj, updateDepartments]);
```

### 問題点

1. **useAutoSave の guard をバイパスしている**
   - useAutoSave は isFetching=true でスキップする
   - しかし直接 saveStrategyData を呼ぶと、この guard をバイパス
   - LINE 3281 の fetch/hydrate guard に当たる

2. **reason='progress_change' で複数回呼ばれる可能性**
   - ユーザーが数値を修正する場合、複数回 save が走る
   - 各 save で isFetching=true を迂回される

3. **force:true を加えると さらに危険**
   - master guard もスキップされる
   - revision 管理が破綻する

### より安全な代替案

#### 案A: dirty フラグを立てて useAutoSave に任せる（推奨）

```typescript
const onProgressChange = useCallback((field, oldValue, newValue) => {
  // ... store を updateDepartments で更新 ...

  // ★ 修正: dirty フラグを立てるだけ
  // useAutoSave が later に isFetching=false になったら自動で save
  useStrategyStore.setState({ dirty: true });

  // ★ オプション: ローカルフィードバック（ユーザーに「変更中」を伝える）
  console.log('[progress-change] dirty set, will save by autosave', { field, newValue });
}, [di, pi, isVariant, stage4Proj, updateDepartments]);
```

**メリット:**
- useAutoSave の全 guard が有効（isFetching チェック含む）
- fetch/hydrate 中でも問題なく、later に save
- デバッグが簡単（autosave ログが出る）

**デメリット:**
- 即座に save されない（autosave の debounce 待つ）
- 複数回の progress 編集が1回の save にまとめられる

#### 案B: isFetching チェックを追加（lightweight）

```typescript
const onProgressChange = useCallback((field, oldValue, newValue) => {
  const state = useStrategyStore.getState();

  // ★ Check: isFetching/hydrating 中ならスキップ
  if (state.__isFetchingFromServer || state.boot?.isHydrating) {
    console.log('[progress-change] isFetching/hydrating, skip save for now', { field });
    // ★ useAutoSave が later に拾う
    state.setState({ dirty: true });
    return;
  }

  // ... normal save ...
  (async () => {
    const result = await state.saveStrategyData({ reason: 'progress_change' });
    // ...
  })();
}, [di, pi, isVariant, stage4Proj, updateDepartments]);
```

**メリット:**
- fetch/hydrate 中は save をスキップ
- useAutoSave が later に拾う
- 既存ロジックへの変更が最小

**デメリット:**
- 手動で guard を追加する必要
- useAutoSave と手動 save が両存在（ロジックが複雑）

#### 案C: reason='progress_change' を disable

```typescript
// execution/page.tsx のコメント付きで：
// progress_change save は DISABLED
// → useAutoSave (dirty フラグ) に統一
```

**メリット:**
- シンプル
- すべての save が useAutoSave 経由

**デメリット:**
- progress input の UX が悪くなる可能性（autosave は 1200ms debounce）

---

## IV. onSaveCheckin / onSaveFeedback の検討

### 現在のコンテキスト

**onSaveCheckin（LINE 603）:**
```typescript
const onSaveCheckin = useCallback(async () => {
  // ... progress_logs INSERT ...
  useStrategyStore.getState().setOKRTargetScore(okrId, rating);
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
  // ...
}, [/* deps */]);
```

**onSaveFeedback（LINE 819）:**
```typescript
const onSaveFeedback = useCallback(async () => {
  // ... feedback_logs INSERT ...
  useStrategyStore.getState().setOKRTargetScore(okrId, reviewScore);
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
  // ...
}, [/* deps */]);
```

### 分析

#### Normal フロー（restoreReady=true）

```
T0: STAGE5 に入る
T1: execution/page.tsx:1487 の useEffect でloadAndHydrate 実行開始
T2: refetchFromServer 実行中（Network latency 2-5秒）
T3: refetchFromServer 完了 → restoreReady=true
T4: ユーザーがチェックイン記録ボタンをクリック
T5: onSaveCheckin → saveStrategyData({ reason: 'manual' })
T6: LINE 3281 fetch/hydrate guard でチェック：isFetching=false, hydrating=false → OK
T7: LINE 3318 master guard でチェック：restoreReady=true → OK
T8: save 実行 ✅
```

このフローでは、restoreReady=true であるため、force:true は不要。

#### Racing フロー（restoreReady=false）

```
T0: STAGE5 に入る
T1: loadAndHydrate 実行開始
T2: refetchFromServer API call 開始（Network latency 2-5秒）
  → boot.isHydrating = true
  → __isFetchingFromServer = true
  → restoreReady = false (まだ)
T3: ユーザーが **異常に早く** チェックイン記録ボタンをクリック（T2のたった数百ミリ秒後）
T4: onSaveCheckin → saveStrategyData({ reason: 'manual' })
T5: LINE 3281 fetch/hydrate guard：!false && (true || true) = true → SKIP ❌
  → console: "skip while fetching/hydrating (not forced)"
T6: save スキップ
  → ユーザーに「未保存」と表示される ❌
```

**force:true を入れた場合:**

```
T4: onSaveCheckin → saveStrategyData({ reason: 'manual', force: true })
T5: LINE 3281 fetch/hydrate guard：!true && (...) = false → パス ✓
T6: LINE 3318 master guard：restoreReady=false, !force=false → パス ✗（迂回）
T7: restoreReady=false のまま save 実行 ❌
T8: saveStrategyData で payload を build → DB に送信
T9: refetchFromServer finally 実行 → restoreReady=true に設定
T10: サーバーからの復元データが apply される → T8 の save がoverwrite される可能性 ⚠️
```

### 実際の発生確率

**Racing フローはレアケース：**
- Normal フロー（T3→T4→T6 で restoreReady=true）が 95% 以上
- refetch が 2-5秒なので、ユーザーがそれより早く記録ボタンをクリックする必要
- 実際のユースケース：ユーザーは data を確認してから記録ボタンをクリックする

**しかし可能性は 0 ではない：**
- Network が遅い場合（3G, 低速Wi-Fi）
- ユーザーが焦って「すぐに記録」したい場合
- Mobile デバイスで Network が不安定な場合

### force:true の是非

❌ **force:true は入れるべきではない**

理由：
1. レアケース（Racing フロー）のために、common case の安全性を損なう
2. master guard をスキップするリスクが高い
3. より安全な代替案がある

### より安全な代替案

#### 案A: restoreReady になるまで待つ（最安全）

```typescript
const onSaveCheckin = useCallback(async () => {
  // ... progress_logs INSERT ...
  useStrategyStore.getState().setOKRTargetScore(okrId, rating);

  // ★ 修正: restoreReady を待つ
  const state = useStrategyStore.getState();
  if (!state.restoreReady) {
    setNotice('データ同期中です...');
    // retry: setTimeout または useEffect で待つ
    // or: disable ボタン（hydrating 中はグレー表示）
    return;
  }

  await state.saveStrategyData({ reason: 'manual' });
  setNotice('✅ 記録しました');
}, [/* deps */]);
```

**メリット:**
- すべてのガード（fetch/hydrate, master, revision）が有効
- データ破損のリスク 0

**デメリット:**
- ユーザーが「記録」をクリックしても待たされる（UX 悪い可能性）
- retry ロジックが必要

#### 案B: ボタンを disable（UX 重視）

```typescript
// execution/page.tsx の JSX で：
<button
  onClick={onSaveCheckin}
  disabled={!state.restoreReady || state.__isFetchingFromServer || state.boot?.isHydrating}
>
  {state.restoreReady ? '記録する' : 'データ同期中...'}
</button>
```

**メリット:**
- ユーザーに明確に「待ってね」と伝える
- save skip のロジック不要

**デメリット:**
- UI 変更が必要

---

## V. STAGE4 修正との関係性

### STAGE4 修正が解決したこと

```typescript
// okr/page.tsx:396-417（既実装）
// ★ FIX: isDirty に関わらず常に refetchFromServer を実行
try {
  await refetchFromServer?.();  // ← isDirty の条件分岐を削除
} catch { }
setHydrated?.(true);
```

**効果:**
- isDirty=true でも refetch が常に実行される
- STAGE4 から STAGE5 への遷移時、restoreReady=true が確実に設定される

### STAGE4 修正が STAGE5 に与える影響

#### 直接的な影響：なし

STAGE5 には独立した loadAndHydrate がある：

```typescript
// execution/page.tsx:1487
useEffect(() => {
  // ...
  store.loadAndHydrate(accessCompanyId);
}, [accessCompanyId, hydrated, scopeCompanyId]);
```

**つまり:**
- STAGE4 修正は「STAGE4 内で restoreReady=true を確実にする」
- STAGE5 に入る際は、STAGE5 自身の loadAndHydrate で新たに hydrating=true に設定される
- STAGE4 修正は STAGE5 の hydrating 問題には直接影響しない

#### 間接的な影響：初期状態が良い

- STAGE4 → STAGE5 遷移時、restoreReady=true を持ったまま遷移
- STAGE5 の loadAndHydrate が実行されるまで、restoreReady=true を保持
- そのため、STAGE5 直後の save は restoreReady=true で実行される可能性が高い

#### しかし STAGE5 内での問題は残存

- company change（cross-company navigation）した場合
- または loadAndHydrate の refetch API が遅い場合
- hydrating=true, isFetching=true に戻される

---

## VI. 最終推奨（ユーザーの要求に答える）

### Q1: force を入れてよいのはどの保存だけか

**A: なし**

すべての save に force を入れてはいけない。

### Q2: 入れてはいけない保存はどれか

**A: 全部**

1. onSaveCheckin（チェックイン記録）
2. onSaveFeedback（フィードバック保存）
3. onEditProgress（progress autosave）

### Q3: 最小修正案（manual save 限定）

**A: 修正案なし（force:true は使わない）**

代わりに：

#### 推奨修正案A: 「待つ」パターン

**onSaveCheckin / onSaveFeedback に対して:**

```typescript
const saveIfReady = async (reasonLabel: string) => {
  const state = useStrategyStore.getState();

  // Check: restoreReady
  if (!state.restoreReady) {
    setNotice('📡 データ同期中です。数秒お待ちください...');

    // Retry after 500ms
    setTimeout(() => saveIfReady(reasonLabel), 500);
    return;
  }

  // Check: isFetching/hydrating
  if (state.__isFetchingFromServer || state.boot?.isHydrating) {
    setNotice('📡 同期中...');
    setTimeout(() => saveIfReady(reasonLabel), 300);
    return;
  }

  // Safe to save
  const result = await state.saveStrategyData({ reason: 'manual' });
  if (result?.ok) {
    setNotice(`✅ ${reasonLabel}しました`);
  } else {
    setNotice(`⚠️ 保存に失敗: ${result?.reason}`);
  }
};

// Use in onSaveCheckin:
await saveIfReady('記録');
```

**メリット:**
- すべてのガードが有効
- ユーザーに「同期中」を明示
- データ破損のリスク 0

**デメリット:**
- retry ロジックが必要

#### 推奨修正案B: ボタン disable パターン

```typescript
// execution/page.tsx:JSX
const isReady = state.restoreReady &&
                !state.__isFetchingFromServer &&
                !state.boot?.isHydrating;

<button
  onClick={onSaveCheckin}
  disabled={!isReady}
  title={!isReady ? 'データ同期中...' : 'クリックして記録'}
>
  {isReady ? '記録する' : '準備中...'}
</button>
```

**メリット:**
- UI が明確
- ユーザーに待つべき時が分かる
- save skip のロジック不要

**デメリット:**
- ボタンの UX が変わる

### Q4: autosave はどう扱うべきか

**A: 3 つの選択肢**

#### 案1: dirty フラグを立てて useAutoSave に任せる（推奨）

**onEditProgress を修正:**

```typescript
const onProgressChange = useCallback((field, oldValue, newValue) => {
  // ... store を updateDepartments で更新 ...

  // ★ 修正: dirty フラグを立てるだけ
  const state = useStrategyStore.getState();
  state.setState({ dirty: true });

  console.log('[STAGE5-progress-change-dirty]', { field, newValue });
  // → useAutoSave が later に isFetching=false を待って save
}, [di, pi, isVariant, stage4Proj, updateDepartments]);
```

**メリット:**
- useAutoSave のすべてのガードが有効
- isFetching チェックが自動で行われる
- 複数回の progress 編集が 1 回の save にまとめられる

**デメリット:**
- 即座に save されない（autosave debounce 待つ）

#### 案2: isFetching チェックを追加

```typescript
const onProgressChange = useCallback((field, oldValue, newValue) => {
  const state = useStrategyStore.getState();

  // ★ isFetching/hydrating チェック
  if (state.__isFetchingFromServer || state.boot?.isHydrating) {
    // skip and let autosave handle it
    state.setState({ dirty: true });
    return;
  }

  // normal save
  (async () => {
    const result = await state.saveStrategyData({ reason: 'progress_change' });
    // ...
  })();
}, [di, pi, isVariant, stage4Proj, updateDepartments]);
```

**メリット:**
- fetch/hydrate 中は save をスキップ
- ほぼ即座に save（hydrating=false の場合）

**デメリット:**
- 手動でガード追加
- 複数の save 経路（manual + autosave）

#### 案3: reason='progress_change' を廃止

**現在のコードを削除:**

```typescript
// 削除：const onProgressChange = ... (LINE 977-1016)
// → useAutoSave のみで管理
```

**メリット:**
- シンプル
- save 経路が統一（useAutoSave のみ）

**デメリット:**
- progress input の即座性が低くなる

### Q5: STAGE4 修正に影響しない理由

**A: STAGE4 修正は STAGE5 の hydrating guard 問題を解決しない**

#### 理由1: STAGE5 は独立した loadAndHydrate を持つ

```typescript
// okr/page.tsx （STAGE4） - ★ 修正済み
try {
  await refetchFromServer?.();  // 常に実行
  setHydrated?.(true);
} catch { }

// execution/page.tsx （STAGE5）- ★ 独立
useEffect(() => {
  store.loadAndHydrate(accessCompanyId);
}, [accessCompanyId, hydrated, scopeCompanyId]);
```

#### 理由2: setCompanyScope で hydrating がリセットされる

```typescript
// strategyStore.ts:1890 - setCompanyScope
isHydrating=true, isFetching=true, isRestoring=true, restoreReady=false
```

STAGE4 修正で restoreReady=true になっても、STAGE5 で setCompanyScope が呼ばれると、また hydrating が立つ。

#### 理由3: API latency がブロックする

```
STAGE4 修正: refetch 常実行 → restoreReady=true 確実
  ↓
STAGE5 に遷移
  ↓
loadAndHydrate 実行 → refetchFromServer start → hydrating=true
  ↓
API call (Network 2-5秒)
  ↓
この間にユーザーが save → hydrating=true でブロック
```

STAGE4 修正では「API latency 中のブロック」は解決できない。

---

## VII. 実装アクション

### 即座に実装すべきこと：なし

理由：
- force:true は危険（実装しない）
- 代替案を選択する必要がある（ユーザーが選ぶべき）

### ユーザーの選択が必要

1. **autosave の扱い（案1-3 から選択）**
2. **manual save の扱い（案A-B から選択）**

---

## VIII. 付録：safety matrix

### Guard 迂回リスク評価表

| Guard | Line | 目的 | force:true で迂回 | 迂回時のリスク | 重要度 |
|-------|------|------|-----------|------------|--------|
| fetch/hydrate | 3281 | API 実行中の save を防ぐ | ✅ | 🟠 中 | 🟡 Medium |
| **master** | **3318** | **restoreReady=false で save しない** | **✅** | **🔴 高** | **🔴 Critical** |
| revision | 3363 | revision がない state で save しない | ✅ | 🟠 中 | 🟡 Medium |
| dirty | 3396 | 変更がない autosave をスキップ | ✅ | 🟢 低 | 🟢 Low |

### 各 save 呼び出しの安全性（force:true なし）

| Save | 呼び出し | 通常時 | racing 時 | 推奨 |
|------|---------|--------|----------|------|
| onSaveCheckin | manual button | 安全 | skip | wait or disable |
| onSaveFeedback | manual button | 安全 | skip | wait or disable |
| onEditProgress | input change | 安全 | skip | dirty flag or guard |

