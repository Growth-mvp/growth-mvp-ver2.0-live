# strategyId=null 最小修正案（詳細設計）

**目的**: strategyId 欠損時だけ refetch を再実行する、同時に無限ループを防止

## 修正箇所

**ファイル**: `app/layoutClient.tsx`
**行番号**: 579-581（refetchRanForCompany ガード条件）

## 現在のコード

```typescript
// Line 579
if (refetchRanForCompany.current === companyId) return;

// Line 581
refetchRanForCompany.current = companyId;
```

## 修正案

### 修正内容

**Step 1**: Skip 条件に strategyId チェックを追加（579行）

```typescript
// 修正前
if (refetchRanForCompany.current === companyId) return;

// 修正後
const strategyId = useStrategyStore.getState().strategyId;
if (refetchRanForCompany.current === companyId && strategyId) {
  return;  // 同一companyId で strategyId が存在 → skip
}
// strategyId が null/undefined なら、同じcompanyIdでも refetch 実行
```

**Step 2**: refetchRanForCompany のセット処理を改定（581行）

```typescript
// 修正前
refetchRanForCompany.current = companyId;

// 修正後
// 既にセット済み（初回アクセス時）か、strategyId がない場合のみ実行
if (!refetchRanForCompany.current || !strategyId) {
  refetchRanForCompany.current = companyId;
}
```

**または、より安全な方法**:

```typescript
// strategyId がない場合は、refetchRanForCompany をリセット
// これにより再度 refetch が実行される
if (!strategyId && refetchRanForCompany.current === companyId) {
  refetchRanForCompany.current = null;
}

refetchRanForCompany.current = companyId;
```

## 無限 refetch 防止の仕組み

### 新規ユーザー（strategy 未作成）の場合

```
1回目アクセス
  ├─ strategyId = null
  ├─ refetchRanForCompany.current = null
  ├─ skip 条件 false → refetch 実行
  ├─ refetchRanForCompany.current = companyId セット
  ├─ refetchFromServer() 実行
  │  ├─ DB に strategy_data がない
  │  ├─ 初期行作成（saveStrategyDataApi）
  │  └─ strategyId 取得（新規 UUID）
  │
  └─ Zustand に strategyId セット

2回目アクセス（同一セッション内）
  ├─ strategyId = <valid_uuid>
  ├─ refetchRanForCompany.current = companyId
  ├─ skip 条件 true（strategyId が存在）→ refetch skip ✓
```

### 既存ユーザー（strategyId 欠損バグの場合）

```
状態：refetchRanForCompany.current = companyId（前回セット）
      strategyId = null（バグ状態）

1回目アクセス
  ├─ strategyId = null
  ├─ refetchRanForCompany.current = companyId
  ├─ skip 条件 false（strategyId=null）→ refetch 実行
  ├─ refetchRanForCompany.current = companyId（再セット）
  ├─ refetchFromServer() 実行
  │  ├─ DB から既存 strategy_data 取得
  │  └─ strategyId 復元
  │
  └─ Zustand に strategyId セット ✓

2回目アクセス
  ├─ strategyId = <valid_uuid>
  ├─ refetchRanForCompany.current = companyId
  ├─ skip 条件 true → refetch skip ✓
```

### 無限ループ防止の鍵

1. **refetchRanForCompany.current = companyId が常にセット**される
   → 2回目以降は同一 companyId では skip 条件が true になる

2. **strategyId が restore される**ことが前提
   → refetchFromServer で DB から strategyId を取得できれば、2回目以降は skip される

3. **strategyId が restore されない場合**
   → 問題は refetch ロジック（buildStateFromDbRow など）にある
   → layoutClient ガード条件の修正では解決できない問題

## 修正後の restoreReady 厳密化

### 現在の問題

restoreReady=true, strategyId=null という不整合状態が存在

### 修正方針

**refetchFromServer() 内で、strategyId がない場合は restoreReady を false に保つ**

```typescript
// refetchFromServer の最後（set 前）
if (!patch.strategyId) {
  console.warn('[refetchFromServer] strategyId is null/undefined, keeping restoreReady=false');
  restoreReady = false;  // 明示的に false に
} else {
  restoreReady = true;   // strategyId が存在してこそ restore 完了
}
```

## 修正による影響

### 既存ユーザー（strategyId 復帰ケース）

**修正前**:
- 初回 refetch 実行 → strategyId 復帰
- 2回目以降 refetch skip

**修正後**:
- 初回 refetch 実行 → strategyId 復帰
- 2回目以降 refetch skip
- **差異なし** ✓

### 新規ユーザー（strategy 未作成）

**修正前**:
- 初回 refetch 実行 → strategy_data 新規作成 → strategyId 取得
- 2回目以降 refetch skip

**修正後**:
- 初回 refetch 実行 → strategy_data 新規作成 → strategyId 取得
- 2回目以降 refetch skip
- **差異なし** ✓

### 不整合状態復帰時

**修正前**:
- strategyId=null で refetch skip → 不整合が永続
- CEOChatPanel が「復元完了」と誤認

**修正後**:
- strategyId=null なら skip 条件を無視
- refetch 再実行 → strategyId 復帰
- restoreReady も正確に設定
- **修正効果あり** ✓

## 実装チェックリスト

- [ ] layoutClient 579行の skip 条件に strategyId チェック追加
- [ ] refetchRanForCompany セット処理の安全化
- [ ] refetchFromServer で strategyId=null 時の restoreReady 処理
- [ ] 新規ユーザーでの無限 refetch テスト
- [ ] 既存ユーザーでの復帰テスト
- [ ] CEOChatPanel での strategyOK チェック
