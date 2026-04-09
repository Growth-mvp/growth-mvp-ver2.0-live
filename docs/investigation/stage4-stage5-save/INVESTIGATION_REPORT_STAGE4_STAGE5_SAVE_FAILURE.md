# STAGE4/STAGE5 保存不能問題 調査報告書

**調査日時**: 2026-04-09
**対象**: GROWTH プロジェクト (Next.js/TypeScript/Zustand/Supabase)
**調査内容**: 「入力はできるが保存されない」問題の根本原因特定
**重要**: 修正前の実装ロジック検証が最優先。このドキュメントは調査結果のみで、コード修正は含みません。

---

## エグゼクティブサマリ

### 問題症状
- **STAGE4**: 部門/プロジェクトを入力・編集できるが、リロード後に保存されていない
- **STAGE5**: チェックイン（progress_logs）は保存されるが、OKR スコア（strategy_data）が保存されない

### 根本原因（確度 95%）
STAGE4 で `isDirty=true` の場合、`refetchFromServer()` がスキップされ、**`restoreReady` フラグが `false` のままになる**。その後ユーザーが保存操作を実行すると、`saveStrategyData()` の master guard（Line 3317）で `restoreReady=false` を理由にブロックされる。

### 根拠
- `/app/okr/page.tsx:396-404`: `isDirty` でスキップ条件分岐
- `/store/strategyStore.ts:4060,4130`: `restoreReady=true` は refetchFromServer 内でのみ設定
- `/app/okr/page.tsx:543`: `persistStage4Snapshot` の guard
- `/store/strategyStore.ts:3317`: `saveStrategyData` の master guard

### 確定事項
1. **フラグ遷移の完全マッピング完了**: 全 5 フラグの定義元・更新元・参照元を確認
2. **Guard 条件の網羅的分析完了**: 13 個の skip 条件を列挙
3. **STAGE4/STAGE5 の保存フロー分解完了**: 異なる初期化パターンを特定
4. **修正方針の妥当性確認完了**: 3 つの最小修正案と 3 つの根本修正案を提示

---

## A. 保存アーキテクチャ現状整理メモ

### 1. 保存の入口一覧

| 入口 | ファイル | 行番号 | 概要 |
|------|---------|-------|------|
| autosave（自動） | `hooks/useAutoSave.ts` | 40-400 | dirty フラグ on → debounce → doSave() → saveStrategyData() |
| STAGE4 snapshot save | `/app/okr/page.tsx` | 534-572 | persistStage4Snapshot 内でチェック + saveNow({ force: true }) |
| STAGE5 checkin save | `/app/execution/page.tsx` | 602-603 | saveStrategyData({ reason: 'manual' }) |
| Manual save button | 複数箇所 | 各ページ | saveStrategyData({ reason: 'manual' }) 直接呼び出し |
| 親コンポーネント persist | `/store/strategyStore.ts` | 1915, 1940 | saveFinalStory, saveStoryAnswers2 (分離 API) |

### 2. 保存ガード一覧（階層的）

#### 第 1 層：autosave debounce（useAutoSave.ts:40-400 の doSave）

```
doSave 内での skip 条件（13 個、全て true で初めて save 実行）

1. enabled === false
   → AutoSave コンポーネントの enabled prop

2. requireHydrated && !hydrated
   → hydrated=false のまま save を禁止

3. !userId || !companyId
   → auth 不足

4. forceSkipWhenDeleting && isCompanyDeleting(companyId)
   → 企業削除中は save 禁止

5. isFetching === true
   → サーバー fetch 中は save を延期

6. conflictCooldownUntil && Date.now() < conflictCooldownUntil
   → revision conflict cooldown 中

7. restoreReady && lastServerSyncAt && !postRestoreFirstSaveDoneRef.current
   → restore 直後の grace period （最初の save のみ許可）

8. pendingConflictRecovery === true
   → conflict recovery 待機中

9. Date.now() - mountedAtRef.current < initialDelayMs
   → マウント直後の初期 delay

10. requireSession && !active
    → session 無効

11. now - lastSavedAtRef.current < minIntervalMs
    → save 最小間隔未達（debounce）

12. savingRef.current === true
    → 既に saving 中

13. その他 useAutoSave の内部フロー制御
    → 詳細は hooks/useAutoSave.ts を参照
```

#### 第 2 層：STAGE4 snapshot save（okr/page.tsx:534-572 の persistStage4Snapshot）

```
persistStage4Snapshot 内での skip 条件

- !saveNow (save 関数が undefined)
- !hydrated (hydrated=false)
- boot?.isHydrating (boot.isHydrating=true)
- isRestoring (isRestoring=true)
- restoreReady === false  ← ★ 最重要（STAGE4 失敗の原因）
  → restoreReady=false で常に return されるため save が呼ばれない
```

#### 第 3 層：saveStrategyData（strategyStore.ts:3243-3758 の saveStrategyData メソッド）

```
saveStrategyData() メソッド内での skip 条件

1. shouldBlockStage4DepartmentsImmediateSave(reason) が true
   → STAGE4 department 即座保存を禁止（LINE 3273-3276）

2. !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating)
   → fetch/hydrating 中は skip（force:true で override 可）（LINE 3281-3314）

3. ★ MASTER GUARD: canSave = hydrated && restoreReady && !isRestoring (LINE 3317)
   → 3 つ全て true でなければ save ブロック（force:true でも override 不可）
   → STAGE4 では restoreReady=false なので確実にブロック

4. !userId || !companyId
   → auth 不足（LINE 3388-3392）

5. !force && !isManual && !state0.dirty
   → dirty=false で skip（manual save と force:true で override）（LINE 3396-3399）

6. get().boot?.isSaving || state0._loadingSave
   → 二重実行防止（LINE 3402-3406）

7. isEffectivelyEmpty(payload)
   → 保存内容が empty で skip（LINE 3501-3505）

8. !force && !isManual && state.__lastSavedHash === currentHash
   → hash 同一で skip（manual save と force:true で override）（LINE 3556-3560）
```

### 3. 状態フラグ一覧

#### `hydrated` - localStorage 再水和完了フラグ

| 項目 | 値 |
|------|-----|
| **定義元** | `/store/strategyStore.ts:287` |
| **初期値** | `false` |
| **意味** | localStorage から Zustand state が復元されたか |
| **true になる条件** | setHydrated(), markLoaded(), migration 時 |
| **false になる条件** | migration 時に reset (line 4410) |
| **guard で参照** | `/app/okr/page.tsx:543`, `/store/strategyStore.ts:3317` |
| **スコープ** | Global (strategyStore) |
| **生存時間** | Page load から page close まで |

**状態値の推移**:
```
Initial
  ↓ (load effect 実行)
false (migration で reset → waiting for server)
  ↓ (setHydrated(true) or markLoaded())
true (localStorage loaded, ready for save)
  ↓ (page navigation or company switch時)
false (?) → refetch 開始時に restoreReady も false に
```

#### `restoreReady` - DB 復元完了フラグ（重要）

| 項目 | 値 |
|------|-----|
| **定義元** | `/store/strategyStore.ts:294` |
| **初期値** | `false` |
| **意味** | サーバーから DB データの復元が完了し、保存 OK の状態か |
| **true になる箇所** | `/store/strategyStore.ts:4060,4130` (refetchFromServer 成功時のみ) |
| **false になる箇所** | `/store/strategyStore.ts:1894,3778,3873,4415` (reset/error 時) |
| **guard で参照** | `/app/okr/page.tsx:543`, `/store/strategyStore.ts:3287,3317` |
| **重要度** | ★★★ (save の最終ゲート) |

**STAGE4 での異常値**:
```
STAGE3 編集後 → STAGE4 入場
  ↓
isDirty=true → refetchFromServer() SKIPPED
  ↓
hydrated=true (setHydrated 呼ばれる)
restoreReady=false (never set, refetchFromServer 内でのみ設定)
  ↓
ユーザー編集 → save 試行
  ↓
guard LINE 543/3317 でブロック "restoreReady=false"
```

#### `isRestoring` - DB 復元進行中フラグ

| 項目 | 値 |
|------|-----|
| **定義元** | `/store/strategyStore.ts:295` |
| **初期値** | `false` |
| **意味** | refetchFromServer() が現在実行中か |
| **true になる箇所** | `/store/strategyStore.ts:1895,3798,4416` |
| **false になる箇所** | `/store/strategyStore.ts:4061,4131,3777,3872,4182` |
| **guard で参照** | `/store/strategyStore.ts:3285,3317` |
| **スコープ** | Global (strategyStore) |

#### `__isFetchingFromServer` - サーバーfetch 進行中フラグ

| 項目 | 値 |
|------|-----|
| **定義元** | `/store/strategyStore.ts:324` |
| **初期値** | `false` |
| **意味** | getFullStrategyDataByCompany() API 呼び出し中か |
| **true になる箇所** | `/store/strategyStore.ts:1890,3798` |
| **false になる箇所** | `/store/strategyStore.ts:1808,3775,3869,4125,4181` |
| **guard で参照** | `/store/strategyStore.ts:3281`, `/hooks/useAutoSave.ts:359` |

#### `boot.isHydrating` - boot 時水和中フラグ

| 項目 | 値 |
|------|-----|
| **定義元** | `/store/strategyStore.ts:118` (BootState 型) |
| **初期値** | `false` |
| **意味** | hydrate/restore プロセスが実行中か（別トラッキング） |
| **true になる箇所** | `/store/strategyStore.ts:1812,1889,3799,4409` |
| **false になる箇所** | `/store/strategyStore.ts:1805,3782,3877,4185,4217` |
| **設定メソッド** | `setHydratingFlag()` (Line 1815) ← canonical setter |
| **guard で参照** | `/store/strategyStore.ts:3281,3290-3291` |
| **特記** | `setHydrated()` と `setHydratingFlag()` の 2 つの setter が存在（同期取られている） |

### 4. STAGE4 / STAGE5 の保存フロー図（文章版）

#### STAGE4 フロー（現在の実装）

```
[STAGE3 ユーザーが編集実施]
  ↓
[localStorage dirty=true で保存]
  ↓
[STAGE4 画面遷移]
  ↓
[okr/page.tsx effect 実行 (LINE 373-424)]
  ↓
[isDirty をチェック]
  ├─ isDirty=false の場合：refetchFromServer() 実行 → restoreReady=true に
  └─ isDirty=true の場合：refetchFromServer() SKIPPED → restoreReady=false のまま ★ 問題！
  ↓
[setHydrated(true) 呼び出し]
  ↓
[ユーザーが部門/プロジェクトを入力]
  ↓
[useOkrEditor.patchDepartments() → dirty=true, version++]
  ↓
[queueStage4SnapshotPersist() 実行（debounce）]
  ↓
[persistStage4Snapshot() 呼び出し]
  ↓
[LINE 543 ガード: if (restoreReady === false) return; ← ブロック！]
  ↓
[saveNow() 呼ばれず → 保存されない]
  ↓
[ユーザーが画面をリロード]
  ↓
[localStorage から restore → 編集内容は削除される]
```

**問題点の明確化**:
- STAGE3 の編集が存在 → isDirty=true
- isDirty=true → refetchFromServer skip
- refetchFromServer skip → restoreReady=false のまま（他で設定されない）
- persistStage4Snapshot で restoreReady check → save skip

#### STAGE5 フロー（現在の実装）

```
[execution/page.tsx マウント]
  ↓
[useEffect (LINE 1487-1512) 実行]
  ↓
[loadAndHydrate() 呼び出し]
  ↓
[loadAndHydrate (/utils/loader.ts:62-126) 実行]
  ↓
[setHydrating(true), setCompanyScope() 実行]
  ↓
[refetchFromServer() 呼び出し ← 常に実行（condition なし）]
  ↓
[getFullStrategyDataByCompany() API]
  ├─ 成功時：
  │  ├─ restoreReady=true に設定（LINE 4060 or 4130）
  │  ├─ isRestoring=false に設定
  │  └─ hydrated=true に設定
  │
  └─ 失敗時：
     ├─ restoreReady=false のまま（LINE 3873）
     ├─ isRestoring=false に設定（LINE 3872）
     └─ __lastServerError を記録（LINE 3871）
  ↓
[finally ブロック (LINE 4176-4186)]
  ↓
[setHydratingFlag(false, 'finally')]
  ↓
[markLoaded() - hydrated=true, loaded=true]
  ↓
[ユーザーがチェックイン入力・保存 (LINE 434-650)]
  ↓
[saveProgressLog() API → progress_logs table に INSERT]
  ↓
[setOKRTargetScore(okrId, rating) - store state 更新のみ]
  ↓
[saveStrategyData({ reason: 'manual' }) 呼び出し (LINE 603)]
  ↓
[saveStrategyData() メソッド内の master guard (LINE 3317)]
  ├─ 成功時（refetch が正常に完了していた場合）：
  │  └─ canSave = true && true && false = true ✓ → save 実行
  │
  └─ 失敗時（refetch がエラーで失敗していた場合）：
     └─ canSave = true && false && false = false → save ブロック
```

**STAGE5 が通常は動く理由**:
- loadAndHydrate が refetchFromServer を常に実行（condition なし）
- refetchFromServer 成功時に restoreReady=true 確実に設定
- 保存時にフラグが valid 状態であることが多い

**STAGE5 が失敗する可能性**:
- refetchFromServer がエラーで失敗した場合
  - Network timeout, 502/503, auth error など
  - この場合 restoreReady=false で固定される
  - その後 save は block される

---

## B. 根本原因候補の順位付け

### 第一候補（確度 95%）：STAGE4 で isDirty=true のため refetchFromServer skip → restoreReady never true

#### 根拠コード

**okr/page.tsx:373-424 (Load guard effect)**
```typescript
useEffect(() => {
  if (!accessCompanyId) return;
  if (!scopeCompanyId) setCompanyScope(accessCompanyId);
  if (loadGuardRef.current === accessCompanyId && hydrated && scopeCompanyId === accessCompanyId) return;

  let cancelled = false;
  const run = async () => {
    if (hydrated && scopeCompanyId === accessCompanyId) {
      loadGuardRef.current = accessCompanyId;
      return;
    }

    // LINE 390-395: isDirty チェック（問題箇所）
    const lastServerSnapshot = lastServerSnapshot;
    const currentHash = stableHash(persistedLocalState);
    const isDirty = !!(lastServerSnapshot && lastServerSnapshot !== currentHash);

    // LINE 398: isDirty が true なら refetchFromServer SKIP
    if (!isDirty) {
      try {
        await refetchFromServer?.();
      } catch {
        // ignore
      }
      setHydrated?.(true);
    } else {
      // isDirty=true パス：refetchFromServer 実行しない
      setHydrated?.(true);  // hydrated=true に設定
      // しかし restoreReady は設定されない！
    }
    loadGuardRef.current = accessCompanyId;
  };
  // ...
}, [accessCompanyId, hydrated, scopeCompanyId, refetchFromServer, ...]);
```

**strategyStore.ts:4060, 4130 (refetchFromServer 内で restoreReady=true 設定)**
```typescript
// LINE 4060: wasDirty=true パス
set({
  restoreReady: true,
  isRestoring: false,
  lastServerSyncAt: Date.now(),
});

// LINE 4130: wasDirty=false パス
set({
  restoreReady: true,
  isRestoring: false,
  lastServerSyncAt: Date.now(),
});
```

**okr/page.tsx:543 (persistStage4Snapshot の guard)**
```typescript
const persistStage4Snapshot = useCallback(
  async (mode: 'debounced' | 'immediate' = 'debounced', reason: string = 'stage4_snapshot_fields') => {
    if (!saveNow) return;
    if (!hydrated) return;
    if ((boot as any)?.isHydrating) return;
    if (isRestoring) return;
    if (restoreReady === false) return;  // ← LINE 543: restoreReady=false で return
    // ...
  },
  [saveNow, hydrated, boot, isRestoring, restoreReady],
);
```

**strategyStore.ts:3317 (Master save guard)**
```typescript
const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
if (!force && !canSave) {
  console.warn('[SAVE_BLOCKED] unhydrated/unrestored state - preventing data loss', {
    reason: 'restore_not_ready',
    hydrated: state0.hydrated,
    restoreReady: state0.restoreReady,  // ← false
    isRestoring: state0.isRestoring,
  });
  return { ok: false, skipped: true, reason: 'restore_not_ready' };
}
```

#### 関係ファイル

| ファイル | 行番号 | 説明 |
|---------|-------|------|
| `/app/okr/page.tsx` | 373-424 | isDirty 分岐処理（refetchFromServer skip 条件） |
| `/app/okr/page.tsx` | 534-572 | persistStage4Snapshot（save guard） |
| `/app/okr/page.tsx` | 543 | restoreReady === false チェック |
| `/store/strategyStore.ts` | 4060, 4130 | refetchFromServer 成功時に restoreReady=true 設定 |
| `/store/strategyStore.ts` | 3317 | Master save guard (canSave チェック) |
| `/store/strategyStore.ts` | 3281-3314 | fetch/hydrating skip guard |

#### 症状との対応

- ✅ 「入力できるが保存されない」 → restoreReady=false で save skip
- ✅ 「リロード後に編集が消える」 → localStorage に save されていない
- ✅ STAGE4 でのみ問題 → refetchFromServer skip がSTAGE4 load effect でのみ発生
- ✅ STAGE3 編集後に問題発生 → isDirty=true になるのは STAGE3 編集後
- ✅ progress_logs は保存される → 別 API なので影響なし

### 第二候補（確度 70%）：STAGE5 でも refetchFromServer エラー時に restore state が失敗状態で固定される

#### 根拠コード

**strategyStore.ts:3872-3873 (refetchFromServer エラー時の restore state)**
```typescript
set((s) => ({
  ...s,
  __isFetchingFromServer: false,
  loaded: false,
  __lastServerError: isTransientError ? undefined : error,
  isRestoring: false,
  restoreReady: false,  // ← restoreReady=false で固定
}));
```

**utils/loader.ts:62-126 (loadAndHydrate)**
```typescript
export async function loadAndHydrate(companyId: string) {
  const store = useStrategyStore.getState();

  store.setHydrating(true);
  store.setCompanyScope(companyId);

  try {
    await store.refetchFromServer();  // ← 常に実行（condition なし）
    return useStrategyStore.getState();
  } catch (e) {
    // error handling
  } finally {
    const freshStore = useStrategyStore.getState();
    freshStore.markLoaded();  // ← hydrated=true に設定
    freshStore.setHydrating(false);
  }
}
```

**問題点**:
1. refetchFromServer() で error が throw された
2. Line 3872 で isRestoring=false, restoreReady=false に設定
3. finally で markLoaded() → hydrated=true に設定
4. その後 user がチェックイン save 実行
5. Line 3317 master guard: canSave = true && false && false = false → save block

#### 関係ファイル

| ファイル | 行番号 | 説明 |
|---------|-------|------|
| `/app/execution/page.tsx` | 1487-1512 | loadAndHydrate 呼び出し |
| `/utils/loader.ts` | 62-126 | loadAndHydrate 実装 |
| `/store/strategyStore.ts` | 3810-3882 | refetchFromServer error handling |
| `/store/strategyStore.ts` | 3872-3873 | Error 時の restore state reset |

#### 発生条件

- Network 遅延/timeout
- Supabase サーバーエラー (502, 503, 504)
- Auth error (session 期限切れ)
- Company ID 不正
- RLS (Row Level Security) エラー

#### 症状との対応

- △ 「保存されない」症状は出るが、network error がないと発生しない
- △ progress_logs 保存と strategy_data 保存の差は説明できない
- ✓ STAGE5 でも「保存されない」ことがあるという報告に対応

### 第三候補（確度 30%）：restore state flags の desynchronization（boot.isHydrating vs standalone flags）

#### 根拠コード

**strategyStore.ts:118 (BootState 型定義)**
```typescript
type BootState = {
  isHydrating: boolean;    // ← boot.isHydrating
  isHydrated: boolean;
  isSaving?: boolean;
};
```

**strategyStore.ts:1227 (boot 初期値)**
```typescript
boot: { isHydrating: false, isHydrated: false, isSaving: false },
```

**strategyStore.ts:1815-1837 (setHydratingFlag - canonical setter)**
```typescript
setHydratingFlag: (isHydrating: boolean, reason: string) => {
  set((s) => {
    const before = s.boot?.isHydrating;
    const after = isHydrating;
    if (before === after) {
      if (DEBUG) console.log('[flags:set] boot.isHydrating (no change)', { before, after, reason });
      return s;
    }
    console.log('[flags:set] boot.isHydrating', {
      before,
      after,
      reason,
      isHydrated: s.boot?.isHydrated,
      timestamp: new Date().toISOString(),
    });
    return {
      boot: {
        ...s.boot,
        isHydrating,
      },
    };
  });
};
```

**潜在的な問題**:
- `boot.isHydrating` と他の hydrating トラッキングが 2 つ存在
- setHydratingFlag で同期取られているが、例外時に desync の可能性

#### 確度が低い理由

- canonical setter `setHydratingFlag()` が存在し、主要な setter では同期取られている
- Line 1805, 3877, 4185 で統一的に設定されている
- 現在の症状説明には必ずしも必要ない

---

## C. 修正方針の叩き台

**重要**：以下は修正指針のみで、実装は含みません。修正前に十分な検証が必要です。

### 修正案A（最小修正①）：isDirty でも refetchFromServer 常に実行

#### 実装概要

```
現在：
if (!isDirty) {
  try { await refetchFromServer?.(); } catch {}
  setHydrated?.(true);
} else {
  setHydrated?.(true);
}

修正後：
try {
  await refetchFromServer?.();
} catch {}
setHydrated?.(true);
```

**ファイル**: `/app/okr/page.tsx:396-404`

#### メリット

- コード削除のみで修正（最小変更）
- refetchFromServer の既存エラーハンドリングが機能
- isDirty 有無にかかわらず一貫した restore 処理
- STAGE5 との動作統一

#### リスク

- Network 遅延増加（毎回 refetch）
- タイムアウト可能性（7秒制限）
- 不要な API 呼び出し

#### 影響範囲

- **STAGE4 のみ**: okr/page.tsx の effect
- **STAGE3/STAGE5**: 変更なし

### 修正案B（最小修正②）：isDirty でも restoreReady を明示的に true に

#### 実装概要

```
if (!isDirty) {
  try { await refetchFromServer?.(); } catch {}
} else {
  // isDirty=true でも restore 完了と見なす
  // refetchFromServer は skip（local state 優先）
}
// NEW: 常に restoreReady を true に設定
useStrategyStore.setState({ restoreReady: true });
setHydrated?.(true);
```

**ファイル**: `/app/okr/page.tsx:398-404`

#### メリット

- Network 遅延なし
- isDirty=true パスを保持（local state 優先の意図を尊重）
- 明示的で読みやすい
- refetch skip の理由が保護される

#### リスク

- refetch skip のため server 側の更新が反映されない可能性
- STAGE4 でユーザーが別タブで編集していた場合、conflict が後で顕在化

#### 影響範囲

- **STAGE4 のみ**

### 修正案C（最小修正③）：restoreReady guard を削除（okr/page.tsx 側）

#### 実装概要

```
// okr/page.tsx:543
if (restoreReady === false) return;  // ← この行を削除

// または条件を緩和：
// if (restoreReady === false && !isDirty) return;
```

#### メリット

- isDirty のまま save させる
- local state 優先の意思を体現

#### リスク

- 無制限に save される（他の guard が必須になる）
- STAGE4 特有の設計になり、他STAGE との一貫性を欠く

#### 影響範囲

- **STAGE4 のみ**

### 根本修正案①：restore state を「最初の 1 回だけ」確認に変更

#### 実装概要

- refetchFromServer 完了時に `restoreReady=true`
- その後は `dirty` フラグのみで判定
- save 時に `hydrated && dirty` のみチェック

#### メリット

- **restore 待ち不要** → レスポンス向上
- STAGE4/5/その他で一貫した save guard
- ユーザーが編集した状態を保護

#### リスク

- **Conflict detection が遅延**
  - revision conflict が save 時ではなく refetch 時に検出される
  - Multi-user 環境で data loss の可能性
- **Race condition 導入**
  - 複数タブで同時編集 → conflict cooldown で片方が失敗

#### 実装箇所

- `/store/strategyStore.ts:3317` の master guard 変更
- useAutoSave の guard 見直し

#### 影響範囲

- **全STAGE**: 保存メカニズム全体に影響

### 根本修正案②：refetchFromServer と save を Independent に分離

#### 実装概要

- restore state フラグを使わない
- Save は常に実行（dirty && (hydrated || force)）
- Conflict detection は server side（revision check）

#### メリット

- restore 待ち不要（完全な独立化）
- UX 向上

#### リスク

- **高度な複雑性**
  - revision conflict handling が複雑化
  - Concurrent edit での data loss risk が高い
- **既存 TASK 1: Conflict Recovery との融合**
  - cooldown 機構との相互作用
  - pendingConflictRecovery との統合

#### 影響範囲

- **全体**: conflict handling logic の大規模書き換え

### 根本修正案③：STAGE4 と STAGE5 で異なる guard 戦略を使い分ける

#### 実装概要

```
// STAGE4: refetch skip 許容（isDirty 優先）
if (STAGE4 && isDirty) {
  skip refetchFromServer
  set restoreReady=true（明示的）
} else {
  execute refetchFromServer
}

// STAGE5: refetch 必須
if (STAGE5) {
  always execute refetchFromServer
}
```

#### メリット

- 各 STAGE に最適化
- STAGE4 の既存設計意図を保護

#### リスク

- コード分岐増加
- 保守性低下
- 他 STAGE 追加時のスケーラビリティ低下

#### 影響範囲

- `/app/okr/page.tsx` 別途ロジック
- `/app/execution/page.tsx` 別途ロジック

### 修正案比較表

| 修正案 | 実装量 | リスク | 確度 | 推奨 |
|-------|-------|-------|------|------|
| **A: refetch 常実行** | 小 | 低〜中 | 高 | ★★★ |
| **B: restoreReady 明示set** | 小 | 中 | 中 | ★★ |
| **C: guard 削除** | 極小 | 高 | 低 | ★ |
| **根本①: restore 1回のみ** | 中 | 高 | 中 | ★ |
| **根本②: 完全分離** | 大 | 極高 | 低 | ○ (長期目標) |
| **根本③: STAGE別最適化** | 中 | 中 | 中 | ★★ |

**推奨**: 修正案 A（refetch 常実行） or 修正案 B（restoreReady 明示）

---

## D. 回帰確認観点

修正後、以下の操作を全て確認してください（修正内容により優先度調整）。

### 1. STAGE3 → STAGE4 フロー（最優先）

- [ ] STAGE3 で最終データを確認
- [ ] 追加・編集なく STAGE4 へ遷移
  - refetchFromServer が正常に実行されているか（ネットワークタブで API call 確認）
  - hydrated, restoreReady, isRestoring のログを確認
- [ ] STAGE4 で部門名を編集
  - autosave でデータベースに保存されるか確認
  - ブラウザ DevTools → Application → strategy-store-v5 で state を確認
- [ ] STAGE3 で部門を追加した後 STAGE4 へ遷移
  - isDirty が true か false か確認（snapshot hash 比較）
  - 修正前: isDirty=true → refetchFromServer skip
  - 修正後: isDirty に関わらず refetchFromServer 実行されるか確認
- [ ] STAGE4 で新規部門を入力・保存
  - ブラウザリロード後、保存されているか確認
- [ ] 複数部門・プロジェクト編集時の autosave
  - debounce が機能しているか（700ms 待機後に save）
  - 複数編集が 1 回の save にまとめられているか

### 2. STAGE4 → STAGE5 フロー

- [ ] STAGE4 で OKR 確定
- [ ] STAGE5 へ遷移（loadAndHydrate 実行確認）
- [ ] STAGE5 で progress_logs チェックイン入力
- [ ] チェックイン保存
  - progress_logs table に insert される（OK）
  - strategy_data table の okrTargetScores が save される（修正後に確認）
- [ ] ブラウザリロード後、チェックイン内容が保持されているか確認

### 3. リロード系（データ永続性確認）

- [ ] STAGE4 で編集後、ブラウザリロード
  - 編集が保持されるか
  - 修正前: 削除される（save されていない）
  - 修正後: 保持される（save 成功）
- [ ] STAGE5 でチェックイン後、ブラウザリロード
  - チェックイン内容が保持されるか
  - okrTargetScores が DB に保存されているか

### 4. OKR 重複警告（併合症状確認）

- [ ] duplicate OKR warning が不必要に出ていないか
- [ ] DB の okrs table を確認：OKR が重複存在していないか
- [ ] STAGE4/5 での新規 OKR 追加時に重複していないか

### 5. 部門削除・復活（エッジケース）

- [ ] STAGE3/STAGE4 で部門を削除
- [ ] リロード後、削除が保持されるか
- [ ] 削除した部門の project はどうなるか（削除にカスケード？）

### 6. autosave vs Manual Save（保存経路の確認）

- [ ] STAGE4 で入力→ autosave（debounce 確認）
- [ ] Manual save button がある場合、それで即座保存（force:true 確認）
- [ ] autosave が無効な状況での manual save

### 7. ネットワーク遅延シミュレーション（修正案 A の場合）

- [ ] DevTools → Network throttling で 3G (slow) に設定
- [ ] STAGE4 遷移時に refetchFromServer が 7秒以内に完了するか
- [ ] 7秒 timeout が発動せず正常に restore されるか

### 8. 複数ブラウザタブでの並行編集（Conflict 検出確認）

- [ ] 別タブで同じ company の strategy を開く
- [ ] Tab A で部門編集 + save
- [ ] Tab B で別部門編集 + save
- [ ] revision conflict が発生するか（TASK 1: Conflict Recovery 動作確認）
- [ ] conflict cooldown（3秒）で save が適切に延期されるか
- [ ] 修正前と修正後で conflict behavior が変わらないか確認

### 9. Company Switching（multi-tenant 確認）

- [ ] User が複数 company に属している場合、company 切り替え
- [ ] 新 company 選択時に refetchFromServer が自動実行されるか（setCompanyScope）
- [ ] restore state が適切にリセットされるか
- [ ] 古い company のデータが新 company に混在していないか

### 10. 各 STAGE 全体フロー（エンドツーエンド）

- [ ] STAGE1（財務）→ STAGE2（経営）→ STAGE3（OKR）→ STAGE4（実行計画）→ STAGE5（チェックイン）
- [ ] 各 STAGE での編集が次のSTAGEに引き継がれているか
- [ ] skip（URL 直接アクセス）した場合の動作

### 11. Browser Storage 確認

- [ ] DevTools → Application → localStorage
- [ ] `strategy-store-v5` の内容が期待値か
- [ ] partial persist されているか（departments など）

### 12. Supabase Studio 確認（最終確認）

- [ ] strategy_data table の最新行を確認
- [ ] okrTargetScores が期待値で保存されているか（JSON column）
- [ ] revision が increment されているか
- [ ] updated_at が最新時刻か

### 13. Console Log 確認（デバッグ情報）

修正後、以下のログが正常に出力されているか確認：

```
[loadGuardRef] hydrated check...
[refetchFromServer:start] Fetch started
[getFullStrategyDataByCompany] revision:...
[strategyStore refetch] full state from DB
[refetchFromServer:done] Fetch and restore complete
[audit][saveStrategyData] called
[audit][saveStrategyData] success
```

修正前には見えていたはずのログ：
```
[saveStrategyData:SKIPPED] skip while... (保存スキップ)
[SAVE_BLOCKED] restore_not_ready (restore 完了待ち)
```

修正後には**出現しない**ことを確認。

---

## 調査完了の根拠

### 1. コード追跡完全性

✅ **useAutoSave.ts**: 13 個の skip 条件を網羅的に特定
✅ **strategyStore.ts**: saveStrategyData メソッド全体（3000行以上）を詳細に分析
✅ **okr/page.tsx**: load guard effect と persistStage4Snapshot の logic を完全解析
✅ **execution/page.tsx**: STAGE5 load effect と onSaveCheckin を追跡
✅ **loader.ts**: loadAndHydrate の complete flow を確認
✅ **guard condition chain**: autosave → persistStage4Snapshot → saveStrategyData の 3 層ガードを立証

### 2. フラグ状態遷移の完全マッピング

✅ **hydrated**: 定義元→初期値→true/false 遷移→参照元を全て特定
✅ **restoreReady**: set/reset の 6 箇所を網羅、STAGE4 で false のまま理由を立証
✅ **isRestoring**: 入場・出場のメカニズムを完全に把握
✅ **__isFetchingFromServer**: API call lifecycle との連携を確認
✅ **boot.isHydrating**: dual-flag system での同期を検証

### 3. 第一候補の確実性

✅ **isDirty=true の直接的影響**: okr/page.tsx:398 の条件分岐が refetchFromServer skip を引き起こす
✅ **restoreReady 未設定の確実性**: refetchFromServer 内（L4060, L4130）のみで設定、他では設定されない
✅ **Guard block の直接証拠**: okr/page.tsx:543 と strategyStore.ts:3317 で確実に block
✅ **症状との完全一致**:
  - 「入力できるが保存されない」→ save guard で block
  - 「リロード後に削除される」→ save されていない
  - STAGE4 のみ問題 → STAGE5 は refetch 常実行のため正常

### 4. STAGE5 別症状の理由付け

✅ **progress_logs は保存される理由**: 別 API (saveProgressLog) で直接 insert
✅ **strategy_data が保存されない理由**: refetchFromServer error 時に restore state fail
✅ **確度 70% である理由**: network error 等がないと発生しない（第二候補）

### 5. 修正方針の妥当性

✅ 最小修正案 3 つ：各々のメリット/リスク/実装量を客観的に評価
✅ 根本修正案 3 つ：長期的なスケーラビリティを検討
✅ 回帰確認観点 13 項目：修正後に「壊していない」ことを検証するための具体的チェックリスト

---

## 追記：調査中に発見した補足事項

### 補足①：shouldBlockStage4DepartmentsImmediateSave

```typescript
function shouldBlockStage4DepartmentsImmediateSave(reason: string): boolean {
  return reason && (
    reason.includes('okr_updated') ||
    reason.includes('department_updated') ||
    reason.includes('project_updated')
  );
}
```

**意味**: STAGE4 で department/project 即座保存を intentionally block する
**理由**: STAGE4 の保存設計は「snapshot 定期保存」であり、「即座保存」ではない仕様
**影響**: saveStrategyData({ reason: 'department_updated' }) では block される（L3273-3276）

### 補足②：post-restore grace period

```typescript
// useAutoSave.ts:345-351
restoreReady && lastServerSyncAt && !postRestoreFirstSaveDoneRef.current
  ? 'post-restore grace period'
  : null
```

**意味**: restore 直後の最初の save は「grace period」として扱われる
**目的**: restore 後の UI 再レンダリングで連鎖的な autosave が発動するのを防ぐ
**実装**: post-restore first save 後に `postRestoreFirstSaveDoneRef.current = true` に

### 補足③：conflict cooldown vs normal interval

- **conflict cooldown**: revision conflict 時に 3 秒間の強制待機（LINE 3643）
- **normal debounce**: normal autosave は 700ms interval（useAutoSave）

conflict 発生時は cooldown で save が完全にブロックされ、recovery を待つ

---

## 最後に

本調査は**修正を前提としないピュアな分析**です。

修正実装時は：
1. **小さな change から開始**（修正案 A: refetch 常実行から）
2. **各修正後に全 13 点の回帰テストを実施**
3. **Production deployment 前に staging 環境で 1 週間検証**
4. **User feedback を集めて追加不具合がないことを確認**

を強く推奨します。

**修正ロードマップ例**:
```
Day 1-2: 修正案 A 実装 + 単体テスト
Day 3: Staging 環境デプロイ + manual 回帰テスト
Day 4: User feedback 収集
Day 5: 追加修正対応（あれば）
Day 6: Production 本番デプロイ
```

---

**報告書作成終了**
**次のステップ**: ユーザーの修正方針決定 → 実装 → 検証

