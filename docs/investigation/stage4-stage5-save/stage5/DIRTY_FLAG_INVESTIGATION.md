# STAGE5「未保存の変更あり」dirty フラグ原因調査

**調査日**: 2026-04-09
**現象**: saveStrategyData ok=true で saveProgressLog 成功ログが出ているのに、UI は「未保存の変更あり」のままになっている

---

## A. dirty を立てている箇所の全列挙

### 1. execution/page.tsx

#### LINE 1031: onEditProgress（progress input）
```typescript
state.setState({ dirty: true });
```

**タイミング**: progress input フィールドに数値入力後
**dirty フラグ**: true

---

### 2. strategyStore.ts

#### LINE 2241: setOKRTargetScore
```typescript
setOKRTargetScore: (okrId: string, score: number) => {
  set((s) => {
    const prev = s.okrTargetScores ?? {};
    return {
      ...s,
      okrTargetScores: { ...prev, [okrId]: score },
      dirty: true,                    // ← ここで dirty: true
      version: (s.version ?? 0) + 1,
    };
  });
},
```

**呼び出し元**: execution/page.tsx:602 （onSaveCheckin）と LINE 835 （onSaveFeedback）
**タイミング**: チェックイン / フィードバック保存時（saveStrategyData より前）
**dirty フラグ**: true

#### その他の dirty: true 設定箇所

多数あります（updateDepartments など各種フィールド更新時）。

**重要**: **すべての data 更新が dirty: true を設定する**

---

## B. dirty が false に戻る経路

### 1. saveStrategyData 成功時（LINE 3704）

```typescript
const safePatch: Partial<StrategyState> = {
  dirty: false,                    // ← ここで dirty: false
  __lastSavedHash: currentHash,
  /* 他のフィールド */
};

set(safePatch);  // LINE 3704
```

**条件**: save が実際に Supabase に送信され、ok: true で返却された場合
**dirty フラグ**: false

### 2. payload empty で skip した場合（LINE 3503）

```typescript
if (isEffectivelyEmpty(payload)) {
  if (DEBUG) console.log('[strategyStore] saveStrategyData: payload effectively empty, clear dirty');
  set({ dirty: false });  // ← ここで dirty: false
  return { ok: false, skipped: true, reason: 'payload_empty' };
}
```

**条件**: payload が空の場合
**return**: ok: false, reason: 'payload_empty'

### 3. 同じ hash で skip した場合（LINE 3558）

```typescript
if (!force && !isManual && state.__lastSavedHash && state.__lastSavedHash === currentHash) {
  if (DEBUG) console.log('[strategyStore] saveStrategyData: same hash, skip (not forced, not manual)');
  set({ dirty: false });  // ← ここで dirty: false
  return { ok: false, skipped: true, reason: 'same_hash' };
}
```

**条件**: autosave で同じ hash の場合（manual は continue）
**return**: ok: false, reason: 'same_hash'

---

## C. 「未保存の変更あり」が残る直接原因

### シナリオ分析

#### シナリオ1: saveStrategyData が skip された場合

```
T0: setOKRTargetScore(okrId, rating)
  → dirty: true に設定

T1: saveStrategyData({ reason: 'manual' })
  → さまざまな guard でブロック（例：fetch/hydrate guard）
  → return { ok: false, reason: 'fetching_or_hydrating' }

T2: execution/page.tsx:621 で await しているが、返却値を確認していない
  → setNotice('✅ 記録しました') を実行
  → UI 上は「保存成功」と表示

T3: dirty は false に設定されない（skip されたから）
  → dirty: true のまま
  → UI の「未保存」マーク残る ❌
```

#### シナリオ2: saveStrategyData が成功したが、その後 dirty が立つ

```
T0: setOKRTargetScore(okrId, rating)
  → dirty: true に設定

T1: saveStrategyData({ reason: 'manual' }) 実行
  → API call で Supabase に保存
  → ok: true で返却
  → safePatch で dirty: false に設定

T2: saveStrategyData return 後の処理
  → setLogs() 実行

T3: 同期中に別の処理（autosave など）が dirty を再度立てる
  → dirty: true に戻る ❌
```

#### シナリオ3: company_members 401 が autosave をブロック

```
T0: setOKRTargetScore で dirty: true

T1: saveStrategyData({ reason: 'manual' }) 実行
  → 成功
  → dirty: false に設定

T2: useAutoSave が起動（何か別の change で）
  → isFetching 中に company_members GET 401 発生
  → autosave が失敗するか遅延する

T3: dirty が false から true に戻されて残る
```

---

## D. dirty フラグの実装上の問題点

### 問題1: saveStrategyData の返却値を確認していない

**execution/page.tsx:621, 855**

```typescript
// ❌ 問題：返却値を確認していない
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });

// ✅ 正しくは：
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
if (!result?.ok) {
  // saveStrategyData が skip された場合の処理
  // dirty: true のまま
  // ユーザーに再試行を促す
  return;
}
```

**影響**: saveStrategyData が skip されても、execution/page.tsx は「成功した」と仮定して処理を続行

---

### 問題2: setOKRTargetScore と saveStrategyData の順序

**execution/page.tsx:602 → 621**

```typescript
// ★ 順序問題
useStrategyStore.getState().setOKRTargetScore(okrId, rating);  // dirty: true
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
```

**流れ:**
1. setOKRTargetScore → dirty: true （メモリに書き込み）
2. saveStrategyData → OK ならば dirty: false （メモリに書き込み）

**問題**: saveStrategyData が skip されたら、dirty: true のまま

---

### 問題3: 同期タイミングでの dirty 再設定

**考えられるシナリオ:**
```
T0: onSaveCheckin 実行
  → setOKRTargetScore (dirty: true)
  → saveStrategyData (dirty: false)

T1-T2: クリーンアップ処理（setProgressText(''), setLogs() など）

T3: useAutoSave が起動（dirty: false だから skip されるはず）

T4: しかし、setLogs() が別の state 更新をトリガーして、
  → 別の action が dirty: true を立てる？
```

---

## E. company_members 401 の影響

### 401 が発生する箇所

**Supabase API call**

```
GET /rest/v1/company_members?...
  → 401 Unauthorized
```

**発生タイミング**:
- authToken が期限切れ
- または権限がない
- または fetch 中に session が切れた

### 401 の影響範囲

| 対象 | 影響 |
|------|------|
| **saveProgressLog** | 成功している（progressive log は保存済み） |
| **saveStrategyData** | 不明（成功しているか skip されているか不明） |
| **useAutoSave** | 401 で失敗すると autosave が再試行される可能性 |
| **dirty フラグ** | autosave 失敗時に dirty: true のまま残る |

### 判定: 401 は主因か副因か

**現時点での推定：副因**

理由:
1. saveProgressLog は成功している
2. STAGE5-save-checkin-success ログが出ている
3. 401 は company_members の fetch の問題で、strategy_data save とは別経路の可能性

---

## F. strategy_data の実際の保存状態

### 確認方法

1. **Console ログを確認**
   ```
   [audit][saveStrategyData] success
   ```
   このログが出ているか？

2. **Supabase Dashboard で確認**
   - strategy_data テーブルの updated_at
   - チェックイン後に timestamp が更新されているか？

3. **saveStrategyData が skip されたログ**
   ```
   [saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)
   ```
   このログが出ているか？

### 推定

**strategy_data は保存されている可能性が高い**

理由:
- setOKRTargetScore で okrTargetScores を更新
- saveStrategyData で payload を build（okrTargetScores を含む）
- 成功時に dirty: false が設定される（はず）

**しかし dirty が落ちていない**可能性：
1. saveStrategyData が実際には skip されている
2. saveStrategyData 成功後に dirty: true が再度立つ

---

## G. 最小修正案（順位付け）

### 🔴 本丸 - 最優先修正

#### 修正案1: saveStrategyData の返却値を確認

**execution/page.tsx:621, 855**

```typescript
// ❌ 現在
await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
setNotice('✅ 記録しました');

// ✅ 修正案A：失敗時も notice を出す
const result = await useStrategyStore.getState().saveStrategyData({ reason: 'manual' });
if (result?.ok) {
  setNotice('✅ 記録しました');
  console.log('[STAGE5-save-checkin-result] ok=true');
} else {
  setNotice(`⚠️ strategy_data の保存に時間がかかっています: ${result?.reason}`);
  console.log('[STAGE5-save-checkin-result] ok=false', { reason: result?.reason });
  // dirty: true のままになるが、useAutoSave が later に拾う
  setSaving(false);
  return;
}
```

**メリット**:
- saveStrategyData が skip された場合の処理を正確に制御
- ユーザーに正確な情報を提供
- dirty が false に設定されるはずの状況を確認

**デメリット**:
- error handling が増える
- 必要なのは return value を確認するだけ

---

### 🟠 副因 - 401 対応

#### 修正案2: autosave の 401 retry 機能を確認

**hooks/useAutoSave.ts**

doSave() で saveStrategyData を呼ぶ際に、401 エラーをキャッチして retry する機能が必要。

ただし、401 が副因の場合、修正案1の方が優先度高い。

---

### 🟡 補助 - dirty の厳密性向上

#### 修正案3: saveStrategyData 失敗時の dirty 取り扱い

```typescript
// saveStrategyData の safePatch でダブルチェック
if (!result?.ok) {
  // save がスキップされた場合、dirty は true のまま保つ
  // useAutoSave が待つ
  console.log('[saveStrategyData] skipped, dirty remains true', {
    reason: result?.reason
  });
} else {
  // save が成功した場合、dirty を false に
  // （既に set(safePatch) で実施）
}
```

**ただしこれは既に実装されている**

---

## H. 推奨アクション

### 1. 即座に実施（本丸修正）

修正案1を実装：
- execution/page.tsx:621, 855 で saveStrategyData の返却値を確認
- ok: false の場合の処理を明示

### 2. 次に確認（検証）

Console ログを確認：
- `[audit][saveStrategyData] success` が出ているか
- `[saveStrategyData:SKIPPED]` が出ているか
- どちらが出ているかで、問題の原因が明確になる

### 3. 必要に応じて実施（401 対応）

401 が実害がある場合、autosave の retry 機能を強化

---

## I. 最終仮説

### 「未保存の変更あり」が残る理由

1. **本丸**: setOKRTargetScore → saveStrategyData の flow で
   - saveStrategyData が某かの理由で skip されている
   - または OK: false で返却されている
   - 返却値を確認していないため、dirty: true のまま

2. **副因**: company_members 401 で
   - autosave が失敗して再試行
   - dirty が再度立つ可能性

3. **結果**: dirty: true が落ちないまま
   - UI に「未保存」マーク

### 次のステップ

**console を詳細に確認することで、本当の原因がわかります：**

```
✅ を探す：
[STAGE5-save-checkin-success]  ← progress_logs 成功
[audit][saveStrategyData] success  ← strategy_data 成功？

❌ を探す：
[saveStrategyData:SKIPPED]  ← saveStrategyData が skip？
[STAGE5-save-checkin-exception]  ← exception 発生？
GET /rest/v1/company_members  401  ← 401 による影響？
```

これらのログが出ているかどうかで、本当の原因が判明します。

