# GROWTH Phase 1 ログ確認ガイド
## Concurrent Editing Safety Enhancement - ログ詳細リファレンス

---

## ファイル別ログ出力場所

### 1. strategyStore.ts のログ

**ファイル**: `store/strategyStore.ts`

#### A. REVISION_CONFLICT 検出と処理（Line 3122-3170）

```javascript
// ===== CONFLICT 検出 =====
// Location: Line 3130-3133
console.warn(
  `[strategyStore] ⚠ REVISION_CONFLICT (attempt ${attempt}/3). Preserving local edits and refetching...`,
  conflictInfo,
);
```

**conflictInfo の内容**:
```javascript
{
  expectedRevision: <現在の state.revision>,
  currentRevision: <error.currentRevision (API から)>,
  occurredAt: <Date.now()>,
  attempt: <1, 2, または 3>
}
```

**出現のタイミング**:
- 1回目のリトライ失敗時
- Scenario 1, 2, 3, 4 で必ず出現するはず
- 出現しない場合は conflict が発生していない = テスト設定不正

#### B. Refetch 実行（Line 3140-3151）

```javascript
// Location: Line 3143
await get().refetchFromServer();

// 成功時: エラーなし
// 失敗時:
console.error('[strategyStore] refetch after conflict failed:', refetchErr);
```

**確認ポイント**:
- refetch エラーが出ていないか
- 出ている場合: conflict recovery が失敗している（FAIL）

#### C. Backoff 実行（Line 3153-3158）

```javascript
// Location: Line 3154-3157
if (attempt === 2) {
  await new Promise((resolve) => setTimeout(resolve, 250));
} else if (attempt >= 3) {
  await new Promise((resolve) => setTimeout(resolve, 800));
}
```

**確認方法**:
1. Console で attempt 1 のログ時刻をメモ
2. attempt 2 のログ時刻をメモ
3. 差分が 250ms 以上あるか確認

**ただし**: Console に直接ログは出ない（setTimeout は silent）
代わりに attempt 1 → 2 → 3 のログ時刻差を見る

#### D. Cooldown 設定（Line 3160-3167）

```javascript
// Location: Line 3165
if (attempt >= 3) {
  console.warn('[strategyStore] REVISION_CONFLICT persists after 3 retries. Entering cooldown.');
  set({
    saveError: '他のユーザーの更新と競合しました。あなたの変更は保持されています。内容を確認して再度保存してください。',
    pendingConflictRecovery: false,
    conflictCooldownUntil: Date.now() + 3000,  // 3秒
  });
}
```

**確認ポイント**:
- 3 回のリトライ後にこのログが出ているか
- conflictCooldownUntil が 3000ms（3秒）加算されているか

---

### 2. useAutoSave.ts のログ

**ファイル**: `hooks/useAutoSave.ts`

#### A. Post-Restore Cooldown（Line 337-346）

```javascript
// Location: Line 338-345
if (restoreReady && lastServerSyncAt) {
  const timeSinceSync = Date.now() - lastServerSyncAt;
  if (timeSinceSync < 2000) {
    if (mode === 'payload') {
      console.log('[AutoSave][mode] payload - SKIP: post-restore cooldown', { timeSinceSync });
    }
    return;
  }
}
```

**出現のタイミング**: Restore 完了直後（Scenario 5）
**期待される timeSinceSync**: 200～2000 の範囲

**重要**: このログが出ている = ghost save が防げている（GOOD）

#### B. Conflict Cooldown チェック（Line 329-335）

```javascript
// Location: Line 330
if (conflictCooldownUntil && Date.now() < conflictCooldownUntil) {
  if (mode === 'payload') {
    console.log('[AutoSave][mode] payload - SKIP: in conflict cooldown period');
  }
  return;
}
```

**出現のタイミング**: REVISION_CONFLICT から 3 秒以内に autosave が trigger された場合
**確認ポイント**: Scenario 1-4 の後、すぐに再編集した場合に出るはず

#### C. Pending Conflict Recovery チェック（Line 348-354）

```javascript
// Location: Line 349
if (pendingConflictRecovery) {
  if (mode === 'payload') {
    console.log('[AutoSave][mode] payload - SKIP: pending conflict recovery');
  }
  return;
}
```

**出現のタイミング**: Conflict 回復中（refetch や retry 中）
**確認ポイント**: conflict 検出後、すぐに autosave trigger が来た場合に出るはず

---

### 3. saveWithAudit.ts のログ

**ファイル**: `utils/persist/saveWithAudit.ts`

#### A. Save 開始ログ（Line 87-102）

```javascript
// Location: Line 87-89
console.log(
  `[audit][save:start] caller=${callerLabel}${restoreDecisionId ? ` relatedRestoreDecisionId=${restoreDecisionId}` : ''}${opts?.retryCount ? ` retry=${opts.retryCount}` : ''}`,
  {
    userId,
    effectiveCompanyId: companyIdOverride ?? payload?.company_id,
    strategyId: payload?.id,
    revisionBefore,
    payloadSize,
    mode: opts?.mode ?? 'upsert',
    trigger: trigger ?? 'unknown',
    retryCount: opts?.retryCount ?? 0,
    hasFounderMind,
    hasDraftStory,
    timestamp: new Date().toISOString(),
  },
);
```

**重要フィールド**:
- `caller`: 呼び出し元の識別 (e.g., `store:saveStrategyData:manual`)
- `revisionBefore`: 保存前のリビジョン番号
- `retryCount`: リトライ回数（conflict 時に増える）
- `timestamp`: 保存開始時刻

**確認ポイント**:
```
Scenario 1: Manual save → revisionBefore = 1～10 程度
Scenario 6: 2 番目の手動保存 → revisionBefore が 1 番目より大きいか
```

#### B. Save 成功ログ（Line 155-165）

```javascript
// Location: Line 155-165
console.log(
  `[audit][save:done] caller=${callerLabel} duration=${duration}ms${subSaves?.length ? ` subSaves=${subSaves.length}` : ''}`,
  {
    effectiveCompanyId,
    strategyId: result.data?.id,
    revisionBefore,
    revisionAfter,
    result: 'success',
    subSaveResults: subSaves?.map((s) => ({ name: s.name, ok: s.ok })),
  },
);
```

**重要フィールド**:
- `revisionAfter`: 保存後のリビジョン番号
- `duration`: 保存にかかった時間（ms）

**確認ポイント**:
```
revisionAfter = revisionBefore + 1  // リビジョンが 1 増えたはず
```

#### C. Save 失敗ログ（Line 129-137）

```javascript
// Location: Line 129-137
console.warn(
  `[audit][save:fail] caller=${callerLabel} duration=${duration}ms${subSaves?.length ? ` subSaves=${subSaves.length}` : ''}`,
  {
    effectiveCompanyId,
    strategyId: payload?.id,
    revisionBefore,
    error: result.error,
    subSaveResults: subSaves?.map((s) => ({ name: s.name, ok: s.ok })),
  },
);
```

**確認ポイント**:
```
error フィールドに REVISION_CONFLICT, API error など詳細が入る
```

---

### 4. strategy.ts のログ

**ファイル**: `utils/supabase/strategy.ts`

#### A. REVISION_CONFLICT 検出（API層）（Line 1791-1797）

```javascript
// Location: Line 1791-1797
console.warn('[StrategyData] ⚠ REVISION_CONFLICT detected', {
  userId,
  companyId: cleanCompanyId,
  strategyId: payload.id,
  expectedRevision: expectedRev,
  message: 'Data was modified by another session',
});
```

**重要フィールド**:
- `userId`: どのユーザーが競合を起こしたか
- `companyId`: 対象企業
- `expectedRevision`: クライアント側が送った revision
- `message`: 競合メッセージ

**確認ポイント**:
```
userId と companyId が、Browser A と B で異なるか
（同じユーザーなら userId は同じ）
```

#### B. REVISION_CONFLICT エラーオブジェクト返却（Line 1814-1824）

```javascript
// Location: Line 1814-1824
return {
  data: null,
  error: {
    code: 'REVISION_CONFLICT',
    conflictType: 'revision_conflict',
    message: 'Data was modified by another session. Please refresh and try again.',
    expectedRevision: expectedRev,
    currentRevision: currentRevisionOnServer,
  },
};
```

**確認ポイント**:
```
currentRevision が expectedRevision より大きいか
```

---

### 5. refetchFromServer のログ（strategyStore.ts）

**ファイル**: `store/strategyStore.ts` Lines 3233-3550

#### A. Refetch 開始（Line 3254-3255）

```javascript
// Location: Line 3254
set({ _loadingRefetch: true, __isFetchingFromServer: true, isRestoring: true });
```

**確認ポイント**: isRestoring が true に set される

#### B. DB データ取得（Line 3265-3302）

```javascript
// Location: Line 3265
const { data, error } = await getFullStrategyDataByCompany(companyId);

// DEBUG ログ
console.log('[getFullStrategyDataByCompany] revision:' + dbRevision + ' hasFinancePL:' + hasFinancePL + ' ...')
```

**出現条件**: NEXT_PUBLIC_DEBUG_HYDRATE=1

**確認ポイント**:
```
revision: [数字] が出ているか
stage1Issues_len や answers12_len などが 0 または期待値か
```

#### C. Refetch 完了（Line 3529）

```javascript
// Location: Line 3529
set({
  ...
  restoreReady: true,
  isRestoring: false,
  lastServerSyncAt: Date.now(),
});
```

**確認ポイント**: lastServerSyncAt が current timestamp に設定される

#### D. Restore 完了ログ（Scenario 5 用）（Line 3534-3545）

```javascript
// Location: Line 3534-3545 (DEBUG時)
console.log('[audit][restore:stage2_check] wasDirty=false branch', {
  ceoIntent_len: ...,
  storyDraft_len: ...,
  answers12_len: ...,
  winPatternsCandidate_len: ...,
  finalStory_len: ...,
});
```

**出現条件**: NEXT_PUBLIC_DEBUG_HYDRATE=1 or DEBUG=true

**確認ポイント**:
```
Scenario 5: このログが出た直後、2 秒以内に [AutoSave] SKIP ログが出ているか
```

---

## ログ集約ビュー

### Scenario 1-2-3-4: Conflict シナリオの典型的なログフロー

```
Time T0: Browser A が保存
  [audit][save:start] caller=store:saveStrategyData:manual revision=5
  [audit][save:done] revision=6

Time T1: Browser B が保存（衝突）
  [audit][save:start] caller=store:saveStrategyData:manual revision=5
  [StrategyData] ⚠ REVISION_CONFLICT detected { userId, companyId, expectedRevision: 5, ... }
  [strategyStore] ⚠ REVISION_CONFLICT (attempt 1/3) { ... }

Time T1 + δ: Refetch 開始
  [strategyStore] refetch after conflict...
  [getFullStrategyDataByCompany] revision: 6
  [audit][restore:stage2_check] ...

Time T1 + 250ms: Backoff 後、Attempt 2
  [audit][save:start] caller=store:saveStrategyData:manual revision=6

  もし成功:
    [audit][save:done] revision=7
    saveError: undefined

  もし再度失敗:
    [StrategyData] ⚠ REVISION_CONFLICT detected ...
    [strategyStore] ⚠ REVISION_CONFLICT (attempt 2/3) ...

Time T1 + 1050ms: Backoff 後、Attempt 3
  [audit][save:start] caller=store:saveStrategyData:manual revision=6 or 7
  ... (同様)

  もし失敗:
    [strategyStore] REVISION_CONFLICT persists after 3 retries. Entering cooldown.
```

---

### Scenario 5: Restore 直後の Ghost Save 防止

```
Time T0: ページリロード
  [strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前
  [getFullStrategyDataByCompany] revision: 5

Time T0 + 500ms: Restore 完了
  [audit][restore:stage2_check] wasDirty=false branch
  [strategyStore refetch] 📦 full state from DB { ... }

  ❌ ここで [audit][save:start] が出ないこと

Time T0 + 600ms: Autosave trigger だが Cooldown で抑制
  [AutoSave][mode] payload - SKIP: post-restore cooldown { timeSinceSync: 100 }

Time T0 + 2500ms: Cooldown 期間終了後、通常の autosave に戻る
  [AutoSave][mode] payload { signature_length: 5432 }
  （この時点で初めて save が走ってよい）
```

---

### Scenario 6: Manual Save + Autosave の重複防止

```
Time T0: ユーザーが編集開始、入力
  （ログなし）

Time T1: ユーザーが手動保存ボタンをクリック
  [audit][save:start] caller=store:saveStrategyData:manual revision=5
  [audit][save:done] revision=6

Time T2: Autosave timer が火きかけるが、minInterval チェックで抑制
  [AutoSave][mode] payload - SKIP: minIntervalMs not elapsed

Time T3: ユーザーが別フィールドを編集
  （ログなし）

Time T4: 手動保存ボタン再度クリック（T2 から 1.5 秒以上経過）
  [audit][save:start] caller=store:saveStrategyData:manual revision=6
  [audit][save:done] revision=7
```

---

## Console フィルタ方法

### Chrome DevTools

1. **Console タブを開く** (F12 → Console)

2. **特定ログだけを見る** (Filter field に入力)
   ```
   [strategyStore] ⚠ REVISION_CONFLICT
   [AutoSave][mode] payload - SKIP
   [audit][save:start]
   [audit][save:done]
   ```

3. **時刻付きログを出す**（コンソール右下 Settings）
   ```
   Console → 詳細設定（歯車アイコン）→ 「メッセージのタイムスタンプを表示」
   ```

4. **ログをコピーして分析**
   ```
   Console 内で右クリック → 「ログを保存」
   または Ctrl+A で全選択 → テキストエディタに貼り付け
   ```

### Firefox DevTools

1. **Inspector タブの Console サブタブ**

2. **フィルタボックスに検索語を入力**
   ```
   REVISION_CONFLICT
   post-restore cooldown
   save:start
   ```

3. **ログレベルでフィルタ** (Console 上部)
   ```
   ✓ Errors
   ✓ Warnings
   ✓ Logs
   ```

---

## ログ量削減方法（本番対応後）

**本マニュアルでは NEXT_PUBLIC_DEBUG_HYDRATE=1 を推奨**

本番デプロイ時は環境変数を削除:
```bash
NEXT_PUBLIC_DEBUG_HYDRATE=  # または削除
```

その場合、以下だけが出力される（安全）:
- `[StrategyData] ⚠ REVISION_CONFLICT detected` (strategy.ts)
- `[strategyStore] ⚠ REVISION_CONFLICT` (strategyStore.ts)
- `[audit][save:*]` (saveWithAudit.ts)
- エラーメッセージ

---

## トラブルシューティング向けログ抽出スクリプト

```javascript
// DevTools Console に貼り付け

// 1. CONFLICT ログのみ抽出
console.log('=== CONFLICT LOGS ===');
copy(document.body.innerText.match(/.*REVISION_CONFLICT.*/g).join('\n'));

// 2. AUTOSAVE ガード ログ抽出
console.log('=== AUTOSAVE SKIP LOGS ===');
copy(document.body.innerText.match(/.*AutoSave.*SKIP.*/g).join('\n'));

// 3. SAVE ログの時刻差を計算
const logs = document.body.innerText.match(/\[audit\]\[save:(start|done)\].*/g);
// 手動で時刻をメモ

// 4. すべてのログを File にエクスポート
const blob = new Blob([document.body.innerText], {type: 'text/plain'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'console-logs.txt';
a.click();
```

---

**このガイドを参照しながらテストを実施してください。**
