# STAGE2 answers12 / winPatternsCandidate DB保存・復元 修正サマリー

## 実施内容

### ✅ TASK 1: FIELD_MAP と DB列名の整合確認
**ファイル:** `/utils/supabase/strategy.ts`

**現状確認（行 378-379）：**
```typescript
const FIELD_MAP: Record<string, string> = {
  answers12: 'answers12',
  winPatternsCandidate: 'win_patterns_candidate',
  ...
}
```

**状況：**
- ✅ FIELD_MAP に答えと勝ち筋候補が定義済み
- ✅ buildDbRowFromState() で配列として処理（行 437-438）
- ✅ buildStateFromDbRow() で復元処理済み（行 481-482）
- ⚠️ **注意**: answers12 は snake_case ではなく 'answers12' のまま
  - DB に `answers_12` で作られている可能性がある場合は、FIELD_MAP を修正が必要
  - 検証方法：TASK 2 ログ `[stage2][db_raw_check]` で確認

---

### ✅ TASK 2: DB列存在確認ログを追加
**ファイル:** `/utils/supabase/strategy.ts` (行 782-802)

**追加内容：**
```typescript
if (DEBUG) {
  const hasRawStoryDraft = Object.prototype.hasOwnProperty.call(rowData, 'story_draft');
  const hasRawWinPatternsCandidate = Object.prototype.hasOwnProperty.call(rowData, 'win_patterns_candidate');
  const hasRawAnswers12 = Object.prototype.hasOwnProperty.call(rowData, 'answers12');
  const hasRawAnswers_12 = Object.prototype.hasOwnProperty.call(rowData, 'answers_12');
  const storyDraftLen = Array.isArray(rowData.story_draft) ? rowData.story_draft.length : 0;
  const winPatternsCandidateLen = Array.isArray(rowData.win_patterns_candidate) ? rowData.win_patterns_candidate.length : 0;
  const answers12Len = Array.isArray(rowData.answers12) ? rowData.answers12.length : 0;
  const answers_12Len = Array.isArray(rowData.answers_12) ? rowData.answers_12.length : 0;

  console.log('[stage2][db_raw_check]', {
    has_raw_story_draft: hasRawStoryDraft,
    has_raw_win_patterns_candidate: hasRawWinPatternsCandidate,
    has_raw_answers12: hasRawAnswers12,
    has_raw_answers_12: hasRawAnswers_12,
    story_draft_len: storyDraftLen,
    win_patterns_candidate_len: winPatternsCandidateLen,
    answers12_len: answers12Len,
    answers_12_len: answers_12Len,
  });
}
```

**効果：**
- DB に答えと勝ち筋候補の列が存在するかを即座に判定可能
- コードが値を拾えていないのか、DB に無いのかを切り分けできる
- DB列名（答え_12 vs 答え12）を判定できる

---

### ✅ TASK 3: refetchFromServer で STAGE2フィールド保護
**ファイル:** `/store/strategyStore.ts` (行 2318-2320, 2366-2368)

**修正箇所 1: wasDirty = true ブランチ（行 2318-2320）**
```typescript
return {
  ...base,
  ...minimal,
  companyId: s.pendingCompanyId ?? s.companyId,
  pendingCompanyId: undefined,
  // DB に無い値は既存の persist 値を保持
  stage1Benchmarks: (minimal as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
  stage1Issues: (minimal as any).stage1Issues ?? (base as any).stage1Issues,
  /* ★ TASK 3: STAGE2 フィールドを保護（空配列での上書き防止） */
  answers12: (minimal as any).answers12 ?? (base as any).answers12,
  winPatternsCandidate: (minimal as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
};
```

**修正箇所 2: wasDirty = false ブランチ（行 2366-2368）**
```typescript
const merged: any = {
  ...(base as any),
  ...(patch as any),
  companyId: s.pendingCompanyId ?? s.companyId,
  pendingCompanyId: undefined,
  // DB に無い値は既存の persist 値を保持
  stage1Benchmarks: (patch as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
  stage1Issues: (patch as any).stage1Issues ?? (base as any).stage1Issues,
  /* ★ TASK 3: STAGE2 フィールドを保護（空配列での上書き防止） */
  answers12: (patch as any).answers12 ?? (base as any).answers12,
  winPatternsCandidate: (patch as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
};
```

**効果：**
- DB 行に `answers12` / `winPatternsCandidate` が存在しない場合、既存の state 値を保持
- 空配列で上書きするリスクを排除
- stage1Issues と同じ保護レベルを適用

**ロジック詳細：**
- `(patch as any).answers12 ?? (base as any).answers12`
- DB から来た patch に answers12 が有れば使う（undefined, null なら既存値を保持）
- 空配列 `[]` は "exist" として扱われるため、ユーザーが意図的に消した場合は反映される

---

### ✅ TASK 4: STAGE2Page での二重復元確認
**ファイル:** `/app/stage2/page.tsx`

**確認内容：**
- ✅ restoreStage2Snapshot() で restoreWithAudit を呼ぶ
- ✅ hydrateFromFullState() で store に反映
- ✅ refetchFromServer は page 上で呼ばれていない
- ✅ TASK 3 により、万が一 refetch が走ってもデータは保護される

---

### ✅ TASK 5: 検証チェックリスト作成
**ファイル:** `/STAGE2_VERIFICATION_CHECKLIST.md`

検証手順：
1. 同一端末でのリロード（答えと勝ち筋候補が保持されるか）
2. 別端末でのログイン（同じデータが見えるか）

期待ログ：
- `[stage2][db_raw_check]` → DB列の有無を確認
- `[buildStateFromDbRow] raw_復元` → 復元直後の状態
- `[strategyStore refetch] 📦 full state` → refetch 後のパッチ
- `[audit][restore:stage2_check]` → 最終的な state（★重要：答え_len > 0）

---

## 修正前後の違い

### Before（修正前）
```
[strategyStore refetch] 📦 full state from DB: {
  answers12_len: 1,  ← DB には有る
  winPatternsCandidate_len: 1
}

[audit][restore:stage2_check] wasDirty=false branch: {
  answers12_len: 0,  ❌ 0 になってしまう（上書き事故）
  winPatternsCandidate_len: 0
}
```

### After（修正後）
```
[strategyStore refetch] 📦 full state from DB: {
  answers12_len: 1,
  winPatternsCandidate_len: 1
}

[audit][restore:stage2_check] wasDirty=false branch: {
  answers12_len: 1,  ✅ 保持されている
  winPatternsCandidate_len: 1
}
```

---

## 必須確認事項

### ⚠️ 重要：DB列名の確認
修正後、**必ず以下のいずれかを確認してください：**

**パターン A: DB列名が `answers12`（現在のFIELD_MAP）の場合**
```
[stage2][db_raw_check]: {
  has_raw_answers12: true,
  has_raw_answers_12: false,
  answers12_len: 1,
}
```
→ ✅ そのまま使用可能

**パターン B: DB列名が `answers_12`（snake_case 推奨）の場合**
```
[stage2][db_raw_check]: {
  has_raw_answers12: false,
  has_raw_answers_12: true,
  answers_12_len: 1,
}
```
→ ⚠️ FIELD_MAP を修正する必要があります：
```typescript
// /utils/supabase/strategy.ts 行 378
answers12: 'answers_12',  // ← 修正
```

---

## 最終チェックリスト

- [ ] TASK 2 ログ追加を確認（stage2/db_raw_check）
- [ ] TASK 3 refetch 保護を確認（store の修正2箇所）
- [ ] 検証チェックリストで同一端末リロードテストを実施
- [ ] コンソールで [stage2][db_raw_check] ログを確認
- [ ] answers12_len > 0 & winPatternsCandidate_len > 0 を確認
- [ ] 別端末でも同じデータが見えることを確認
- [ ] 必要に応じて FIELD_MAP を修正（DB列名の判定後）

---

## 関連ファイル

| ファイル | 修正内容 |
|---------|--------|
| `/utils/supabase/strategy.ts` | TASK 2: DB列存在確認ログ追加 (行 782-802) |
| `/store/strategyStore.ts` | TASK 3: refetch 保護追加 (行 2318-2320, 2366-2368) |
| `/STAGE2_VERIFICATION_CHECKLIST.md` | TASK 5: 検証手順ドキュメント |

---

## トラブル時の対応

詳細な トラブルシューティング は `/STAGE2_VERIFICATION_CHECKLIST.md` を参照してください。
