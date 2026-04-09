# force: true パラメータの詳細分析と安全性評価

**作成日**: 2026-04-09
**対象**: STAGE5 save call における `force: true` の可否判断
**目的**: force パラメータが迂回する保護と、各 save 呼び出しでの安全性を詳細に検証

---

## A. force パラメータが迂回する保護

### 1️⃣ First Guard: fetch/hydrate guard（LINE 3281）

```typescript
// strategyStore.ts:3281-3314
const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
if (willSkip) {
  console.warn('[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)');
  return { ok: false, skipped: true, reason: 'fetching_or_hydrating' };
}
```

**何をスキップするか:**
- Network API call 中の save を禁止する
- hydrating フラグが立っている間の save を禁止する

**目的:**
- API call の最中に local edits を save して、サーバーデータと conflict するのを防ぐ
- hydrate 中に不完全なデータで上書きするのを防ぐ

**force=true での動作:**
- このチェックを完全にスキップ
- hydrating=true でも isFetching=true でも save を実行

**リスク度:** 🟡 中程度（後続の guard で補強される）

---

### 2️⃣ Second Guard: Master guard（LINE 3318）

```typescript
// strategyStore.ts:3317-3341
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  console.warn('[SAVE_BLOCKED] unhydrated/unrestored state - preventing data loss', {
    hydrated: state0.hydrated,
    restoreReady: state0.restoreReady,
    isRestoring: state0.isRestoring,
  });
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}
```

**何をスキップするか:**
- `hydrated=false` の状態での save を禁止
- `restoreReady=false` の状態での save を禁止
- `isRestoring=true` の状態での save を禁止

**目的:**
- localStorage rehydrate 未完了で save しない
- サーバーからの restore 未完了で save しない
- restore 処理中に競合する save を禁止

**force=true での動作:**
- このチェックを完全にスキップ
- restoreReady=false でも save を強制実行

**🔴 CRITICAL リスク度: 非常に高い**

**具体的なシナリオ:**
```
T0: setCompanyScope 実行
  → boot.isHydrating = true
  → __isFetchingFromServer = true
  → restoreReady = false (まだサーバーから復元されていない)

T1: refetchFromServer API call 実行中
  → Network latency (2-5秒)

T2: この時点でユーザーがチェックイン記録ボタンをクリック
  → onSaveCheckin 実行
  → saveStrategyData({ reason: 'manual' }) 呼び出し

T3（force=true の場合）:
  → LINE 3281 guard をスキップ ✓
  → LINE 3318 master guard をスキップ ❌
  → restoreReady=false のまま save 実行
  → データベースに保存される

T4: refetchFromServer finally ブロック実行
  → restoreReady = true に設定
  → サーバーデータが復元される

【結果】
T3 で restoreReady=false のまま save → データベースに記録
T4 で restoreReady=true → サーバーからの復元でデータが上書きされる可能性
```

---

### 3️⃣ Third Guard: revision チェック（LINE 3363）

```typescript
// strategyStore.ts:3363-3372
if (!force && (state0.revision === undefined || state0.revision === null)) {
  console.warn('[SAVE_BLOCKED] missing revision', {
    revision: state0.revision,
    hydrated: state0.hydrated,
    restoreReady: state0.restoreReady,
  });
  return { ok: false, skipped: true, reason: 'no_revision' };
}
```

**何をスキップするか:**
- revision が null/undefined の状態での save を禁止

**目的:**
- 最初のロードが完全でない状態で save しない
- revision のない save は、バージョン管理が機能しない

**force=true での動作:**
- revision チェックをスキップ
- revision が不明な状態で save を強制実行

**リスク度:** 🟠 高い（バージョン管理が破綻する可能性）

---

### 4️⃣ Fourth Guard: dirty チェック（LINE 3396）

```typescript
// strategyStore.ts:3394-3399
const isManual = reason === 'manual';
if (!force && !isManual && !state0.dirty) {
  if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip');
  return { ok: false, skipped: true, reason: 'dirty_false' };
}
```

**何をスキップするか:**
- dirty=false（変更なし）で autosave を禁止

**対象:** autosave のみ

**重要:** `reason='manual'` では自動的にこのチェックはスキップされる

**force の関連:** dirty チェックに関しては、force:true でも force:false でも、reason='manual' なら関係ない

---

## B. 各 save 呼び出しのコンテキスト分析

### 1️⃣ onSaveCheckin（チェックイン記録）

**ファイル:** `/app/execution/page.tsx:603`

```typescript
const onSaveCheckin = useCallback(async () => {
  // ... progress_logs を DB に INSERT ...
  useStrategyStore.getState().setOKRTargetScore(okrId, rating);
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
  // ...
}, [/* deps */]);
```

**呼び出しトリガー:**
- ユーザーが「記録する」ボタンをクリック
- 明示的なユーザー操作

**呼び出し時点での状態の可能性:**

| シナリオ | hydrated | restoreReady | hydrating | isFetching | 説明 |
|---------|----------|-------------|-----------|-----------|------|
| ✅ Normal | true | true | false | false | 通常フロー - save が成功する |
| ⚠️ During refetch | true | false | true | true | STAGE5 初期化中に記録ボタン押下 |
| 🔴 Broken restore | false | false | true | true | restore が失敗している |

**force=true を指定した場合の影響:**

| シナリオ | 現在の動作 | force=true の動作 | リスク |
|---------|----------|-----------|--------|
| Normal | save 成功 | save 成功 | なし |
| During refetch | fetch/hydrate guard で SKIP | force で強制実行 → restoreReady=false で保存 | 🔴 高 |
| Broken restore | master guard で SKIP | force で強制実行 → restoreReady=false で保存 | 🔴 高 |

**分析:**

onSaveCheckin はユーザーの明示的なボタンクリックによるため、理論的には「ユーザーが意図的に保存している」という観点では正当化されます。しかし：

- **restoreReady=false の状態で force 実行すると、何が起きるか不定**
  - refetchFromServer の API call 結果がどのタイミングで反映されるか不確実
  - local edit と server restore のタイミング競合が発生する可能性

- **実際の問題: Normal フローでは restoreReady=true であるはず**
  - STAGE4 から STAGE5 への遷移時、既に refetch が完了している
  - During refetch のシナリオは「異常に早く記録ボタンを押した」という稀な場合

---

### 2️⃣ onSaveFeedback（フィードバック保存）

**ファイル:** `/app/execution/page.tsx:819`

```typescript
const onSaveFeedback = useCallback(async () => {
  // ... feedback_logs を DB に INSERT ...
  useStrategyStore.getState().setOKRTargetScore(okrId, reviewScore);
  await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
  // ...
}, [/* deps */]);
```

**呼び出しトリガー:**
- ユーザーが「フィードバックを保存」ボタンをクリック
- 明示的なユーザー操作

**コンテキスト:**
- onSaveCheckin と同じロジック
- ユーザーのボタンクリック操作
- チェックイン完了後のフィードバック入力

**分析:**
- onSaveCheckin と同じリスク/メリット評価

---

### 3️⃣ onEditProgress（progress input autosave）

**ファイル:** `/app/execution/page.tsx:993`

```typescript
(async () => {
  try {
    const state = useStrategyStore.getState();
    const result = await state.saveStrategyData({ reason: 'progress_change' });
    // ...
  } catch (err) {
    // ...
  }
})();
```

**呼び出しトリガー:**
- ユーザーが progress input フィールドに数値を入力
- debounce をバイパスして直接 save（「自動」ではなく「ユーザー入力時の即座」）

**重要な特性:**
- ユーザーが numbers を入力するたびに呼ばれる
- 1 つの input で複数回 save される可能性（ユーザーが数値を修正する場合）
- reason='progress_change' で、reason='manual' ではない

**force=true を入れた場合のリスク:**

```
T0: ユーザーが進捗入力フィールドに数値を入力（例: 50）
T1: onEditProgress 実行 → updateDepartments で store を更新
T2: saveStrategyData({ reason: 'progress_change', force: true }) 呼び出し
T3: ユーザーが同じフィールドを修正（例: 50 → 65）
T4: updateDepartments で store を更新
T5: saveStrategyData({ reason: 'progress_change', force: true }) 呼び出し

【問題】
- T2 の save が restoreReady=false のまま実行される可能性
- T5 の save も同じ問題
- 複数回の save が restoreReady=false で強制実行
- データベース上の revision 管理が混乱する可能性
- 最終的にどのバージョンが "正"なのか不明になる
```

**重大なリスク:**
- autosave 的な呼び出しに force:true を入れると、予期しないデータ損失が起きやすい
- ユーザーが複数回編集する場合、各編集で save が走る → force で每回 restoreReady=false を迂回される

---

## C. master guard（restoreReady チェック）の役割

### なぜ restoreReady が存在するのか

```typescript
// refetchFromServer から restore が完了
// refetchFromServer の finally ブロック で：
// → restoreReady = true に設定
// → boot.isHydrating = false に設定
```

**restoreReady の意味:**
- サーバーから最新のサーバー側データが復元された
- local store と server state が同期している
- save を実行しても conflict しない保証がある

### force で restoreReady チェックを迂回する危険性

```
restoreReady=false の状態で save を強制 = サーバーデータがまだ復元されていない状態で上書き

【具体例】
1. ユーザー A が STAGE5 に入った時点で、server 側に新しいデータがある
2. refetchFromServer で server data を取得中
3. この間にユーザーが progress を入力
4. saveStrategyData({ force: true }) で強制保存
5. restoreReady=true になる前に上書きされるリスク
```

---

## D. 各 save 呼び出しの推奨方針

### 🟢 onSaveCheckin（チェックイン記録）

**推奨:** force:true を入れない

**理由:**
1. Normal フロー では restoreReady は既に true のはず
   - STAGE5 に入る時点で loadAndHydrate が完了している
   - refetch API が2-5秒掛かるとしても、チェックイン記録はそれ以降のユーザー操作

2. restoreReady=false の状態で強制保存のリスクが高い
   - チェックイン内容とサーバーのOKRデータが不整合する可能性
   - revision 管理が破綻する

3. より安全な代替案がある
   - progress_logs は既に Supabase に INSERT されている
   - strategy_data 保存がスキップされても、次の autosave でカバーされる
   - restoreReady=true になるまで待つ方が安全

**代替案（力ブ回避）:**
```typescript
// 案1: useAutoSave に頼る（autosave は restoreReady=true を待つ）
// 案2: wait-restore パターン（restoreReady=true になるまで待つ）
if (!hydrated || !restoreReady) {
  setNotice('データ同期中...数秒お待ちください');
  // retry または wait
  return;
}
await saveStrategyData({ reason: 'manual' });
```

---

### 🟢 onSaveFeedback（フィードバック保存）

**推奨:** force:true を入れない

**理由:** onSaveCheckin と同じ

---

### 🔴 onEditProgress（progress input autosave）

**推奨:** force:true を入れてはいけない

**理由:**
1. autosave (背後で複数回実行) に force は特に危険
2. ユーザーが複数回編集する場合、各編集で saveStrategyData が呼ばれる
   - force:true で毎回 restoreReady チェックをスキップ
   - revision 管理が破綻する可能性が高い

3. progress の値は strategy_data の一部
   - サーバー側で新しい version の strategy_data がある可能性
   - restoreReady=false のまま save すると conflict

**より安全な代替案:**
```typescript
// 案1: autosave を control
if (isHydrating || isFetching) {
  // Save を延期
  // useAutoSave が later に拾う
  return;
}
const result = await state.saveStrategyData({ reason: 'progress_change' });

// 案2: restoreReady 確認
if (!state.restoreReady) {
  console.log('[progress-save] restoreReady=false, skip for now');
  // useAutoSave が later に拾う
  return;
}
const result = await state.saveStrategyData({ reason: 'progress_change' });
```

---

## E. STAGE4 修正との相互影響

### STAGE4 修正の内容（既に実装）

```typescript
// okr/page.tsx:396-417
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
  loadGuardRef.current = accessCompanyId;
}
```

**効果:**
- isDirty=true でも refetch が常に実行される
- restoreReady=true が確実に設定される
- STAGE4 から STAGE5 への遷移時、restoreReady は既に true

### STAGE5 に対する影響

**重要:** STAGE4 修正は STAGE5 のhydrating guard 問題を「直接」解決しない

**理由:**
1. STAGE5 には独立した loadAndHydrate がある
   - execution/page.tsx:1487
   - setCompanyScope で hydrating=true を新たに設定

2. company を変更した場合（cross-company navigation）
   - setCompanyScope で新しい refetch が始まる
   - hydrating, isFetching フラグが再度立つ

3. STAGE4 修正は「STAGE4 のリロード後」には restoreReady=true を保証する
   - しかし「STAGE5 内で新しい company に遷移」には影響しない

**つまり:**
- STAGE4 修正 + STAGE5 force:true = 独立した2つのリスク
- STAGE4 修正は STAGE5 の force:true を正当化しない

---

## F. 最終推奨

### force:true を入れてよいのはどれか

❌ **なし** - force:true は入れるべきではない

### force:true を入れてはいけないのはどれか

✅ **全て** - onSaveCheckin, onSaveFeedback, onEditProgress すべて

### 理由

1. **fetch/hydrate guard をスキップしたい** → 理解できるが、
2. **master guard（restoreReady チェック）を迂回するリスク** > メリット
3. **より安全な代替案がある**

---

## G. より安全な代替案（3 つの修正案）

### 案1: 「待つ」パターン（最安全）

```typescript
// onSaveCheckin / onSaveFeedback
const state = useStrategyStore.getState();
if (!state.restoreReady) {
  // restoreReady になるまで wait
  setNotice('データ同期中です...');
  // setTimeout で retry or useEffect で待つ
  return;
}
await state.saveStrategyData({ reason: 'manual' });
setNotice('✅ 記録しました');
```

**メリット:**
- すべてのガードが有効
- 確実に safe

**デメリット:**
- ユーザーが save ボタンをクリックしても「待つ」状態になる可能性
- UX が悪い可能性

---

### 案2: 「遅延」パターン（execution/page.tsx で制御）

```typescript
// execution/page.tsx の useEffect で、hydrating/isFetching を監視
useEffect(() => {
  const state = useStrategyStore.getState();
  if (state.__isFetchingFromServer || state.boot?.isHydrating) {
    // autosave を disable
    disableAutoSave();
  } else {
    // autosave を enable
    enableAutoSave();
  }
}, []);
```

**メリット:**
- autosave を hydrating 中に延期
- manual save はユーザー操作なので「待つ」で対応

**デメリット:**
- useAutoSave の仕組みを変更する必要
- より複雑

---

### 案3: 「revision verify」パターン（最小修正）

```typescript
// saveStrategyData の後に revision を確認
const result = await state.saveStrategyData({ reason: 'manual' });
if (!result.ok && result.reason === 'fetching_or_hydrating') {
  // 次のサイクルで retry
  set({ _pendingSave: true });
}
```

**メリット:**
- saveStrategyData の内部ロジックを信頼
- existing guard を活用

**デメリット:**
- retry ロジックが必要

---

## H. 最終結論

### 結論1: force:true は使うべきではない

- fetch/hydrate guard だけをスキップしたいのは理解できるが、
- force:true は master guard も迂回するため、restoreReady=false での save が可能になる
- これはデータ破損のリスクが高い

### 結論2: より安全な方法がある

- onSaveCheckin / onSaveFeedback: restoreReady=true になるまで待つ
- onEditProgress: hydrating/fetching 中は autosave を延期する

### 結論3: STAGE4 修正は STAGE5 を完全には解決しない

- STAGE4 修正で restoreReady=true が初期状態で設定されるようになった
- しかし STAGE5 内で setCompanyScope が呼ばれると、hydrating=true に戻される
- force:true を入れることで「一時的に」save できるようになっても、根本解決ではない

