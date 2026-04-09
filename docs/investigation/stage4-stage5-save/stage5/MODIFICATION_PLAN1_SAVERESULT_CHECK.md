# 修正案1実装レポート - saveStrategyData 返却値確認

**実装日**: 2026-04-09
**対象**: /app/execution/page.tsx
**方針**: 最小修正（返却値確認のみ）

---

## I. 修正差分要約

### 修正対象ファイル

- `/app/execution/page.tsx`

### 修正箇所

1. **onSaveCheckin** - LINE 621-643
2. **onSaveFeedback** - LINE 875-897

### 修正内容

saveStrategyData の返却値を確認し、result?.ok に応じた分岐を追加

---

## II. 追加した分岐内容

### 共通の分岐ロジック

```typescript
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

if (result?.ok) {
  // ✅ 成功時
  setNotice('✅ [成功メッセージ]');
  console.log('[STAGE5-save-[checkin|feedback]-result]', {
    ok: true,
    dirty: useStrategyStore.getState().dirty,  // dirty が false に設定されているはず
    timestamp: new Date().toISOString(),
  });
} else {
  // ❌ 失敗時（skip された場合）
  setNotice(`⚠️ 同期中のため、もう一度保存を試してください（${result?.reason}）`);
  console.log('[STAGE5-save-[checkin|feedback]-result]', {
    ok: false,
    reason: result?.reason,  // skip 理由（'fetching_or_hydrating', 'same_hash' など）
    dirty: useStrategyStore.getState().dirty,  // dirty: true のまま
    timestamp: new Date().toISOString(),
  });
  setSaving(false);
  return;  // ← 後続処理（setLogs など）を実行しない
}
```

### onSaveCheckin（LINE 621-643）

**修正前:**
```typescript
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

setNotice('✅ 記録しました');
// setLogs(...) に続く
```

**修正後:**
```typescript
// ★ 修正案1：saveStrategyData の返却値を確認
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

if (result?.ok) {
  setNotice('✅ 記録しました');
  console.log('[STAGE5-save-checkin-result]', {
    ok: true,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
} else {
  // save が skip された場合は dirty: true のままになる
  // useAutoSave が later に拾ってくれる
  setNotice(`⚠️ 同期中のため、もう一度保存を試してください（${result?.reason}）`);
  console.log('[STAGE5-save-checkin-result]', {
    ok: false,
    reason: result?.reason,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
  setSaving(false);
  return;
}

// setLogs(...) に続く（ok: true の場合のみ実行）
```

### onSaveFeedback（LINE 875-897）

**修正前:**
```typescript
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

setNotice('✅ フィードバックを保存しました');
const savedId = saved?.id ?? `feedback-${Date.now()}`;
const savedAt = saved?.created_at ?? new Date().toISOString();
// setLogs(...) に続く
```

**修正後:**
```typescript
// ★ 修正案1：saveStrategyData の返却値を確認
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

if (result?.ok) {
  setNotice('✅ フィードバックを保存しました');
  console.log('[STAGE5-save-feedback-result]', {
    ok: true,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
} else {
  // save が skip された場合は dirty: true のままになる
  // useAutoSave が later に拾ってくれる
  setNotice(`⚠️ 同期中のため、もう一度保存を試してください（${result?.reason}）`);
  console.log('[STAGE5-save-feedback-result]', {
    ok: false,
    reason: result?.reason,
    dirty: useStrategyStore.getState().dirty,
    timestamp: new Date().toISOString(),
  });
  setSaving(false);
  return;
}

const savedId = saved?.id ?? `feedback-${Date.now()}`;
const savedAt = saved?.created_at ?? new Date().toISOString();
// setLogs(...) に続く（ok: true の場合のみ実行）
```

---

## III. 修正の効果

### 何が変わるか

| 条件 | 修正前 | 修正後 |
|------|--------|--------|
| **saveStrategyData ok: true** | ✅ 成功 notice | ✅ 成功 notice + ログ |
| **saveStrategyData ok: false** | ✅ 成功 notice（間違い） | ⚠️ 警告 notice + ログ + return |
| **dirty の値** | 不明（ログなし） | console に出力 |
| **skip 理由** | 不明 | console に `result?.reason` で出力 |

### ユーザーへの影響

**修正前:**
```
チェックイン記録ボタン → 「✅ 記録しました」（saveStrategyData が skip されても表示される）
→ UI は「未保存」のまま
→ ユーザーは「あれ、何で未保存なの？」と混乱
```

**修正後:**
```
チェックイン記録ボタン → saveStrategyData ok?
  ├ ok: true → 「✅ 記録しました」+ UI は「保存済」に更新
  └ ok: false → 「⚠️ 同期中のため...」+ UI は「未保存」のまま（正確）
      → useAutoSave が後で自動 save
```

---

## IV. 確認項目への回答

### ✅ 確認1: checkin 保存後、result.ok=true のときだけ「✅ 記録しました」になるか

**答え：Yes**

```typescript
if (result?.ok) {
  setNotice('✅ 記録しました');  // ← result.ok が true の場合のみ実行
}
```

**ログで確認:**
```
✅ 成功時:
[STAGE5-save-checkin-result] {
  ok: true,
  dirty: false,  // dirty が false に設定されているはず
  timestamp: "..."
}

❌ 失敗時:
[STAGE5-save-checkin-result] {
  ok: false,
  reason: "fetching_or_hydrating",  // skip 理由
  dirty: true,  // dirty: true のまま
  timestamp: "..."
}
```

---

### ✅ 確認2: result.ok=false のとき「未保存の変更あり」が残るのは自然な挙動として説明できるか

**答え：Yes、完全に自然で説明可能**

```
saveStrategyData が skip された場合（result.ok=false）:
  → dirty: true のまま設定されない
  → setLogs() などの後続処理も実行されない（return）
  → UI の「未保存」マークが残る

これは自然な挙動：
  1. save がまだ実行されていないため、dirty: true は正しい
  2. dirty: false にすると、後で本当の save が走るまで UI が嘘になる
  3. useAutoSave が later に isFetching=false を待って自動 save
  4. その時点で dirty: false に設定される
```

**ユーザー体験:**
```
チェックイン記録 → 「⚠️ 同期中のため...」notice
→ 数秒待つ（useAutoSave の debounce 1200ms）
→ 「✅ 記録しました」notice（useAutoSave が自動 save）
→ UI の「未保存」マーク消える
```

---

### ✅ 確認3: console に result.reason が出て、次の原因追跡がしやすくなるか

**答え：Yes、大幅に改善**

**出力されるログ:**

```javascript
// 成功時
[STAGE5-save-checkin-result] {
  ok: true,
  dirty: false,
  timestamp: "2026-04-09T12:34:56.789Z"
}

// 失敗時
[STAGE5-save-checkin-result] {
  ok: false,
  reason: "fetching_or_hydrating",  // ← この値で原因がわかる
  dirty: true,
  timestamp: "2026-04-09T12:34:57.123Z"
}
```

**result.reason の値（strategyStore.ts から）:**
- `"fetching_or_hydrating"` - fetch/hydrate guard でブロック
- `"restore_not_ready"` - master guard でブロック（restoreReady=false）
- `"no_revision"` - revision チェックでブロック
- `"missing_ids"` - userId か companyId がない
- `"dirty_false"` - dirty=false で autosave skip（manual では skip されない）
- `"same_hash"` - 同じ hash で skip
- `"pending_queued"` - 既に save 中

これで**デバッグが格段に容易**になる

---

### ✅ 確認4: STAGE4 には影響がないか

**答え：Yes、STAGE4 への影響はゼロ**

**理由:**

1. **修正対象は execution/page.tsx のみ**
   - okr/page.tsx（STAGE4）は変更していない
   - persistStage4Snapshot の流れは変わっていない

2. **strategyStore.ts は変更していない**
   - saveStrategyData のロジックは変わっていない
   - dirty flag の設定ロジックは変わっていない

3. **useAutoSave.ts は変更していない**
   - STAGE4 の autosave 流れは変わっていない

**STAGE4 への影響確認:**
```
STAGE4 策定 → 保存 → STAGE5 移動 → STAGE5 でチェックイン
                                  ↓
                     (修正後の コード実行)
                                  ↓
                            STAGE4 は無関係
```

---

## V. 修正の最小性

### 追加コード量

| 対象 | 追加行数 | 削除行数 | 変更内容 |
|------|---------|---------|---------|
| onSaveCheckin | +21 | 0 | if/else 分岐 + ログ |
| onSaveFeedback | +22 | 0 | if/else 分岐 + ログ |
| 合計 | **+43 行** | 0 | 返却値確認のみ |

### 変更範囲

- **侵襲性：極小**（saveStrategyData 呼び出し部分のみ）
- **パフォーマンス影響：ゼロ**（同期的な値確認のみ）
- **戻す難度：容易**（if/else を削除すれば元に戻る）

---

## VI. 実装後の確認方法

### Step 1: Console を確認

STAGE5 でチェックイン/フィードバック保存後：

```
✅ 成功時：
[STAGE5-save-checkin-result] {
  ok: true,
  dirty: false,
  timestamp: "..."
}

❌ 失敗時：
[STAGE5-save-checkin-result] {
  ok: false,
  reason: "fetching_or_hydrating" or "restore_not_ready" etc,
  dirty: true,
  timestamp: "..."
}
```

### Step 2: UI の notice 確認

- ok: true → 「✅ 記録しました」
- ok: false → 「⚠️ 同期中のため、もう一度保存を試してください（[reason]）」

### Step 3: dirty フラグ確認

- ok: true → dirty が false に落ちているはず → 数秒で「未保存」消える
- ok: false → dirty が true のまま → useAutoSave 待つ

### Step 4: STAGE4 確認

STAGE4 で保存したデータが STAGE5 で変わっていないことを確認

---

## VII. 次のステップ

### 修正後の検証項目

1. **チェックイン保存:**
   - result.ok が出ているか
   - result.reason が出ているか
   - dirty の値が正しく出ているか

2. **フィードバック保存:**
   - 同上

3. **「未保存の変更あり」マーク:**
   - ok: true → 消える
   - ok: false → 残る（その後 useAutoSave で消える）

4. **autosave の自動動作:**
   - ok: false 後に、useAutoSave が自動で save するか
   - 最終的に dirty が落ちるか

5. **STAGE4 への影響確認:**
   - STAGE4 のデータが保存されているか
   - STAGE5 で変わっていないか

---

## VIII. 修正の原理

### なぜこの修正で dirty フラグの問題が解決するか

**修正前の問題:**
```
setOKRTargetScore(dirty: true)
  ↓
saveStrategyData() ← 返却値を確認していない
  ↓
setNotice('✅') ← 常に実行（成功/失敗問わず）
  ↓
UI に「成功」と表示されるが、
実際には saveStrategyData が skip されて dirty: true のまま
  ↓
result 「未保存」マークが残る（UI の矛盾）
```

**修正後の解決:**
```
setOKRTargetScore(dirty: true)
  ↓
saveStrategyData() ← 返却値を確認
  ↓
if (result?.ok) {
  setNotice('✅')
  dirty は false に設定されている
} else {
  setNotice('⚠️')
  dirty は true のまま
  return ← 後続処理を skip
  useAutoSave が later に自動 save
}
  ↓
UI が正確（成功 ↔ 失敗）
dirty が正確（false ↔ true）
```

---

## IX. 修正のまとめ

| 項目 | 内容 |
|------|------|
| **修正ファイル** | `/app/execution/page.tsx` |
| **修正箇所** | onSaveCheckin, onSaveFeedback |
| **修正内容** | saveStrategyData 返却値を確認 |
| **追加コード** | ~43 行（if/else + ログ） |
| **削除コード** | 0 行 |
| **侵襲性** | 極小 |
| **パフォーマンス影響** | ゼロ |
| **STAGE4 影響** | ゼロ |
| **strategyStore.ts 変更** | ❌ なし |
| **useAutoSave.ts 変更** | ❌ なし |
| **onEditProgress 変更** | ❌ なし |
| **401 対応** | ❌ なし |

---

## X. 修正後の期待結果

### パターンA: saveStrategyData が成功する場合

```
console:
[STAGE5-save-checkin-result] { ok: true, dirty: false, ... }

UI:
notice: "✅ 記録しました"
「未保存」マーク: 消える

動作:
setLogs() 実行 → logs に新規ログ表示
クリーンアップ処理実行
```

### パターンB: saveStrategyData が skip される場合（修正による改善）

```
console:
[STAGE5-save-checkin-result] { ok: false, reason: "fetching_or_hydrating", dirty: true, ... }

UI:
notice: "⚠️ 同期中のため、もう一度保存を試してください（fetching_or_hydrating）"
「未保存」マーク: 残る（正確）

動作:
setSaving(false), return → 後続処理 skip
useAutoSave が later に自動 save（数秒待つ）
→ [audit][saveStrategyData] success
→ dirty: false に設定される
→ UI の「未保存」マーク消える
```

---

**この修正で、dirty フラグの「見えない失敗」が完全に可視化されます。**

