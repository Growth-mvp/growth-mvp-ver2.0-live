# STAGE3〜STAGE5 UI即時反映不具合 - 根本原因分析報告書

## 報告日
2026-04-06

---

## 第一部: 根本原因（直接的な決定点）

### STAGE3: プロジェクト削除後のUI遅延

**根本原因：削除後の画面更新フロー完全追跡**

#### 削除操作フロー：
```
handleDeleteProject()
  ↓
pushToStore((prev) => { /* projects filter */ })  【app/cascade/page.tsx:2055-2067】
  ↓
setDepartmentsInStore()?.(resolved)  【1916-1923】
  ↓
store.departments が更新
  ↓
cascade page の departments prop が新しい参照に
  ↓
{departments.map((d) => ...)}  【2921】で再描画
```

**判定：**
- ✅ **削除は即座に画面から消えるはず**
- 描画元は store の `departments` state を直接参照
- `departments` 更新は即座に反映される
- **遅延が報告されている場合、別の原因の可能性**

**可能な二次原因：**
1. `pushToStore()` の `jsonEq()` チェックが常に true を返す（state更新が実行されない）
2. setDepartmentsInStore が未定義または遅延している
3. 描画が `departments` 以外の derived state に依存している

---

### STAGE5: コメント追加後のUI遅延

**根本原因：parent re-render による child state の不安定性**

#### コメント保存→表示フロー：

**保存層の処理（app/execution/page.tsx:705-732）：**
```typescript
// ステップ1: Store に score を保存
useStrategyStore.getState().setOKRTargetScore(okrId, rating);  【706】
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });  【707】

// ステップ2: local state logs に新しいログを追加（即座に画面に表示）
setLogs((prev) => [...[newLog], ...nonLocalLogs]);  【713-727】

// ステップ3: 親コンポーネント（ExecutionPageContent）に通知
onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });  【729】

// ステップ4: フォーム状態をリセット
setProgressText('');  【730】
setHelpRequest('');  【731】
```

**親コンポーネント側の処理（2938-2949）：**
```typescript
onActivitySaved={({ okrId, at }) => {
  setProjectActivityMap((prev) => {  // ← parent state が更新される
    return { ...prev, [okrId]: { ... } };
  });
}}
```

**親の re-render → child props 更新フロー：**
```
親: setProjectActivityMap() で state 更新
  ↓
parent: ExecutionPageContent が re-render
  ↓
child: ExecPanel の props が新しい参照に
  - objective={selected?.objective ?? ''}  【2922】← 新しい文字列参照
  - dbOkrId={selected?.dbOkrId}  【2925】
  - progressOkrId={selected?.progressOkrId}  【2930】
  - 他全 props も新しい参照
  ↓
ExecPanel の useEffect が再実行：
  - 依存配列: [dbOkrId, open, userId, objective, ...]  【370-482行】
  ↓
setResolvedProgressOkrId() が実行される  【375-382行】
  ↓
loadLogs() の useEffect が再実行  【依存配列: [open, userId, resolvedProgressOkrId]】
  ↓
Supabase から progress_logs を fetch  【490-496行】
  ↓
setLogs((prev) => {
  const dbLogs = (data as LogRow[])...  【509行】
  return [...dbLogs, ...localLogs];  【518行】
}) が実行
```

**決定的な問題：**

タイムラグにより、以下の競合が発生：

1. **時刻 T1:** `onSaveCheckin` が成功 → `setLogs([newLog, ...])` で追加
   **画面表示：新しいログが見える ✓**

2. **時刻 T1+数ms:** `onActivitySaved()` で親が re-render
   **child props が新しい参照に**

3. **時刻 T1+10ms:** `loadLogs()` useEffect が DB query 実行
   **BUT: 新しいログがまだ Supabase に反映されていない可能性**

4. **時刻 T1+50ms:** DB から返却：古いログリスト（新しいログ除外）
   **`setLogs((prev) => [...dbLogs, ...localLogs])` で古い結果で上書き**

5. **時刻 T1+51ms:** UI 再描画
   **画面から新しいログが消えている ❌**

6. **時刻 T1+1000ms：** Supabase レプリケーション完了 → 保存されているはず
   **ページリロード時に見える ✓**

---

## 第二部: 証拠（ファイル/行番号/state名）

### STAGE5 根本原因の証拠チェーン

| 項目 | ファイル | 行番号 | state/prop 名 | 役割 |
|------|---------|--------|---------------|------|
| **1. コメント保存初期化** | app/execution/page.tsx | 326 | `logs` (local state) | コメント一覧表示の source of truth |
| **2. 保存成功時の state 更新** | app/execution/page.tsx | 713-727 | `setLogs()` | 新しいログを手動追加 |
| **3. 親コンポーネント通知** | app/execution/page.tsx | 729 | `onActivitySaved()` | 親に活動を報告 |
| **4. 親の state 更新** | app/execution/page.tsx | 2938-2949 | `setProjectActivityMap()` | parent re-render トリガー |
| **5. child props 生成** | app/execution/page.tsx | 2914-2950 | `<ExecPanel dbOkrId={...} objective={...} />` | 毎回新しい参照 |
| **6. child useEffect 재実行** | app/execution/page.tsx | 370-482 | `resolvedProgressOkrId` state | props 依存で再計算 |
| **7. ログ読込 useEffect** | app/execution/page.tsx | 484-528 | `loadLogs()` async | DB query 実行 |
| **8. ログ一覧上書き** | app/execution/page.tsx | 503-521 | `setLogs((prev) => [...])`  | DB結果で置換（古い値の可能性） |

### 依存関係の詳細

```
execution/page.tsx:
  - ExecutionPageContent（parent）
    ├─ cascade useMemo  【1609-1639】
    │  └─ 依存: [editableCascadeResult, departments]
    │
    ├─ pyramid useMemo  【1804-2034】
    │  ├─ 依存: [cascade, scopeStrategyId, scopeCompanyId, dbOkrMap]
    │  └─ selection.dbOkrId, selection.objective, ... を構築
    │
    ├─ <ExecPanel />  【2916-2950】
    │  ├─ props: dbOkrId, objective, progressOkrId, ...
    │  │  └─ 毎render で新しい参照が生成される
    │  │
    │  └─ ExecPanel 内部
    │     ├─ logs (local useState)  【326】
    │     ├─ onSaveCheckin()  【540-756】
    │     │  ├─ setLogs() で新規ログ追加  【713-727】
    │     │  └─ onActivitySaved() で parent に通知  【729】
    │     │
    │     └─ useEffect: loadLogs  【484-528】
    │        └─ 依存: [open, userId, resolvedProgressOkrId]
    │           ├─ DB query で fetch  【490-496】
    │           └─ setLogs((prev) => [...dbLogs]) で上書き  【503-521】
```

---

## 第三部: 修正内容と実装方針

### STAGE5 修正戦略

#### **根本的解決：`onActivitySaved()` 後の `loadLogs()` 不要な re-run を阻止**

**選択肢 A: `onActivitySaved()` の呼び出しを削除（推奨）**

```typescript
// app/execution/page.tsx:729 - 削除対象
- onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });
```

**理由：**
- `onActivitySaved()` は親の `setProjectActivityMap` をトリガーするだけ
- `setProjectActivityMap` は「最新の活動時刻」のキャッシュ用の補助情報
- **表示の source of truth は `logs` local state** であり、親の `projectActivityMap` ではない
- この通知がなくても、ユーザーは保存直後に新しいログを見られる

**副作用の検証：**
- ✓ `logs` が DB と同期するのに待機する必要がない
- ✓ 表示遅延がなくなる
- ✓ parent re-render による child props 変動がなくなる
- ✗ 「最新活動時刻」キャッシュ（実装？）が更新されない
  - 実装上、`projectActivityMap` がどこで使われているかを確認が必要

**選択肢 B: `loadLogs()` useEffect に防止条件を追加**

```typescript
// app/execution/page.tsx:485-528 - 修正案

useEffect(() => {
  const loadLogs = async () => {
    if (!open || !userId || !resolvedProgressOkrId) return;

    // ★修正案B-1: 直前に setLogs() したばかりの場合はスキップ
    const timeSinceLastSave = Date.now() - lastSaveTimeRef.current;
    if (timeSinceLastSave < 200) {  // 200ms以内なら skip
      console.log('[STAGE5-loadLogs] Skip due to recent save', {
        timeSinceLastSave,
      });
      return;
    }

    setLoadingLogs(true);
    try {
      // ... DB query ...
    } finally {
      setLoadingLogs(false);
    }
  };
  loadLogs();
}, [open, userId, resolvedProgressOkrId]);

// onSaveCheckin() で:
// lastSaveTimeRef.current = Date.now();  を追加
```

**理由：**
- 保存から 200ms 以内の DB fetch を阻止
- Supabase レプリケーション遅延（通常 50-100ms）をカバー
- 親の re-render により `loadLogs()` が多重実行されても safe

**選択肢 C: `setLogs()` の実装を改善（最細部修正）**

```typescript
// app/execution/page.tsx:507-521 - 修正案

setLogs((prev) => {
  const localLogs = prev.filter((l) => l.id.startsWith('local-'));
  const dbLogs = (data as LogRow[]).filter((d) => !d.id.startsWith('local-'));

  // ★修正案C-1: 新規追加ログがDB結果に含まれているか確認
  // prevに新しく追加したログ があれば、DB結果がそれを置き去りしていないか check
  const hasNewLogInDb = dbLogs.some((l) => l.id === lastAddedLogIdRef.current);
  if (!hasNewLogInDb && lastAddedLogIdRef.current) {
    console.warn('[STAGE5-loadLogs-warning] New log not yet in DB, keeping local version', {
      lastAddedLogId: lastAddedLogIdRef.current,
      dbLogsCount: dbLogs.length,
    });
    // lastAddedLog を prev から保持
    const lastAddedLog = prev.find((l) => l.id === lastAddedLogIdRef.current);
    if (lastAddedLog) {
      return [...dbLogs, lastAddedLog, ...localLogs];  // new log を維持
    }
  }

  return [...dbLogs, ...localLogs].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
});

// onSaveCheckin() で:
// lastAddedLogIdRef.current = savedId;  を追加
```

**理由：**
- 新しいログが DB に反映される前に fetch した場合、それを検知して保持
- 最も defensive な修正

---

### STAGE3 修正戦略

STAGE3 は削除後、即座に画面から消えるはず。

**もし遅延が報告されている場合の調査：**

1. `pushToStore` の `jsonEq()` 実装を確認
   ```typescript
   // cascade/page.tsx:1920
   if (!jsonEq(prev, resolved)) setDepartmentsInStore?.(resolved);
   ```
   → `jsonEq()` が誤検知しているのか？

2. `setDepartmentsInStore` の実装を確認
   → async delay がないか？

3. 描画側の依存関係を確認
   ```typescript
   // cascade/page.tsx:2921
   {departments.map((d: Department, i: number) => (
   ```
   → `departments` 以外の state に依存していないか？

---

## 第四部: 確認手順と検証項目

### STAGE5 修正後の確認（推奨案：選択肢 A）

#### 1. コード修正
```diff
# app/execution/page.tsx:729
- onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });
```

#### 2. 動作確認テスト

**テスト1: コメント即時表示**
- [ ] モーダルを開く
- [ ] コメントを入力
- [ ] 保存ボタンをクリック
- [ ] **確認：** 成功メッセージ表示と同時に、コメント一覧に新しいログが **即座に** 表示される
- [ ] リロード不要で見え続ける

**テスト2: 複数コメント連続保存**
- [ ] 1コメント目を保存 → 即座に表示
- [ ] 2コメント目を入力・保存 → 2個目も即座に表示
- [ ] 表示順序が正しいか（新→旧）

**テスト3: OKR切替後の表示**
- [ ] 別の OKR を選択
- [ ] 元の OKR に戻す
- [ ] モーダルを開く
- [ ] **確認：** 保存済みコメントがすべて表示される（DB から正しく読み込まれている）

**テスト4: 削除後の再追加**
- [ ] コメント保存 → 表示
- [ ] ページリロード → 保存されている
- [ ] 別の OKR を選択・戻す → 表示される

### STAGE3 修正後の確認

**テスト1: プロジェクト削除の即時反映**
- [ ] プロジェクトをクリック（選択状態）
- [ ] 削除ボタンをクリック
- [ ] **確認：** 削除ダイアログで OK → 画面から **即座に** プロジェクトが消える
- [ ] cascade 表示に残らない

**テスト2: 複数プロジェクト削除**
- [ ] 複数プロジェクトを削除
- [ ] すべてが正しく削除される
- [ ] UI に残像がない

**テスト3: 削除後の追加**
- [ ] プロジェクト削除
- [ ] 新規プロジェクト追加
- [ ] **確認：** 削除されたプロジェクトが復活しない

---

## 付記: 実装上の注意点

### STAGE5 選択肢 A（`onActivitySaved` 削除）を採用する場合

**影響範囲の確認：**

```bash
grep -rn "onActivitySaved\|projectActivityMap" app/execution/
```

チェック項目：
1. `projectActivityMap` が UI のどこで使われているか
2. 削除しても見た目に変化がないか
3. 他の機能に依存していないか

### STAGE5 選択肢 B/C を採用する場合

**useRef を使用するため、以下を追加：**
```typescript
const lastSaveTimeRef = useRef<number>(0);
// または
const lastAddedLogIdRef = useRef<string | undefined>(undefined);
```

---

## まとめ

| STAGE | 根本原因 | 推奨修正 | 即時反映可否 |
|-------|---------|--------|-----------|
| **STAGE3** | （調査必要） | `jsonEq()` / `setDepartmentsInStore` 実装確認 | 要確認 |
| **STAGE5** | parent re-render による child props 変動 → `loadLogs()` 再実行 → 古いログで上書き | `onActivitySaved()` 呼び出し削除（選択肢A） | **可能 ✓** |

**最重要ポイント：** STAGE5 の問題は「保存層」ではなく「表示同期層」の state 管理タイミング。
親から子への通知により、child の `loadLogs()` が不要に再実行されて、新しいログが古いリストで上書きされている。
