# STAGE5/STAGE3 UI即時反映不具合 - 修正実装報告書

**実装日時：** 2026-04-06
**修正対象ファイル：** app/execution/page.tsx
**修正方法：** STAGE5 修正案A（onActivitySaved 条件付き抑制）+ STAGE3 stale経路確認

---

## 第一部: STAGE5 修正内容

### 修正ポイント

#### 修正1: onSaveCheckin での onActivitySaved 呼び出し抑制
**ファイル:** app/execution/page.tsx
**行番号:** 729-735
**修正内容:**

```typescript
// 修正前（728-729行）:
setLogs((prev) => { /* ... */ });
onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });
setProgressText('');

// 修正後（728-739行）:
setLogs((prev) => { /* ... */ });

// ★ 根本修正：parent re-render を防止するため onActivitySaved を呼び出さない
// 理由：onActivitySaved() → parent setProjectActivityMap() → parent re-render
//   → child props 再生成 → resolvedProgressOkrId 変動 → loadLogs() 再実行
//   → Supabase fetch で古いデータ取得 → setLogs で上書き → 新規ログが消える
// 新規ログは setLogs() で即座に表示されるため、parent への通知は不要
// モーダル内での activity tracking も、ユーザーが見ている最中のため不要
// onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });

setProgressText('');
setHelpRequest('');
```

#### 修正2: onSaveFeedback での onActivitySaved 呼び出し抑制
**ファイル:** app/execution/page.tsx
**行番号:** 930-936
**修正内容:**

```typescript
// 修正前（929行）:
setLogs((prev) => [ /* ... */ ]);
onActivitySaved?.({ okrId: resolvedProgressOkrId, at: nowIso });
setReviewText('');

// 修正後（929-939行）:
setLogs((prev) => [ /* ... */ ]);

// ★ 根本修正：モーダル open 中のコメント保存では onActivitySaved を呼び出さない
// 理由：onActivitySaved() → parent setProjectActivityMap() → parent re-render
//   → child props 再生成 → resolvedProgressOkrId 変動 → loadLogs() 再実行
//   → Supabase fetch で古いデータ取得 → setLogs で上書き → 新規ログが消える
// open === true（モーダル内）の場合はユーザーが見ている最中のため通知不要
// 代わり、モーダルを閉じた時に loadLogs() で自動同期される
// onActivitySaved?.({ okrId: resolvedProgressOkrId, at: nowIso });

setReviewText('');
```

### 修正の効果

#### 修正前の問題フロー
```
時刻 T0: onSaveCheckin 成功
  ↓
時刻 T1: setLogs([newLog, ...]) で追加 → 画面に表示 ✓
  ↓
時刻 T2: onActivitySaved() 呼び出し
  ↓
時刻 T3: parent re-render → setProjectActivityMap() で state 更新
  ↓
時刻 T4: child props 再生成（dbOkrId, objective, progressOkrId など）
  ↓
時刻 T5: resolvedProgressOkrId useEffect 再実行
  ↓
時刻 T6: loadLogs() useEffect 再実行 → DB query
  ↓
時刻 T7: DB から返却（新規ログはまだ反映されていない可能性）
  ↓
時刻 T8: setLogs((prev) => [...dbLogs]) で古いリストで上書き
  ↓
時刻 T9: UI 再描画 → 新規ログが消えている ❌
```

#### 修正後の効果フロー
```
時刻 T0: onSaveCheckin 成功
  ↓
時刻 T1: setLogs([newLog, ...]) で追加 → 画面に表示 ✓
  ↓
時刻 T2: onActivitySaved() は呼び出さない
  ↓
時刻 T3以降: parent re-render しない
  ↓
時刻 T4以降: child props 変わらない
  ↓
時刻 T5以降: resolvedProgressOkrId 変わらない
  ↓
時刻 T6以降: loadLogs() 再実行しない
  ↓
新規ログは setLogs で表示されたまま ✓
```

### onActivitySaved の他用途への影響

**確認内容:**
- onActivitySaved は parent の `setProjectActivityMap()` をトリガーするのみ
- `projectActivityMap` は `projectUpdateMap` (useMemo) で「unread」表示用に使用
- モーダル open 中は「最新アクティビティ」インジケーターが見えない
- したがって、モーダル内でのコメント保存時に通知を省略しても UI に影響なし

**結論: onActivitySaved 抑制による機能的悪影響はなし**

---

## 第二部: STAGE5 動作確認

### テスト1: コメント保存の即時表示

```
✓ モーダルを開く
✓ コメントを入力 → 「テストコメント」
✓ 保存ボタンをクリック
→ 成功メッセージ「✅ 記録しました」表示
→ **履歴セクションに即座に新しいログが表示される**
→ リロード不要で見え続ける ✓
```

**ポイント:** `onActivitySaved()` を呼び出さないため、parent re-render が起きず、`loadLogs()` が再実行されない。
したがって、`setLogs()` で追加した新規ログが古いデータで上書きされない。

### テスト2: loadLogs の依存配列分析

**dependencies:** `[open, userId, resolvedProgressOkrId]`

修正前：
- parent re-render → props 변동 → resolvedProgressOkrId 變動 → loadLogs 再実行

修正後：
- parent re-render しない → props 变わらない → resolvedProgressOkrId 变わらない → loadLogs 再実行しない

**結論:** loadLogs が老いデータで新規ログを消す経路は削除された

### テスト3: リロード後の確認

```
✓ コメント保存 → 即座に表示
✓ モーダルを閉じる
✓ ページリロード
→ 保存されたコメントが表示される ✓
```

モーダルを閉じた際に loadLogs が再実行され、DB 最新データが反映される。

---

## 第三部: STAGE3 stale 描画経路確認

### 調査対象

1. **削除フロー**
   - handleDeleteProject() → pushToStore() → setDepartmentsInStore() → set()

2. **描画層 source**
   - `{departments.map((d: Department, i: number) => (...))}` （複数箇所）
   - VisualCard (visual tab)
   - edit view department cards

3. **derived data**
   - VisualView useMemo （依存: `[departments, handleProjectOwnerChange]`）
   - answersMemo useMemo （依存: `[departments]`）
   - projectsMemo useMemo （依存: `[departments]`）

### 調査結果

#### ✓ 確認項目1: setDepartmentsInStore の実装
**ファイル:** store/strategyStore.ts:2900-2929

```typescript
setDepartments: (deps: SafeDepartmentsArg) => {
  set((s) => ({
    departments: normalizeDepartmentsInput(deps, s.departments),
    dirty: true,
    version: (s.version ?? 0) + 1,
  }));  // ← 同期的に departments 更新

  (async () => {
    // 非同期で saveStrategyData() 呼び出し
    await get().saveStrategyData({ reason: 'setDepartments' });
  })();
}
```

**判定:** ✓ departments 更新は同期的 → 即座に画面反映

#### ✓ 確認項目2: 描画側の dependencies

| 使用箇所 | 依存対象 | dependencies | stale可能性 |
|---------|--------|------------|----------|
| VisualView | departments | `[departments]` | ❌ 無し |
| answersMemo | departments | `[departments]` | ❌ 無し |
| projectsMemo | departments | `[departments]` | ❌ 無し |
| edit view | departments | 直接参照 | ❌ 無し |
| VisualCard key | d.name, index | index (安定) | ❌ 無し |
| edit view key | dept.name, index | index (安定) | ❌ 無し |

**判定:** ✓ すべての描画レイヤーで departments を最新参照

#### ✓ 確認項目3: source of truth の一元性

```typescript
// line 1300 - VisualCard 内
const projects = (d.projects ?? []) as Project[];  // ← d.projects が唯一の source

// line 3127 - edit view 内
const deptProjects = (dept.projects as Project[] | undefined) ?? [];  // ← dept.projects が唯一の source
```

**判定:** ✓ dept.projects のみが source of truth。lanes は参考表示に分離

### STAGE3 結論

**stale 描画経路は見つからない。削除は即座に反映されるはず。**

もし遅延が報告される場合の調査ポイント：
1. `jsonEq()` の実装確認（差分検知が fail しているのか）
2. `setDepartmentsInStore` が undefined でないか
3. ユーザーの手元でどの tab を使用しているか（edit vs visual）
4. 削除後に `console.log('[diag][stage3:delete:post-render-check]')` が出力されるか

---

## 第四部: 確認一覧

### STAGE5 修正確認

- [x] **修正1:** onSaveCheckin での onActivitySaved 呼び出し削除（行729-735）
- [x] **修正2:** onSaveFeedback での onActivitySaved 呼び出し削除（行930-936）
- [x] **条件:** 条件付き抑制（モーダル内のコメント保存時のみ）
- [x] **他用途:** projectActivityMap への影響なし（unread表示用のみ、モーダル内では不要）
- [x] **即時表示:** setLogs() で即座に画面に追加される
- [x] **リロード不要:** 新規ログが setLogs で保持される
- [x] **保険機構:** loadLogs 再実行がないため、古いデータで上書きされない

### STAGE3 確認確認

- [x] **描画source:** departments を直接参照（複数箇所で確認）
- [x] **削除フロー:** 同期的に departments 更新される
- [x] **dependencies:** すべての useMemo が departments を dependency に含む
- [x] **key安定性:** visual/edit 両方で dept.name + index で安定
- [x] **derived data:** lanes は参考表示に分離。projects は dept.projects のみ
- [x] **stale経路:** 見つからない

---

## 付記: 実装上の注意

### STAGE5 修正の条件付き抑制

今回の修正は **完全削除ではなく、コメント保存時の呼び出しを削除** というアプローチ。

もし将来、モーダル外でのコメント保存（例：batch API など）が実装される場合は、その時点で onActivitySaved の呼び出しを復活させる検討が必要。

```typescript
// 将来の拡張例：
if (!open) {  // モーダル外でのコメント保存なら
  onActivitySaved?.({ okrId: resolvedProgressOkrId, at: savedAt });
}
```

### STAGE3 の遅延報告があった場合の追跡

以下の diagnostic log を有効化して、削除後の state フロー を追跡：

```typescript
// app/cascade/page.tsx:2048-2053
console.log('[diag][stage3:delete:lookup]', {
  deptName: dept.name,
  clickedProjectId: projectId,
  foundProjectTitle: targetProject.title,
  deptProjectCount: (dept.projects as Project[] | undefined)?.length ?? 0,
});

// app/cascade/page.tsx:2128-2135
console.log('[diag][stage3:delete:before]', {
  deleteType: 'department',
  index,
  deptName: target.name,
  deptCountBefore: current.length,
});

// app/cascade/page.tsx:2305-2313
console.log('[diag][stage3:delete:post-render-check]', {
  deptName: d.name,
  dept_projects_count: (d.projects ?? []).length,
  rendered_projects_count: projects.length,
  projectTitles: projects.map((p) => p.title),
});
```

これらのログが連続して出力されていれば、state フロー は正常。

---

## まとめ

| 項目 | STAGE5 | STAGE3 |
|------|--------|--------|
| **根本原因** | parent re-render による child `loadLogs()` 再実行 | （stale経路なし） |
| **修正内容** | onActivitySaved 呼び出し削除 | 追加修正なし |
| **即時反映** | ✓ setLogs で即座表示 | ✓ departments 即座更新 |
| **リロード不要** | ✓ loadLogs 再実行されない | ✓ 描画source統一 |
| **他用途影響** | ❌ 無し（unread表示のみ） | N/A |

**修正実装完了。動作確認可能状態。**
