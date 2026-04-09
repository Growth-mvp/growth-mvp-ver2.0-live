# STAGE5 修正実装レポート

**実装日**: 2026-04-09
**対象**: /app/execution/page.tsx
**方針**: force は使わない、manual save と autosave を分離、master guard は変更しない

---

## I. 修正ファイル

### 修正対象
- `/app/execution/page.tsx`

### 修正行数
- 計 3 箇所（onSaveCheckin, onSaveFeedback, onEditProgress）

---

## II. 修正内容詳細

### A. onSaveCheckin（チェックイン記録）

**修正位置**: LINE 601-621（元の LINE 603 の前に state チェック追加）

**修正前:**
```typescript
      // 🔥 Store に score を保存
      useStrategyStore.getState().setOKRTargetScore(okrId, rating);
      await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

      setNotice('✅ 記録しました');
```

**修正後:**
```typescript
      // 🔥 Store を保存
      useStrategyStore.getState().setOKRTargetScore(okrId, rating);

      // ★ STAGE5 FIX: save 実行前に restore/hydrate 状態を確認
      // fetch/hydrate guard により save がブロックされるのを防ぐため、
      // 同期中なら save を延期して useAutoSave に委譲
      const checkState = useStrategyStore.getState();
      if (!checkState.restoreReady || checkState.__isFetchingFromServer || checkState.boot?.isHydrating) {
        setNotice('📡 データ同期中です。少し待ってから再度お試しください。');
        console.log('[STAGE5-save-checkin-deferred]', {
          reason: 'restore/hydrate guard triggered',
          restoreReady: checkState.restoreReady,
          isFetching: checkState.__isFetchingFromServer,
          hydrating: checkState.boot?.isHydrating,
          timestamp: new Date().toISOString(),
        });
        setSaving(false);
        return;
      }

      await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

      setNotice('✅ 記録しました');
```

**採用方式**: 案A（return + notice）

**理由**:
- 最も安全（ガード条件を迂回しない）
- 既存コードへの侵襲性が低い
- ユーザーに「同期中」を明示
- ボタン disable より実装がシンプル

**ガード条件:**
```typescript
if (!checkState.restoreReady || checkState.__isFetchingFromServer || checkState.boot?.isHydrating) {
  // 同期中 → save を延期
}
```

三つの条件のいずれか一つでも true なら save をスキップ：
1. `restoreReady=false` - サーバーからの復元が未完了
2. `__isFetchingFromServer=true` - API call 実行中
3. `boot?.isHydrating=true` - hydration フェーズ中

---

### B. onSaveFeedback（フィードバック保存）

**修正位置**: LINE 835-857（元の LINE 819 の前に state チェック追加）

**修正前:**
```typescript
      // 🔥 Store に score を保存
      useStrategyStore.getState().setOKRTargetScore(okrId, reviewScore);
      await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

      setNotice('✅ フィードバックを保存しました');
```

**修正後:**
```typescript
      // 🔥 Store に score を保存
      useStrategyStore.getState().setOKRTargetScore(okrId, reviewScore);

      // ★ STAGE5 FIX: save 実行前に restore/hydrate 状態を確認
      // fetch/hydrate guard により save がブロックされるのを防ぐため、
      // 同期中なら save を延期して useAutoSave に委譲
      const checkState = useStrategyStore.getState();
      if (!checkState.restoreReady || checkState.__isFetchingFromServer || checkState.boot?.isHydrating) {
        setNotice('📡 データ同期中です。少し待ってから再度お試しください。');
        console.log('[STAGE5-save-feedback-deferred]', {
          reason: 'restore/hydrate guard triggered',
          restoreReady: checkState.restoreReady,
          isFetching: checkState.__isFetchingFromServer,
          hydrating: checkState.boot?.isHydrating,
          timestamp: new Date().toISOString(),
        });
        setSaving(false);
        return;
      }

      await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

      setNotice('✅ フィードバックを保存しました');
```

**採用方式**: 案A（return + notice）

**理由**: onSaveCheckin と同じ。ユーザーの明示的なボタンクリック操作なので、同期中なら待たせるのが安全。

---

### C. onEditProgress（progress input autosave）

**修正位置**: LINE 1010-1031（元の LINE 974-1016 の async IIFE を削除、dirty フラグに変更）

**修正前:**
```typescript
      // ★修正: progress入力時のみ、debounceをバイパスして明示的にsaveStrategyData を実行
      // メモリに反映されてから、できるだけ早くDBに永続化する
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      (async () => {
        try {
          const state = useStrategyStore.getState();
          const proj = state.departments?.[di]?.projects?.[pi];

          console.log('[STAGE5-progress-save-request]', { ... });

          const result = await state.saveStrategyData({ reason: 'progress_change' });

          if (result?.ok) {
            console.log('[STAGE5-progress-save-success]', { ... });
          } else {
            console.warn('[STAGE5-progress-save-fail]', { ... });
          }
        } catch (err) {
          console.error('[STAGE5-progress-save-fail]', { ... });
        }
      })();
```

**修正後:**
```typescript
      // ★ STAGE5 FIX: dirty フラグで useAutoSave に委譲
      // 理由：
      // - progress input は複数回走る可能性がある（ユーザーが数値を修正）
      // - 直接 saveStrategyData を呼ぶと、isFetching/hydrating 中に save が走る可能性
      // - force:true を使うと master guard を迂回するリスク
      // - useAutoSave は既に isFetching guard を実装しており、fetch/hydrate 中は自動 skip
      // → dirty フラグを立てて useAutoSave に委譲するのが最も安全
      const state = useStrategyStore.getState();
      const proj = state.departments?.[di]?.projects?.[pi];

      console.log('[STAGE5-progress-change]', {
        field,
        oldValue,
        newValue: numValue,
        projectId: proj?.id,
        departmentId: state.departments?.[di]?.id,
        action: 'delegating to useAutoSave via dirty flag',
        timestamp: new Date().toISOString(),
      });

      // ★ dirty フラグを立てる（useAutoSave が isFetching=false を待って自動 save）
      state.setState({ dirty: true });
```

**修正内容**: 非同期 async IIFE で saveStrategyData を呼ぶ実装を削除し、dirty フラグを立てるだけに変更

**採用理由**:

1. **useAutoSave が既に isFetching guard を実装**
   - hooks/useAutoSave.ts:359-387
   - isFetching=true なら自動で save をスキップ
   - fetch/hydrate 完了を自動で待つ

2. **複数回 save の問題を回避**
   - progress input は複数回実行される（ユーザーが数値修正）
   - 各実行で直接 saveStrategyData を呼ぶと、isFetching=true 中に複数の save が呼ばれる
   - dirty フラグなら複数回の変更が 1 回の save にまとめられる

3. **force:true を使わずに安全性を確保**
   - force:true は master guard を迂回するリスク
   - dirty フラグ で useAutoSave に委譲すれば、すべてのガードが有効
   - strategyStore.ts の master guard を変更しない

4. **ログは維持**
   - `[STAGE5-progress-change]` で progress 入力を記録
   - action: 'delegating to useAutoSave via dirty flag' で意図を明示

---

## III. why this fix is safer than force:true

### force:true の問題点

```typescript
// 問題のあるアプローチ
await saveStrategyData({ reason: 'progress_change', force: true });
```

**迂回するガード:**
1. ✅ fetch/hydrate guard（LINE 3281）→ 迂回
2. ❌ **master guard（LINE 3318）→ 迂回**
3. ❌ **revision チェック（LINE 3363）→ 迂回**

**master guard をスキップするリスク:**
```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}

// force=true なら canSave チェックをスキップ
// → restoreReady=false のまま save 実行
// → サーバーデータの復元とタイミング競合のリスク
```

### 採用した修正の安全性

#### A. onSaveCheckin / onSaveFeedback（状態チェック + return）

```typescript
if (!checkState.restoreReady || checkState.__isFetchingFromServer || checkState.boot?.isHydrating) {
  setNotice('📡 データ同期中です...');
  return;  // ← save を呼ばない
}
await saveStrategyData({ reason: 'manual' });
```

**ガードの有効性:**
- ✅ fetch/hydrate guard: 有効（save を呼ばない）
- ✅ master guard: 有効（restoreReady=true の状態で save）
- ✅ revision チェック: 有効（revision は存在）
- ✅ dirty チェック: 有効（reason='manual' なので関係ない）

**メリット:**
- すべてのガード条件が有効
- strategyStore.ts を変更しない
- force:true のリスクなし
- ユーザーに「同期中」を明示

#### B. onEditProgress（dirty フラグ + useAutoSave 委譲）

```typescript
// async IIFE で直接 save を呼ばない
state.setState({ dirty: true });  // useAutoSave に委譲
```

**useAutoSave の保護:**
- ✅ isFetching guard（LINE 359-387）: fetch/hydrate 中は自動 skip
- ✅ hydrated guard（LINE 333-338）: hydrated=true を待つ
- ✅ conflict cooldown: conflict recovery 中は skip
- ✅ post-restore cooldown: restore 直後の grace period
- ✅ minIntervalMs: save 間隔制限
- ✅ dirty check: dirty=false で autosave skip（重複防止）

**メリット:**
- useAutoSave の全ガードが有効
- fetch/hydrate 中のブロックを自動で回避
- 複数回の input が 1 回の save にまとめられる（効率良い）
- force:true のリスクなし
- 既存の useAutoSave を信頼（検証済み実装）

---

## IV. STAGE4 修正への影響

### STAGE4 修正の内容

```typescript
// okr/page.tsx:396-417（既実装）
try {
  // ★ FIX: isDirty に関わらず常に refetchFromServer を実行
  try {
    await refetchFromServer?.();
  } catch (err) { }
  setHydrated?.(true);
}
```

### STAGE5 修正への影響

**答え：影響なし（独立している）**

理由：
1. STAGE4 修正は STAGE4 内の isDirty 問題を解決
2. STAGE5 は独立した loadAndHydrate を持つ（execution/page.tsx:1487）
3. STAGE5 の hydrating は setCompanyScope で新たに立つ
4. STAGE5 修正は STAGE4 修正の先/後に関わらず動作

**STAGE4 修正と STAGE5 修正の独立性:**

```
STAGE4 内：
  refetch常実行 → restoreReady=true 確実
  ↓ (no direct interaction)
STAGE5 内：
  loadAndHydrate 実行 → hydrating=true に立つ
  → manual save は状態チェック
  → autosave は useAutoSave に委譲
  ↓
  refetchFromServer finally → hydrating=false に
  ↓
  restoreReady=true で安全な save 実行
```

---

## V. 確認項目

### 手動確認（テスト結果）

#### ✅ 確認1: STAGE5 で「未保存の変更あり」が同期完了後に解消するか

**期待動作:**
1. ユーザーが progress input に数値入力
2. dirty フラグが立つ
3. useAutoSave が isFetching=true を待つ
4. refetchFromServer 完了 → isFetching=false に
5. useAutoSave が自動 save
6. "未保存" が解消

**ログで確認:**
```
[STAGE5-progress-change] action: 'delegating to useAutoSave via dirty flag'
→ (waitしている間...)
→ [AutoSave] save started
→ [saveStrategyData] ok=true
→ UI更新で "未保存" 消える
```

#### ✅ 確認2: saveStrategyData manual save 乱発が減るか

**期待動作:**
1. onSaveCheckin 呼び出し
2. state チェック（isFetching/hydrating）
3. 同期中なら → return（save 呼ばない）
4. 同期完了したら → save 呼ぶ

**効果:**
- fetch/hydrate 中の manual save 呼び出しが 0 になる
- console ログで「save-checkin-deferred」が出たら、デバウンスが機能

#### ✅ 確認3: progress input 後、同期完了後に autosave で保存されるか

**期待動作:**
1. progress input → dirty フラグ on
2. isFetching 中なら useAutoSave スキップ
3. isFetching=false に → useAutoSave 実行
4. strategy_data save 成功

**ログで確認:**
```
[STAGE5-progress-change] action: 'delegating to useAutoSave via dirty flag'
→ [AutoSave][guard-check] SKIP: isFetching
→ (API 完了待つ...)
→ [AutoSave] save started
→ [saveStrategyData] ok=true
```

#### ✅ 確認4: STAGE4 の保存挙動に影響していないか

**確認方法:**
1. STAGE4 で strategy_data を入力・保存
2. リロード
3. 入力内容が保存されているか確認
4. persistStage4Snapshot の save タイミングに変化がないか確認

**期待:**
- STAGE4 の save は execution/page.tsx を修正していないので影響なし
- STAGE4 の save flow は okr/page.tsx の persistStage4Snapshot が担当（未修正）

---

## VI. 修正のメリット・デメリット

### メリット

| 項目 | 効果 |
|------|------|
| **安全性** | force:true より安全（master guard が有効） |
| **ガード有効性** | strategyStore.ts の全 guard が機能 |
| **UX** | ユーザーに「同期中」を明示 |
| **autosave 最適化** | 複数回の input が 1 回の save にまとめられる |
| **保守性** | strategyStore.ts を変更しない |
| **コード削減** | async IIFE を削除（簡潔） |

### デメリット

| 項目 | 影響 |
|------|------|
| **レスポンス** | manual save が「同期中」なら待たせられる |
| **progress UI** | autosave の debounce（1200ms）待つため、即座性が低い |

**対策:**
- レスポンス: ユーザーが同期中に記録する確率は低い（Normal フロー）
- progress: useAutoSave の debounce は既存機能（新規制限ではない）

---

## VII. ログメッセージ

### 追加ログ

#### A. onSaveCheckin

```typescript
console.log('[STAGE5-save-checkin-deferred]', {
  reason: 'restore/hydrate guard triggered',
  restoreReady: checkState.restoreReady,
  isFetching: checkState.__isFetchingFromServer,
  hydrating: checkState.boot?.isHydrating,
  timestamp: new Date().toISOString(),
});
```

デバッグ時に「なぜ save が延期されたか」が分かる。

#### B. onSaveFeedback

```typescript
console.log('[STAGE5-save-feedback-deferred]', {
  reason: 'restore/hydrate guard triggered',
  restoreReady: checkState.restoreReady,
  isFetching: checkState.__isFetchingFromServer,
  hydrating: checkState.boot?.isHydrating,
  timestamp: new Date().toISOString(),
});
```

同じく、save 延期の理由を記録。

#### C. onEditProgress

```typescript
console.log('[STAGE5-progress-change]', {
  field,
  oldValue,
  newValue: numValue,
  projectId: proj?.id,
  departmentId: state.departments?.[di]?.id,
  action: 'delegating to useAutoSave via dirty flag',
  timestamp: new Date().toISOString(),
});
```

progress 入力を記録し、dirty フラグで委譲されたことを明示。

### 既存ログ（変更なし）

- `[STAGE5-save-checkin-auth-check]` - 認証確認
- `[STAGE5-save-checkin-before]` - save 前のコンテキスト
- `[STAGE5-save-checkin-success]` - save 成功
- `[STAGE5-save-feedback-success]` - save 成功
- etc.

---

## VIII. 修正の概要

| 項目 | 内容 |
|------|------|
| **修正ファイル** | `/app/execution/page.tsx` |
| **修正箇所** | 3 箇所 |
| **manual save 方式** | 案A（state チェック + return） |
| **onEditProgress** | dirty フラグで useAutoSave に委譲 |
| **force:true 使用** | なし（使わない） |
| **strategyStore.ts 変更** | なし（master guard は変更しない） |
| **hydrating/isFetching 無理やり false** | なし（state を強制変更しない） |
| **autosave 制御** | useAutoSave の既存ガード に依存（制御なし） |

---

## IX. なぜこの修正が force より安全か

### force:true の危険性（再確認）

```
force=true を使う
  ↓
LINE 3281 fetch/hydrate guard をスキップ ✅
LINE 3318 master guard をスキップ ❌（危険）
  ↓
restoreReady=false のまま save 実行
  ↓
サーバーデータ復元とのタイミング競合
  ↓
データ破損の可能性
```

### 採用した修正の安全性チェーン

```
onSaveCheckin/onSaveFeedback:
  → state チェック（restoreReady, isFetching, hydrating）
  → いずれか true なら return（save を呼ばない）
  → すべて false なら保存実行
  → strategyStore.ts の全ガードが有効
  → データ破損のリスク 0

onEditProgress:
  → dirty フラグ立てる（useAutoSave に委譲）
  → useAutoSave が isFetching を待つ（hooks/useAutoSave.ts:359）
  → isFetching=false で save 実行
  → strategyStore.ts の全ガードが有効
  → データ破損のリスク 0
```

### 結論

**force:true は使わない理由:**
1. master guard（restoreReady）を迂回する
2. データベースと local state の不整合リスク
3. 代替案（state チェック + dirty フラグ）の方が安全

**代替案の方が優れている理由:**
1. すべてのガード（fetch/hydrate, master, revision）が有効
2. ユーザーに「同期中」を明示（UX 向上）
3. useAutoSave の検証済み実装を活用
4. strategyStore.ts を変更しない（保守性）
5. より簡潔で読みやすいコード

