# 修正計画：autosave race condition - old localStorage state がDBに上書きされる問題

**問題**: 別端末で STAGE2 を開いただけで、古い localStorage の finalStoryEdited/final が DB に autosave される

**根本原因**: Zustand persist が localStorage data を同期的に復元（finalStoryEdited=[old]）する際、DB restore がまだ非同期で pending 状態。その間に autosave が old data で fire

**根拠**:
```
別端末でSTAGE2を開く前：DB draft=4, edited=0, final=0
別端末でSTAGE2を開く（何も操作しない）
→ updated_at が変わり、edited=4, final=4 に復活
（ユーザー操作なし）
```

---

## 修正方針

### 修正原則（プロンプト指示より）

1. 初回ロードでは DB を優先
2. localStorage の旧 STAGE2 生成物で DB を上書きしない
3. hydrate/restore は dirty にしない
4. ユーザー操作なしでは autosave しない
5. DB restore 完了前は autosave 禁止

---

## 修正案

### 案 A：最小限（推奨）

**ファイル**: `store/strategyStore.ts` line 4839-4900（partialize 関数）

**変更内容**: persist から finalStoryEdited / finalStoryFinal / finalStory を **除外** する

**理由**: 
- これらの field は DB restore 時に DB が source of truth
- 別端末の old localStorage 値を restore する理由がない
- STAGE2 生成物なので、generate する度に再生成される
- 保存する価値がない（生成 API の結果物だから）

**実装**:
```typescript
// store/strategyStore.ts line 4839-4900
partialize: (s) => {
  // ★ FIX: Exclude STAGE2 generation artifacts to prevent race condition
  // Don't persist old finalStoryEdited/final - DB is source of truth on restore
  return {
    companyId: s.companyId,
    strategyId: s.strategyId,
    pendingCompanyId: s.pendingCompanyId,
    
    // ★ STAGE2 fields（edited/final は除外）
    story: s.story,
    finalStory: undefined,  // ← EXCLUDE
    finalStoryDraft: s.finalStoryDraft,
    finalStoryEdited: undefined,  // ← EXCLUDE（old値を復元しない）
    finalStoryFinal: undefined,   // ← EXCLUDE（old値を復元しない）
    
    // ... other fields ...
    ceoIntent: s.ceoIntent,
    storyDraft: s.storyDraft,
    answers2: s.answers2,
    answers12: s.answers12,
    // ... departments, finance, etc. ...
    
    // ★ Zustand internal state
    loaded: false,
    dirty: false,
    version: 0,
  };
}
```

**影響範囲**:
- localStorage に保存されるデータサイズが若干減（edited/final を除外）
- 別端末でも STAGE2 を開く度に DB から最新 state を restore（正しい動作）
- 既存の localStorage data は下位互換（undefined fields は ignore）

---

### 案 B：フォールバック（より安全）

案 A が影響大なら、`migrate()` で明示的に clear：

**ファイル**: `store/strategyStore.ts` line 4910-4921（migrate 関数）

```typescript
migrate: (persisted) => {
  const base = {
    ...emptyData,
    ...(persisted ?? {}),
    boot: { isHydrating: true, isHydrated: false },
    hydrated: false,
    loaded: false,
    dirty: false,
    __isFetchingFromServer: false,
    restoreReady: false,
    isRestoring: true,
  };

  // ★ FIX: Always clear old STAGE2 generation results on init
  // These should come from DB restore, not localStorage
  base.finalStoryEdited = [];
  base.finalStoryFinal = [];
  base.finalStory = [];
  
  return base;
}
```

**利点**:
- partialize の変更不要
- 既存の persist 設定を保持
- 明示的で分かりやすい

---

## 検証方法

### 修正前の検証：問題を再現
```
1. 本番 DB を確認: draft=4, edited=0, final=0, updated_at=T1
2. 別端末でSTAGE2を開く（何も操作しない）
3. 本番 DB を確認: updated_at が T2 に変わり、edited=4, final=4
   → 問題確認
```

### 修正後の検証：問題が解決されたか
```
1. 本番 DB を updated_at=T0, draft=4, edited=0, final=0 に設定
2. 別端末でSTAGE2を開く（何も操作しない）
3. 本番 DB を再確認:
   - draft=4（変わらない）✓
   - edited=0（変わらない）✓
   - final=0（変わらない）✓
   - updated_at は T0 のまま（変わらない）✓
```

---

## 実装手順

### Step 1: 修正コードの準備

案 A（partialize 修正）か案 B（migrate 修正）を選択して実装

### Step 2: 本番 DB をテスト状態に設定

```sql
-- テスト company の strategy_data を確認
SELECT id, company_id, 
  LENGTH(final_story_draft::text) as draft_len,
  LENGTH(final_story_edited::text) as edited_len,
  LENGTH(final_story_final::text) as final_len,
  updated_at
FROM strategy_data
WHERE company_id = 'a848db22-68ac-4672-bdf0-e65e8c70fc0b'
ORDER BY updated_at DESC
LIMIT 1;

-- 結果：draft > 0, edited = 0, final = 0 であることを確認
```

### Step 3: 別端末で STAGE2 を開く

1. 修正を deploy
2. 別端末（old localStorage を持つ）で STAGE2 を開く
3. **何も操作しない**（ページを見ているだけ）

### Step 4: 検証

DB を再 query：
```sql
-- updated_at が変わっていないことを確認
-- edited/final が 0 のままであることを確認
```

---

## 関連するコード

### 影響を受ける可能性のあるコード

1. **useAutoSave guard checks** (`hooks/useAutoSave.ts` line 498-513)
   - `restoreReady` check は残す
   - ただし、old data が restore されなければ guard も効果的

2. **hydrate/restore flow** (`app/stage2/page.tsx` line 2386-2507)
   - 既存のロジックで OK
   - DB restore が source of truth として機能する

3. **empty-overwrite guard** (`store/strategyStore.ts` line 2449-2466)
   - 既存のロジックで OK
   - 修正後は old data が restore されないので動作しない但し害にならない

---

## 修正後の動作フロー（修正案 A の場合）

```
別端末でSTAGE2を開く
  ↓
Zustand persist の migrate() が呼ばれる
  ↓
localStorage から復元（finalStoryEdited/final は undefined → skip）
  ↓
store: {
  finalStoryEdited: undefined（復元されない）
  finalStoryFinal: undefined（復元されない）
  restoreReady: false
  isRestoring: true
}
  ↓
DB restore (restoreWithAudit) async が開始
  ↓
hydrateFromFullState() で DB の clean data をセット
  ↓
store: {
  finalStoryEdited: []（DB から）
  finalStoryFinal: []（DB から）
  restoreReady: true
  isRestoring: false
}
  ↓
autosave 有効化（でも store に変更がないので fire しない）
```

---

## 注意事項

1. **Don't touch**: 新しい Final 生成ロジック、Luna、Prompt、DB schema
2. **最小修正**: finalStoryEdited/final 関連の修正のみ
3. **Verify**: テスト後に必ず本番環境で動作確認
4. **Rollback**: 問題が出たら localStorage key を version 増やして reset（38 に変更）

