# strategyId=null Recovery 最小修正案（再設計）

## 設計コンセプト

**2 段階の refetch 機構**：
1. **通常 refetch** (`refetchRanForCompany`) - companyId 変更時に 1 回
2. **Recovery refetch** (`recoveryRefetchTriedForCompany`) - strategyId 欠損時に 1 回限定

無限ループを防ぎ、既存ユーザーの欠損状態をリカバリーしながら、新規ユーザーには影響を与えない。

---

## 修正箇所

**ファイル**: `app/layoutClient.tsx`
**行**: 107-108, 579-600（新規追加）

### 変数追加

```typescript
// Line 107-108 付近（refetchRanForCompany の後に追加）
const refetchRanForCompany = useRef<string | null>(null);
const recoveryRefetchTriedForCompany = useRef<string | null>(null);  // ← 追加
```

## 新しいフロー

### State 1: 初期状態

```
refetchRanForCompany = null
recoveryRefetchTriedForCompany = null
strategyId = undefined（migrate デフォルト）
```

### State 2: 初回アクセス（通常 refetch）

```
条件チェック：
  - bootstrapped === true
  - companyId がある
  - hydrated === true
  - refetchRanForCompany.current !== companyId  ← これが false

→ refetch 実行
→ refetchRanForCompany.current = companyId

結果：
  A) strategyId が取得できた
     → Zustand に strategyId セット
     → 次回以降 skip（strategyId が存在）

  B) strategyId が null のまま（バグまたは新規ユーザー）
     → strategyId は undefined
     → recoveryRefetchTriedForCompany = null（リカバリー未実施）
```

### State 3: 同一 companyId での 2 回目アクセス（通常 skip or recovery）

```typescript
// 通常 refetch ガード
if (refetchRanForCompany.current === companyId) {
  // ただし strategyId が null なら recovery 検討
  if (!strategyId && recoveryRefetchTriedForCompany.current !== companyId) {
    // Recovery refetch を許可
  } else {
    return;  // skip
  }
}
```

### State 4: Recovery Refetch

```
条件：
  - refetchRanForCompany.current === companyId（通常 refetch 済み）
  - strategyId === null（欠損状態）
  - recoveryRefetchTriedForCompany.current !== companyId（recovery 未実施）

→ recoveryRefetchTriedForCompany.current = companyId
→ refetchFromServer() 実行（2 回目の refetch）

結果：
  A) strategyId が取得できた
     → Zustand に strategyId セット ✓

  B) strategyId がまだ null
     → recovery 実施済みフラグが立つ
     → もう refetch しない
     → CEOChatPanel は欠損状態として処理
```

### State 5: Recovery 失敗後

```
strategyId = null
recoveryRefetchTriedForCompany.current = companyId

次のアクセス時：
  if (refetchRanForCompany.current === companyId) {
    if (!strategyId && recoveryRefetchTriedForCompany.current === companyId) {
      // recovery 済み + strategyId なし → refetch しない
      return;
    }
  }

→ 以降のアクセスでも refetch しない
→ CEOChatPanel は欠損状態として判定
→ 明示的なエラーハンドリングへ
```

---

## 修正コード案

### 修正 1: Skip 条件（579-590 行）

```typescript
// ★ 通常 refetch ガード
if (refetchRanForCompany.current === companyId) {
  // strategyId が null で recovery 未実施なら、1 回限定で recovery refetch を許可
  const strategyId = useStrategyStore.getState().strategyId;
  const shouldTryRecovery = !strategyId && recoveryRefetchTriedForCompany.current !== companyId;
  
  if (!shouldTryRecovery) {
    return;  // 通常 skip または recovery 済み
  }
  
  // recovery 実施フラグをセット（この後の refetch が recovery）
  recoveryRefetchTriedForCompany.current = companyId;
}

// refetch 実行前に通常フラグをセット
refetchRanForCompany.current = companyId;
```

### 修正 2: companyId 変更時の reset

```typescript
// layoutClient の別 useEffect で companyId 変更時にリセット
useEffect(() => {
  // companyId が変わったら recovery フラグもリセット
  recoveryRefetchTriedForCompany.current = null;
}, [companyId]);
```

---

## ケース別分析

### ケース A: 通常の新規ユーザー

```
初回アクセス（同じ companyId）
├─ refetchRanForCompany = null
├─ strategyId = undefined
├─ 条件 true → refetch 実行
├─ DB に strategy_data なし
├─ 初期行作成（provision/ensureStrategyId）
├─ strategyId 取得（新規 UUID）
└─ Zustand セット

2回目アクセス（同じ companyId）
├─ refetchRanForCompany = companyId（セット済み）
├─ strategyId = <有効 UUID>
├─ skip 条件 true（strategyId が存在）
└─ refetch skip ✓
```

**特徴**: recovery refetch は発動しない（strategyId が 1 回で取得できるから）

### ケース B: 既存ユーザー（strategyId 欠損バグ）

```
初回アクセス（同じ companyId）
├─ refetchRanForCompany = null
├─ strategyId = null（バグ状態）
├─ 条件 true → refetch 実行
├─ refetchRanForCompany = companyId
├─ DB から既存 strategy_data 取得
├─ buildStateFromDbRow で strategyId = ??? ← 問題が起きた経路
└─ strategyId = null のまま（バグが繰り返される）

2回目アクセス（同じ companyId）
├─ refetchRanForCompany = companyId（セット済み）
├─ strategyId = null（欠損）
├─ recoveryRefetchTriedForCompany = null（recovery 未実施）
├─ shouldTryRecovery = true
├─ recoveryRefetchTriedForCompany = companyId
├─ refetch 実行（2 回目の refetch）
├─ DB から既存 strategy_data 取得
├─ buildStateFromDbRow で strategyId 取得試行
└─ 結果で分岐
    A) strategyId が復帰 → ✓
    B) strategyId がまだ null → recovery 済みフラグが立つ
```

**特徴**: recovery refetch が 1 回発動 → 次回以降は refetch しない

### ケース C: Strategy 本当に存在しないユーザー（新規で strategy_data 行がない）

```
初回 refetch
├─ DB から strategy_data 取得
├─ データなし（0 件）
├─ ensureStrategyId で新規行作成
├─ strategyId 取得
└─ OK

※ refetch 内で新規作成されるため、case B（欠損）にならない
```

**特徴**: recovery refetch は不要（refetch 内で解決）

### ケース D: Strategy 本当に存在しないが新規行作成に失敗

```
初回 refetch
├─ DB から strategy_data 取得
├─ データなし
├─ ensureStrategyId で新規行作成
├─ 失敗（権限エラーなど）
├─ strategyId = null のまま
└─ NG

2回目 refetch（recovery）
├─ 条件同じ
├─ 再度新規行作成試行
├─ 同じエラーで失敗
└─ strategyId = null のまま

3回目アクセス
├─ recoveryRefetchTriedForCompany = companyId（recovery 済み）
├─ refetch しない
└─ CEOChatPanel で欠損エラーを表示
```

**特徴**: recovery 後も取得できなければ、明示的なエラー処理へ

---

## 無限ループ防止の仕組み

### refetchRanForCompany ガードによる防止

- **1 回目**: null ≠ companyId → refetch 実行 → refetchRanForCompany = companyId
- **2 回目以降**: companyId === companyId → skip 条件入る

→ **通常の refetch は 1 回限定**

### recoveryRefetchTriedForCompany ガードによる防止

- **recovery 実行前**: null ≠ companyId → recovery permit
- **recovery 実行**: recoveryRefetchTriedForCompany = companyId
- **以降**: companyId === companyId → recovery skip

→ **recovery refetch も 1 回限定**

### 合計：同一 companyId で最大 2 回

1. 通常 refetch（初回）
2. recovery refetch（strategyId null の場合）

それ以上は refetch しない。

---

## restoreReady の定義の厳密化

### 現在の問題

```
restoreReady = true（refetch 完了フラグ）
strategyId = null（欠損フラグ）
```

この両立を許可している。

### 修正後の定義

**restoreReady の意味を 2 つに分ける**：

1. **hydration 完了フラグ**（サーバー確認完了）
   - migrate で false 初期化
   - refetchFromServer 完了時に true
   - **strategyId の有無とは無関係**

2. **strategy 取得成功フラグ**（strategyId がある）
   - CEOChatPanel で参照
   - `strategyId !== null && restoreReady`

### 提案：新しいフラグを追加

```typescript
// strategyStore の新フラグ
serverCheckComplete: boolean  // ← hydration/refetch の完了フラグ
strategyIdExists: boolean     // ← strategyId が存在するか（boolean）
```

または、既存フラグの使い方を明確にする：

```
restoreReady = true
  → DB サーバーとの同期が完了した（新規ユーザーも含む）
  → strategyId の有無は別問題

strategyId !== null
  → 実際に strategy が存在する
```

CEOChatPanel では：
```typescript
const ready = restoreReady && strategyId;  // 両方必須
```

---

## 実装チェックリスト

- [ ] layoutClient で `recoveryRefetchTriedForCompany` useRef 追加
- [ ] skip 条件の修正（strategyId null で recovery 1 回許可）
- [ ] companyId 変更時の recovery リセット useEffect
- [ ] refetchFromServer の restoreReady 定義の明確化
- [ ] CEOChatPanel の strategyOK 条件の厳密化
- [ ] 新規ユーザーでの 2 回の refetch 動作テスト
- [ ] 既存ユーザーの recovery refetch 動作テスト
- [ ] 無限ループ防止の確認（同一 companyId で最大 2 回）

---

## 再発防止のポイント

1. **recovery refetch は 1 回限定** → 無限ループなし
2. **companyId 変更でリセット** → 別の会社ではまた recovery 可能
3. **recovery 後も strategy なし** → 明示的なエラーハンドリング
4. **新規ユーザーへの影響なし** → refetch 内で strategy が作成されるから recovery 不要
