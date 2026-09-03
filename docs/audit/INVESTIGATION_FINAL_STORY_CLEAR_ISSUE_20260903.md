# clearしたEdited/Final がDBで残る理由 - 調査報告（パート1）
**調査日**: 2026-09-03  
**対象**: final_story_edited / final_story_final が新規 Final Story 生成時に cleared するはずだが、DB に旧値が残る問題

---

## 背景

- 対象 company: `a848db22-68ac-4672-bdf0-e65e8c70fc0b`
- 対象 strategy_data.id: `8456b1ca-bf9b-4c78-ade5-402c305de180`
- DB 実態：
  - `final_story_draft`: 4029 bytes ✓（新規生成）
  - `final_story_edited`: 2413 bytes ✗（古い値が残っている）
  - `final_story_final`: 1494 bytes ✗（古い値が残っている）

**期待**：新規 Final Story 生成時に edited/final は `[]` (empty array) に cleared される

---

## 調査進捗

### ✅ 確認済み（問題なし）

#### 1. clear 処理は確実に実行されている
- **ファイル**: `app/stage2/page.tsx` line 3312-3314
- **処理**:
  ```typescript
  (store as any).setFinalStoryEdited([]);    // ← CLEAR
  (store as any).setFinalStoryFinal([]);     // ← CLEAR
  (store as any).setFinalStory([]);          // ← CLEAR
  ```
- **タイミング**: API 応答受信直後（`finalStoryDraft` が新規生成に置き換わった直後）

#### 2. 空配列は store に記録される
- **ファイル**: `store/strategyStore.ts` line 2444-2454
- **実装**:
  ```typescript
  setFinalStoryEdited: (chapters: StoryChapter[]) => {
    set((s) => ({ 
      ...s, 
      finalStoryEdited: chapters,  // ← [] を受け入れる
      dirty: true, 
      version: (s.version ?? 0) + 1 
    }));
  }
  ```
- **結果**: `finalStoryEdited: []` が store に記録される ✓

#### 3. pruneUndefinedDeep は空配列を保持
- **ファイル**: `utils/supabase/strategy.ts` line 363-379
- **実装**:
  ```typescript
  function pruneUndefinedDeep<T = any>(input: T): T {
    if (Array.isArray(input)) {
      return input.map((v) => pruneUndefinedDeep(v))
        .filter((v) => v !== undefined) as T;  // ← undefined だけ除外
    }
    // ...
  }
  ```
- **結果**: `[]` は通過（`undefined` ではなく、`Array.isArray([])` が true）✓

#### 4. buildDbRowFromState は ensureArray() で適切に処理
- **ファイル**: `utils/supabase/strategy.ts` line 598-649
- **実装**:
  ```typescript
  if (snake === 'final_story_edited') v = ensureArray(v);
  // ensureArray([]) → parseJson([]) → Array.isArray([]) → [] のまま
  ```
- **結果**: `final_story_edited: []` は DB row に含まれる ✓

#### 5. updatePayload は正しく構築されている
- **ファイル**: `utils/supabase/strategy.ts` line 2165-2176
- **実装**:
  ```typescript
  const updatePayload: any = {
    ...baseRow,  // ← baseRow に final_story_edited: [] が含まれている
    departments: normalizedDepartmentsForSave,
    finance_pl: ...
  };
  ```
- **結果**: 空配列を含む updatePayload が作成される ✓

#### 6. UPDATE WHERE 句は正しく指定されている
- **ファイル**: `utils/supabase/strategy.ts` line 2283-2301
- **実装**:
  ```typescript
  let updateQuery = supabase
    .from(T_STRATEGY)
    .update(updatePayload)
    .eq('company_id', cleanCompanyId)
    .eq('id', (mergedState as any).id)  // ← CRITICAL FIX: 特定 row を指定
    .eq('revision', expectedRev);        // ← optimistic locking
  ```
- **結果**: 複数 row 更新は防止されている ✓

---

### ❓ 未確認（次の調査対象）

#### 7. savePayload に finalStoryEdited/final が実際に含まれているか
- **ファイル**: `app/stage2/page.tsx` line 3391-3395
- **処理**:
  ```typescript
  const savePayload = {
    ...storeState,  // ← cleared store state
    finalStoryDraft: newFinalStory,
    stage2FinalDocumentEdits: ...
  };
  ```
- **問題**: 診断ログがない → savePayload に `finalStoryEdited: []` が本当に含まれているか不明
- **確認必要**: console.log で savePayload の内容を確認

#### 8. Supabase UPDATE が final_story_edited: [] を実際に SET しているか
- **ファイル**: `utils/supabase/strategy.ts` line 2304
- **処理**:
  ```typescript
  const upd = await updateQuery.select('*').maybeSingle();
  ```
- **問題**: UPDATE 後の検証ログがない → DB 側で実際に [] が SET されたのか、旧値が残ったのか不明
- **確認必要**: upd.data の final_story_edited を確認

#### 9. データベース側で trigger が field を modify していないか
- **対象**: `bump_strategy_data_revision` など
- **疑い**: UPDATE trigger が edited/final を restore/preserve していないか
- **確認必要**: schema_remote_20260708.sql の trigger 定義を確認

#### 10. RLS policy で UPDATE が制限されていないか
- **対象**: final_story_edited / final_story_final の UPDATE 権限
- **疑い**: RLS が [] への UPDATE をブロックしていないか
- **確認必要**: auth.policies を確認

#### 11. 別端末 localStorage が hydrate 時に干渉していないか
- **ファイル**: `store/strategyStore.ts` line 2449-2466
- **実装**: empty-overwrite guard が存在する
  ```typescript
  if (Array.isArray((guardedHydratedState as any).finalStoryEdited) && 
      (guardedHydratedState as any).finalStoryEdited.length === 0 && 
      Array.isArray((storeState as any).finalStoryEdited) && 
      (storeState as any).finalStoryEdited.length > 0) {
    delete (guardedHydratedState as any).finalStoryEdited;  // ← BLOCK
  }
  ```
- **結論**: empty array from DB は store の populated value を override しない ✓
- **ただし**: 反対方向（stored populated → DB empty）は？

---

## データフロー確認

```
新規 Final Story 生成
  ↓
API response
  ↓
setFinalStoryDraft(newFinalStory)     ← 新規に置き換え
setFinalStoryEdited([])               ← CLEAR
setFinalStoryFinal([])                ← CLEAR
setFinalStory([])                     ← CLEAR
  ↓
store.finalStoryEdited = []          ✓ 確認済み
store.finalStoryFinal = []           ✓ 確認済み
  ↓
savePayload = { ...storeState, finalStoryDraft: newFinalStory, ... }
  ↓ ❓ ここで finalStoryEdited: [] が含まれているか？
prunedIncoming = pruneUndefinedDeep(savePayload)
  ↓
mergedState = prunedIncoming
  ↓
baseRow = buildDbRowFromState(mergedState)
  ↓ ❓ ここで final_story_edited: [] が含まれているか？
updatePayload = { ...baseRow, departments, ..., final_story_edited: [], ... }
  ↓
updateQuery.update(updatePayload)
  ↓ ❓ Supabase が実際に [] で SET しているか？
UPDATE strategy_data SET final_story_edited = [] WHERE company_id = ? AND id = ?
  ↓ ❓ DB trigger が field を modify していないか？
DB row: final_story_edited = 旧値（1494 bytes）のままになっている ✗
```

---

## 根本原因の候補

### A. savePayload に finalStoryEdited/final が含まれていない
- **原因**: store.setFinalStoryEdited([]) が呼ばれても、store への反映に遅延がある
- **or**: savePayload 作成前に別のセッターが呼ばれて上書きされている
- **検証**: savePayload console.log

### B. updatePayload に final_story_edited が含まれているが、Supabase が無視している
- **原因**: empty array `[]` を Supabase が特別扱いしている
- **or**: JSONB column への [] 更新が失敗している
- **検証**: updatePayload console.log + upd.data 確認

### C. Database trigger が edited/final を preserve/restore している
- **原因**: `bump_strategy_data_revision` trigger が `NEW.final_story_edited := OLD.final_story_edited` を実行
- **or**: column default が trigger で設定されている
- **検証**: schema_remote_20260708.sql の trigger 確認

### D. RLS policy が UPDATE をブロックしている
- **原因**: final_story_edited の UPDATE 権限がない
- **or**: company_id / user_id でフィルタリングされて UPDATE 対象 row が 0 になっている
- **検証**: auth.policies を確認

### E. 別端末 localStorage が restore 時に復帰させている
- **原因**: Device A で save → Device B で restore → Device C で save 時に、Device B の localStorage が復帰させる
- **検証**: restore 時の empty-overwrite guard ログ確認

---

## 次のステップ

以下の診断情報を collect してください：

### 診断A：savePayload の内容確認
**ファイル**: `app/stage2/page.tsx` line 3395 の直後に追加

```javascript
// ★ DIAGNOSTIC: Check if finalStoryEdited/Final are in savePayload
console.log('[diag][generate-final] savePayload contents', {
  hasFinalStoryEdited: 'finalStoryEdited' in savePayload,
  finalStoryEditedValue: (savePayload as any).finalStoryEdited,
  finalStoryEditedLen: Array.isArray((savePayload as any).finalStoryEdited)
    ? (savePayload as any).finalStoryEdited.length
    : 'not_array',
  hasFinalStoryFinal: 'finalStoryFinal' in savePayload,
  finalStoryFinalLen: Array.isArray((savePayload as any).finalStoryFinal)
    ? (savePayload as any).finalStoryFinal.length
    : 'not_array',
  timestamp: new Date().toISOString(),
});
```

### 診断B：updatePayload の内容確認
**ファイル**: `utils/supabase/strategy.ts` line 2176 の直後に追加

```javascript
// ★ DIAGNOSTIC: Check updatePayload contains final_story_edited/final
if (existingRow) {
  console.log('[SAVE] updatePayload field values', {
    has_final_story_edited: ('final_story_edited' in updatePayload),
    final_story_edited: (updatePayload as any).final_story_edited,
    final_story_edited_len: Array.isArray((updatePayload as any).final_story_edited)
      ? (updatePayload as any).final_story_edited.length
      : 'not_array',
    has_final_story_final: ('final_story_final' in updatePayload),
    final_story_final_len: Array.isArray((updatePayload as any).final_story_final)
      ? (updatePayload as any).final_story_final.length
      : 'not_array',
  });
}
```

### 診断C：Supabase UPDATE 結果の確認
**ファイル**: `utils/supabase/strategy.ts` line 2304 の直後に追加

```javascript
// ★ DIAGNOSTIC: Check if DB actually received and stored the empty arrays
if (upd.data) {
  console.log('[SAVE] DB response after UPDATE', {
    returned_final_story_edited: (upd.data as any).final_story_edited,
    returned_final_story_edited_len: Array.isArray((upd.data as any).final_story_edited)
      ? (upd.data as any).final_story_edited.length
      : 'not_array',
    returned_final_story_final: (upd.data as any).final_story_final,
    returned_final_story_final_len: Array.isArray((upd.data as any).final_story_final)
      ? (upd.data as any).final_story_final.length
      : 'not_array',
    returned_revision: (upd.data as any).revision,
  });
}
```

これらのログを collect してから、次の調査段階に進んでください。
