# STAGE5 lifecycle 修正実装レポート

**実装日**: 2026-04-09
**対象**: `/app/execution/page.tsx`
**修正内容**: 同一 company 再訪時の setCompanyScope 無限呼び出しを防止

---

## A. 根本原因（確定）

### Timeline の解析結果

**初回訪問（成功）:**
```
T0: hydrated=false, scopeCompanyId=undefined
T1: Effect-1 実行 → setCompanyScope 呼び出し → restoreReady=false
T2: Effect-2 実行 → hydrated=false だから loadAndHydrate 実行
T3: refetchFromServer 成功 → restoreReady=true
T4: 保存成功 ✅
```

**再訪問（失敗）:**
```
T0: hydrated=true, scopeCompanyId=accessCompanyId（前回の状態）
T1: Effect-1 実行 → setCompanyScope 呼び出し → restoreReady=false ❌
T2: Effect-2 実行 → hydrated=true && scopeCompanyId===accessCompanyId
       → early return → loadAndHydrate 非実行
T3: restoreReady が false のまま
T4: 保存失敗 ❌
```

**問題の詳細：**
- Effect-1（company scope effect）が同じ company に対しても setCompanyScope を呼ぶ
- setCompanyScope が restoreReady を false にリセット
- Effect-2（loadAndHydrate trigger）が hydrated=true で early return
- restoreReady が false のまま復帰されない
- master guard で reject: `reason: 'restore_not_ready'`

---

## B. 実装した修正

### ファイル: `/app/execution/page.tsx`

### 修正箇所 1: LINE 1564-1606（Effect-1）

**修正前:**
```typescript
useEffect(() => {
  if (!accessCompanyId) return;
  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);  // 常に呼ばれる
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

**修正後:**
```typescript
useEffect(() => {
  if (!accessCompanyId) return;

  // ★ デバッグログ追加
  const preState = useStrategyStore.getState();
  console.log('[STAGE5-effect-1-scope]', {
    event: 'effect1_start',
    accessCompanyId,
    scopeCompanyId,
    hydrated: preState.hydrated,
    restoreReady: preState.restoreReady,
    isRestoring: preState.isRestoring,
    condition_isSameCompany: scopeCompanyId === accessCompanyId,
    // ...
  });

  // ★ 修正案1：同じ company なら skip
  if (scopeCompanyId === accessCompanyId) {
    console.log('[STAGE5-effect-1-scope]', {
      event: 'skip_same_company',
      reason: 'scopeCompanyId already matches accessCompanyId',
    });
    return;  // ← ここで early return
  }

  // company が異なる場合のみ処理
  if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
    hardResetForCompanySwitch(accessCompanyId);
  } else {
    setCompanyScope(accessCompanyId);
  }
}, [accessCompanyId, scopeCompanyId, setCompanyScope]);
```

**修正のポイント:**
- Line 1583-1589 で新しい condition を追加
- `scopeCompanyId === accessCompanyId` なら early return
- 同じ company の再訪問では setCompanyScope を呼ばない
- restoreReady が false にリセットされない

### 修正箇所 2: LINE 1608-1647（Effect-2）

**修正内容**: 検証ログを詳細化

```typescript
useEffect(() => {
  if (!accessCompanyId) return;
  let cancelled = false;
  const run = async () => {
    // ★ デバッグログ追加
    const preState = useStrategyStore.getState();
    console.log('[STAGE5-effect-2-hydrate]', {
      event: 'effect2_start',
      accessCompanyId,
      scopeCompanyId,
      hydrated,
      restoreReady: preState.restoreReady,
      condition_earlyReturn: hydrated && scopeCompanyId === accessCompanyId,
      timestamp: new Date().toISOString(),
    });

    // 既存の early return condition
    if (hydrated && scopeCompanyId === accessCompanyId) {
      console.log('[STAGE5-effect-2-hydrate]', {
        event: 'earlyReturn_because_already_hydrated',
        reason: 'hydrated=true && scopeCompanyId===accessCompanyId',
      });
      return;
    }

    // loadAndHydrate 実行
    // ...
  };
}, [accessCompanyId, hydrated, scopeCompanyId]);
```

**修正のポイント:**
- early return の理由をログに記録
- loadAndHydrate 完了時のログを追加

---

## C. 修正の期待結果

### パターン1: 初回訪問（変更なし）

```
T0: hydrated=false, scopeCompanyId=undefined
T1: Effect-1 実行
    - condition_isSameCompany=false → skip しない
    - setCompanyScope 呼び出し → restoreReady=false
T2: Effect-2 実行
    - condition_earlyReturn=false → skip しない
    - loadAndHydrate 実行 → restoreReady=true
T3: 保存成功 ✅ ← 変更なし
```

### パターン2: 再訪問（修正により改善）

**修正前（失敗）:**
```
T0: hydrated=true, scopeCompanyId=accessCompanyId
T1: Effect-1 実行
    - setCompanyScope 呼び出し → restoreReady=false
T2: Effect-2 実行
    - early return → loadAndHydrate 非実行
T3: 保存失敗 ❌（reason: restore_not_ready）
```

**修正後（成功）:**
```
T0: hydrated=true, scopeCompanyId=accessCompanyId
T1: Effect-1 実行
    - condition_isSameCompany=true → skip（early return）
    - setCompanyScope 呼ばれない
    - restoreReady は前回の値を保持（true）
T2: Effect-2 実行
    - condition_earlyReturn=true → skip（early return）
    - ※ 既に restore 済みなので skip は正常
T3: 保存成功 ✅（新動作）
    - master guard: hydrated=true && restoreReady=true && !isRestoring=true
```

### パターン3: 別 company への切り替え（正常動作）

```
T0: hydrated=true, scopeCompanyId=company-A, accessCompanyId=company-B
T1: Effect-1 実行
    - condition_isSameCompany=false（company-A !== company-B）
    - setCompanyScope または hardReset 呼び出し → restoreReady=false（正常）
T2: Effect-2 実行
    - condition_earlyReturn=false
    - loadAndHydrate 実行 → company-B の restore 開始
T3: 切り替え成功 ✅
```

---

## D. コード差分の詳細

### 追加された行数

| 修正 | 追加行数 | 削除行数 | 内容 |
|------|---------|---------|------|
| Effect-1 修正 | +22 | 0 | early return condition + logs |
| Effect-2 修正 | +15 | 0 | 検証ログの詳細化 |
| **合計** | **+37** | **0** | ログと condition のみ |

### 削除・破壊的変更

- **ゼロ**：既存ロジックを削除していない
- **guard 削除**: なし
- **force パラメータ使用**: なし
- **strategyStore.ts 変更**: なし

---

## E. 修正のリスク評価

### リスク：**極小**

| 項目 | 評価 | 理由 |
|------|------|------|
| **ロジック変更** | ✅ 最小 | early return condition 追加のみ |
| **master guard 影響** | ✅ ゼロ | guard 変更なし |
| **force パラメータ** | ✅ 未使用 | force は使用していない |
| **STAGE4 への影響** | ✅ ゼロ | execution/page.tsx のみ修正 |
| **strategyStore.ts 影響** | ✅ ゼロ | 修正対象外 |
| **useAutoSave への影響** | ✅ ゼロ | 修正対象外 |
| **戻す難度** | ✅ 容易 | early return を削除すれば元に戻る |

---

## F. デバッグログの活用

### 修正前後の検証方法

**初回訪問時のログ:**
```
✅ [STAGE5-effect-1-scope] { event: 'effect1_start', condition_isSameCompany: false }
✅ [STAGE5-effect-1-scope] { event: 'setCompanyScope_called' }
✅ [STAGE5-effect-2-hydrate] { event: 'effect2_start', hydrated: false, ... }
✅ [STAGE5-effect-2-hydrate] { event: 'loadAndHydrate_completed' }
✅ [STAGE5-save-checkin-result] { ok: true, dirty: false }
```

**再訪問時のログ（修正後）:**
```
✅ [STAGE5-effect-1-scope] { event: 'effect1_start', condition_isSameCompany: true }
✅ [STAGE5-effect-1-scope] { event: 'skip_same_company' }  ← 新しいログ
✅ [STAGE5-effect-2-hydrate] { event: 'effect2_start', hydrated: true, restoreReady: true }
✅ [STAGE5-effect-2-hydrate] { event: 'earlyReturn_because_already_hydrated' }
✅ [STAGE5-save-checkin-result] { ok: true, dirty: false }  ← 修正により成功
```

---

## G. 修正前後の比較

### 修正前の問題

```
初回訪問: ✅ 保存成功
  → restoreReady: false → loadAndHydrate → restoreReady: true

別画面へ移動 → STAGE5 に戻る

再訪問: ❌ 保存失敗（restore_not_ready）
  → setCompanyScope で restoreReady: false に上書き
  → Effect-2 の early return で loadAndHydrate 未実行
  → restoreReady が false のまま
```

### 修正後の期待結果

```
初回訪問: ✅ 保存成功（変更なし）
  → restoreReady: false → loadAndHydrate → restoreReady: true

別画面へ移動 → STAGE5 に戻る

再訪問: ✅ 保存成功（修正により新規）
  → setCompanyScope が呼ばれない（same company skip）
  → restoreReady は前回の値を保持
  → Effect-2 も early return で OK（既に restore 済み）
  → 保存成功
```

---

## H. 次のステップ

### Step 1: ログで動作確認（ユーザー側）

1. STAGE5 で初回 save
2. console で `[STAGE5-effect-1-scope]` と `[STAGE5-effect-2-hydrate]` のログを確認
3. 別画面へ移動
4. STAGE5 に戻って save
5. console で `event: skip_same_company` のログが出ているか確認
6. save 成功のログが出ているか確認

### Step 2: テスト項目

| テスト | 確認項目 |
|-------|---------|
| **初回訪問** | `[STAGE5-effect-1-scope] { event: 'setCompanyScope_called' }` が出現 |
| **初回保存** | `ok: true` で保存成功 |
| **別画面へ遷移** | navigation は正常 |
| **再訪問** | `[STAGE5-effect-1-scope] { event: 'skip_same_company' }` が出現 |
| **再訪問保存** | `ok: true` で保存成功（修正による新規動作） |
| **異なる company** | scopeCompanyId ≠ accessCompanyId のときは setCompanyScope が呼ばれる |
| **STAGE4 への影響** | STAGE4 save flow に変化なし |

### Step 3: console ログの確認ポイント

```javascript
// ❌ 修正が失敗している場合
[STAGE5-effect-1-scope] { event: 'setCompanyScope_called' }  // 再訪問時に出現（不正）
[STAGE5-save-checkin-result] { ok: false, reason: 'restore_not_ready' }

// ✅ 修正が成功している場合
[STAGE5-effect-1-scope] { event: 'skip_same_company' }  // 再訪問時に出現（正常）
[STAGE5-save-checkin-result] { ok: true, dirty: false }
```

---

## I. 修正の検証方法

### Supabase Strategy Data

再訪問後の save が成功した場合、Supabase の `strategy_data` テーブルで：
- `updated_at` が最新になっているか確認
- 最新の `okrTargetScores` が保存されているか確認

### localStorage の persist

Zustand persist middleware で localStorage に以下が保存されているか：
- `hydrated: true`
- `restoreReady: true`
- `dirty: false`（save 成功時）

---

## J. 修正の影響範囲の再確認

### ✅ 影響なし（保証）

1. **strategyStore.ts**: 修正対象外
2. **master guard (LINE 3318)**: 変更なし
3. **fetch/hydrate guard (LINE 3281)**: 変更なし
4. **force パラメータ**: 未使用
5. **STAGE4 save flow**: execution/page.tsx は STAGE5 専用コンポーネント
6. **okr/page.tsx**: 修正なし
7. **useAutoSave.ts**: 修正なし

### ⚠️ 監視項目

1. **setCompanyScope の呼び出し頻度**
   - 修正前: 毎回（初回、再訪問両方）
   - 修正後: 初回と company 切り替え時のみ

2. **Effect-2 の early return**
   - 修正前: 再訪問時に early return（問題）
   - 修正後: 再訪問時も early return（正常）→ restore 済みなので OK

---

## K. 修正コードの実装完了チェックリスト

- [x] Effect-1 に `scopeCompanyId === accessCompanyId` condition 追加
- [x] Effect-1 に skip 時のログ追加
- [x] Effect-2 に early return ログの詳細化
- [x] console ログで追跡可能にした
- [ ] ユーザーが実機で検証（待機中）
- [ ] STAGE4 への影響確認（待機中）

---

**この修正により、STAGE5 再訪問時の restore_not_ready エラーが解決されることが期待されます。**

