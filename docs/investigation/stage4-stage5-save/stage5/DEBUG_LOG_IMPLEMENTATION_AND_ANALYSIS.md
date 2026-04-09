# restore_not_ready デバッグログ実装と分析ガイド

**実装日**: 2026-04-09
**対象**: /app/execution/page.tsx（onSaveCheckin, onSaveFeedback）
**目的**: restore_not_ready が発生する直接原因を console ログから特定

---

## A. 実装した修正差分

### 修正対象ファイル

`/app/execution/page.tsx`

### 修正1：onSaveCheckin（LINE 621-634）

**追加内容:**
```typescript
// ★ STAGE5 restore_not_ready デバッグ：save 前の state を記録
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
  timestamp: new Date().toISOString(),
});

// その直後に saveStrategyData を呼び出し
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
```

**挿入位置**:
- fetch/hydrate guard チェック直後（LINE 620）
- saveStrategyData 呼び出し直前（LINE 637）

### 修正2：onSaveFeedback（LINE 890-903）

**追加内容:** onSaveCheckin と同じ
（ログ名は `[STAGE5-save-feedback-before-saveStrategyData]`）

**挿入位置:** fetch/hydrate guard チェック直後

---

## B. 実際の console 出力パターン

### パターン1：restore_not_ready が発生する場合（異常系）

```javascript
// ===== ログ時系列 =====

// [T0] STAGE5 初期化開始
[execution] 📥 loadAndHydrate 開始 {
  accessCompanyId: "company-xxx"
}

// [T1] refetchFromServer 実行
[refetchFromServer:start] 🔄 Fetch started {
  companyId: "company-xxx",
  timestamp: "2026-04-09T12:00:00.000Z",
  currentHydrating: true
}

// [T2] API call 実行中...（Network latency 2-5秒）

// [T3] チェックインボタンをユーザーが押下
// ↓ saveStrategyData 呼び出し直前のログ
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: true,           // ← hydrated は true
  restoreReady: false,      // ← 🔴 restoreReady: false（これが原因！）
  isRestoring: true,        // ← 🔴 isRestoring: true（restore 処理中）
  __isFetchingFromServer: true,  // ← API call 実行中
  'boot.isHydrating': true,      // ← hydrating 中
  dirty: true,              // ← setOKRTargetScore で dirty: true
  loaded: false,            // ← restore 中なので false
  companyId: "company-xxx",
  pendingCompanyId: "company-xxx",
  timestamp: "2026-04-09T12:00:03.456Z"  // ← T0 から 3.4 秒後
}

// ↓ saveStrategyData 実行
[saveStrategyData:skip-flags] {
  hydrated: true,
  isFetching: true,
  restoring: true,
  hydrated: true,
  restoreReady: false,  // ← master guard の条件チェック
  reason: 'manual',
  force: false,
  willSkip: true,
  skipReasons: ['restoreReady=false (2つ目のguard)'],
  timestamp: "2026-04-09T12:00:03.500Z"
}

// ↓ saveStrategyData skip
[saveStrategyData:SKIPPED] skip while ... (後続)... {
  reason: 'manual',
  ...
}

// ↓ result.ok=false の結果
[STAGE5-save-checkin-result] {
  ok: false,
  reason: "restore_not_ready",  // ← master guard で ブロック
  dirty: true,
  timestamp: "2026-04-09T12:00:03.520Z"
}

// [T4] API call が完了（T0 から約 5 秒後）
[refetchFromServer:done] ✅ Fetch and restore complete (wasDirty=false) {
  timestamp: "2026-04-09T12:00:05.000Z",
  revision: 42
}

// ↓ restore 完了時に restoreReady: true に設定
// （ただし、T3 の save はこの前に発生しているので、restore_not_ready になる）
```

### パターン2：restore_not_ready が発生しない場合（正常系）

```javascript
// ===== ログ時系列 =====

// [T0] STAGE5 初期化開始
[execution] 📥 loadAndHydrate 開始 {
  accessCompanyId: "company-xxx"
}

// [T1] refetchFromServer 実行
[refetchFromServer:start] 🔄 Fetch started {
  companyId: "company-xxx",
  timestamp: "2026-04-09T12:10:00.000Z"
}

// [T2] API call 実行中...（Network latency 2-5秒）

// [T3] API call が完了（約 5 秒後）
[refetchFromServer:done] ✅ Fetch and restore complete {
  timestamp: "2026-04-09T12:10:05.000Z"
}

// [T4] 数秒後、ユーザーがチェックインボタンをクリック
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: true,           // ✅ true
  restoreReady: true,       // ✅ true（restore 完了）
  isRestoring: false,       // ✅ false
  __isFetchingFromServer: false,  // ✅ false
  'boot.isHydrating': false,      // ✅ false
  dirty: true,
  loaded: true,
  companyId: "company-xxx",
  pendingCompanyId: "company-xxx",
  timestamp: "2026-04-09T12:10:08.234Z"
}

// ↓ saveStrategyData 実行
[saveStrategyData:skip-flags] {
  hydrated: true,
  isFetching: false,
  restoring: false,
  hydrated: true,
  restoreReady: true,  // ✅ master guard の条件 OK
  reason: 'manual',
  force: false,
  willSkip: false,     // ← skip されない
  skipReasons: [],
  timestamp: "2026-04-09T12:10:08.250Z"
}

// ↓ saveStrategyData 成功
[STAGE5-save-checkin-result] {
  ok: true,            // ✅ 成功
  dirty: false,        // ← dirty が false に設定される
  timestamp: "2026-04-09T12:10:08.300Z"
}
```

---

## C. 時系列分析ガイド

### Step 1：console で以下を探す

**必須ログ（出ているはず）:**
```
[STAGE5-save-checkin-before-saveStrategyData]
[STAGE5-save-checkin-result]
```

**参考ログ（出ている場合と出ていない場合がある）:**
```
[execution] 📥 loadAndHydrate 開始
[refetchFromServer:start] 🔄 Fetch started
[refetchFromServer:done] ✅ Fetch and restore complete
[refetchFromServer:error] ❌ Data fetch failed
```

### Step 2：時系列を確認

```
[loadAndHydrate] 開始 ... (最後に出た時刻)
  ↓
... (何秒待つ)
  ↓
[STAGE5-save-checkin-before-saveStrategyData] ... (save 呼び出し時刻)
  ↓
... (差分: 何秒?)
  ↓
[refetchFromServer:done] ... (restore 完了時刻)
```

**重要:** save 時刻と restore 完了時刻を比較

### Step 3：save 前ログから何が false か確認

```javascript
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: ?,           // true or false?
  restoreReady: ?,       // true or false?
  isRestoring: ?,        // true or false?
  __isFetchingFromServer: ?,
  'boot.isHydrating': ?,
}
```

---

## D. 原因候補の判定ロジック

### 🔴 第一候補：refetchFromServer が API エラーで失敗

**確認方法:**
```
console に以下のログがある?
[refetchFromServer:error] ❌ Data fetch failed
```

**該当時の save 前ログの特徴:**
```javascript
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: true,
  restoreReady: false,    // ← 重要
  isRestoring: true,
  __isFetchingFromServer: true,
  'boot.isHydrating': true,  // ← API 実行中
}

[STAGE5-save-checkin-result] {
  reason: "restore_not_ready"
}
```

**判定:**
- `[refetchFromServer:error]` ログが出ている
- `restoreReady: false` のまま
- **→ 第一候補が濃厚**

**次のステップ:** API エラーの errorCode / errorStatus を確認

---

### 🟠 第二候補：refetchFromServer が実行されていない

**確認方法:**
```
console に以下のログがない?
[execution] 📥 loadAndHydrate 開始
[refetchFromServer:start] 🔄 Fetch started
```

**該当時の save 前ログの特徴:**
```javascript
[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: true or false,
  restoreReady: false,    // ← false のまま
  isRestoring: false,
  __isFetchingFromServer: false,  // ← API 呼ばれていない
  'boot.isHydrating': false,
}

[STAGE5-save-checkin-result] {
  reason: "restore_not_ready"
}
```

**判定:**
- `[loadAndHydrate]` ログが出ていない OR 出ていても古い時刻
- `__isFetchingFromServer: false, boot.isHydrating: false`
- restoreReady は false のまま
- **→ 第二候補が濃厚**

**次のステップ:** execution/page.tsx:1547 の condition を確認

---

### 🟡 第三候補：refetchFromServer 完了後に false に戻されている

**確認方法:**
```
console の時系列を見て：
[refetchFromServer:done] ... (restore 完了)
  ↓ ... (時間経過)
  ↓
[STAGE5-save-checkin-before-saveStrategyData] (save 呼び出し時)
```

**該当時の save 前ログの特徴:**
```javascript
// restore 完了してから時間が経っているのに
[refetchFromServer:done] ✅ ... timestamp: "2026-04-09T12:00:05.000Z"

... (数分経過) ...

[STAGE5-save-checkin-before-saveStrategyData] {
  hydrated: true,
  restoreReady: false,    // ← 完了後なのに false に戻っている
  isRestoring: false,
  __isFetchingFromServer: false,
  'boot.isHydrating': false,
  timestamp: "2026-04-09T12:05:00.000Z"  // ← 5 分も後
}
```

**判定:**
- refetchFromServer:done が出ている（restore は完了）
- しかし save 時には restoreReady: false
- 時間差が数秒以上ある
- **→ 第三候補が濃厚（画面遷移 / modal close など）**

**次のステップ:** setCompanyScope が何度呼ばれているか、modal の開閉タイミングを確認

---

## E. console 出力の読み方まとめ

### パターン判定チャート

```
restore_not_ready が出たとき：

Q1: [refetchFromServer:error] ログがあるか?
    YES → 第一候補（API エラー）
    NO → Q2 へ

Q2: [loadAndHydrate] ログが出ているか? （or [refetchFromServer:start]）
    YES → Q3 へ
    NO → 第二候補（実行されていない）

Q3: [refetchFromServer:done] ログがあるか?
    YES → Q4 へ
    NO → 第一候補の可能性（エラーで finish していない）

Q4: 時間差は何秒か?
    < 10秒 → 第一候補（API 遅い）
    >= 10秒 → 第三候補（restore 後に false に戻された）
```

---

## F. 実装内容サマリー

### 追加した修正

| 項目 | 内容 |
|------|------|
| **修正ファイル** | `/app/execution/page.tsx` |
| **追加箇所** | 2 箇所（onSaveCheckin + onSaveFeedback） |
| **追加行数** | 合計 ~30 行（ログのみ） |
| **ロジック変更** | ❌ なし（コードの動作は変わらない） |
| **パフォーマンス影響** | 最小（console.log のみ） |

### ログ項目（11 個）

1. `hydrated` - localStorage rehydrate 完了フラグ
2. `restoreReady` - サーバー restore 完了フラグ 🔴 重要
3. `isRestoring` - restore 処理中フラグ
4. `__isFetchingFromServer` - API call 実行中フラグ
5. `boot.isHydrating` - hydration フェーズ中フラグ
6. `dirty` - 未保存フラグ
7. `loaded` - load 完了フラグ
8. `companyId` - 現在の company
9. `pendingCompanyId` - 待機中の company（company 切替時）
10. `timestamp` - ログ時刻（時系列確認用）

---

## G. 次のステップ（最小修正案）

### 現在のステップ：デバッグログから原因判定（このステップ）

1. ✅ デバッグログを実装（済み）
2. ✅ console 出力を確認（ユーザーが実施）
3. ✅ 第一/二/三候補を判定（ユーザーが実施）

### 次のステップ：最小修正を実装

判定結果に基づいて、以下のいずれかを実装：

#### A. 第一候補が濃厚な場合（API エラー）

**修正:** getFullStrategyDataByCompany の retry 回数を増やす
- 現在：失敗時に throw するだけ
- 修正案：exponential backoff で自動 retry

**リスク:** 低（既存の error handling を強化するだけ）

#### B. 第二候補が濃厚な場合（loadAndHydrate が実行されていない）

**修正:** execution/page.tsx:1547 の condition を見直す

```typescript
// 現在：
if (hydrated && scopeCompanyId === accessCompanyId) return;

// 修正案：
// scopeCompanyId !== accessCompanyId なら常に loadAndHydrate を実行
if (hydrated && scopeCompanyId === accessCompanyId) return;
// → より詳細な condition チェック
```

**リスク:** 中（condition の意図を理解してから修正が必要）

#### C. 第三候補が濃厚な場合（restore 後に false に戻された）

**修正:** setCompanyScope が不要に呼ばれているのをを確認 / 削除

**リスク:** 高（UX に関わる可能性がある）

---

## H. 分析後の結論テンプレート

ユーザーが console を確認した後、以下のような結論を出します：

```
【第一候補 / 第二候補 / 第三候補 のどれが最も濃厚か】

根拠：
- [refetchFromServer:error] ログ: YES/NO
- [loadAndHydrate] ログ: YES/NO （最後に出た時刻）
- [refetchFromServer:done] ログ: YES/NO （時刻）
- save 前ログの restoreReady: true/false
- save 前ログの __isFetchingFromServer: true/false
- 時間差：X 秒

結論：
→ 第●候補が最も濃厚

【次に入れる最小修正案】

1. 修正ファイル：[●●●]
2. 修正内容：[●●●]
3. 修正リスク：[低/中/高]
4. 期待効果：restore_not_ready が消える / 減る
```

---

## I. まとめ

このデバッグログで、以下が確認できます：

✅ master guard の 3 つの条件がすべて見える
✅ どれが false なのかが明確
✅ restore 完了のタイミングが見える
✅ API call の実行状況が見える
✅ 時系列で原因が特定できる

**このログを確認すれば、第一/二/三候補のどれが濃厚かが確実に判断できます。**

その後、判定結果に基づいて、最小限の修正を実装すればよいです。

