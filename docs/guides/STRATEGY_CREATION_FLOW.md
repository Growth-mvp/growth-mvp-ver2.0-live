# 新規 Strategy 作成フロー調査

**状態**: 不確定。以下を確認が必要。

## 現在の理解

### refetchFromServer の動作

1. getFullStrategyDataByCompany で DB から strategy を取得
2. strategy がない場合（!dbRow）：
   ```typescript
   const base = get();
   await saveStrategyDataApi(base as any);  // 初期状態を保存
   const retry = await getFullStrategyDataByCompany(companyId);
   ```

### saveStrategyData の動作

- 既存行がある場合：strategyId を保持
- 新規行の場合：strategyId を生成しない（2090-2091行）
  ```typescript
  if (existingState.strategyId) {
    mergedState.strategyId = existingState.strategyId;
  }
  ```

## 不確定な点

### 1. refetchFromServer は read-only か？

**結論**: NO（read-only ではない）

**根拠**:
- dbRow がない場合に saveStrategyDataApi を呼び出して初期行を作成
- つまり、refetchFromServer は「取得＆必要に応じて作成」の動作

### 2. 新規 strategyId を誰が作るか？

**候補**:
- A) DB の trigger（strategy_data INSERT 時に id を自動生成）
- B) provision API（/api/companies/provision で strategyId を割り当て）
- C) saveStrategyData 内で生成（現在は見当たらない）

**調査が必要**:
- DB trigger の有無
- provision API の動作
- refetchFromServer の 2 番目の getFullStrategyDataByCompany で strategyId が取得されるのか

### 3. 新規ユーザーの実際のフロー

**シナリオ A**（refetch で完結）:
```
ユーザーアクセス
  ↓
refetchFromServer 実行
  ├─ getFullStrategyDataByCompany: 0 件
  ├─ saveStrategyDataApi: 初期行を作成
  ├─ getFullStrategyDataByCompany: 再取得
  └─ strategyId が返ってくる？ ← 不確定
  ↓
strategyId が存在 → 完了
```

**シナリオ B**（refetch + provision で完結）:
```
ユーザーアクセス
  ↓
refetchFromServer 実行
  ├─ getFullStrategyDataByCompany: 0 件
  ├─ saveStrategyDataApi: 初期行を作成
  ├─ getFullStrategyDataByCompany: 再取得
  └─ strategyId が null のまま ← ?
  ↓
strategyId が null
  ↓
CEOChatPanel が ensureStrategyId / provision を呼び出す
  ↓
provision で strategyId を割り当て
  ↓
完了
```

## Recovery Refetch への影響

**シナリオ A が正しい場合**（refetch で strategyId が生成される）:
```
新規ユーザー
├─ 通常 refetch → strategyId 取得
├─ recovery refetch 不要
└─ 完了

既存ユーザー（strategyId 欠損）
├─ 通常 refetch → strategyId=null（バグが繰り返される）
├─ recovery refetch → strategyId=null のまま（同じ問題）
└─ provision へ進む必要あり
```

**シナリオ B が正しい場合**（provision で strategyId を生成）:
```
新規ユーザー
├─ 通常 refetch → strategyId=null
├─ recovery refetch → strategyId=null
├─ provision で strategyId 割り当て
└─ 完了

既存ユーザー（strategyId 欠損）
├─ 通常 refetch → strategyId=null
├─ recovery refetch → strategyId=null
├─ provision で strategyId 復帰
└─ 完了
```

## 確認が必要な項目

### コード確認項目

1. **DB trigger**
   - strategy_data テーブルに INSERT trigger があるか
   - id カラムに DEFAULT GENERATE_ALWAYS や uuid_generate_v4() があるか

2. **saveStrategyData の完全フロー**
   - 新規行を INSERT する際に strategyId がどう処理されるか
   - DB 側で strategyId が自動生成されるのか

3. **getFullStrategyDataByCompany の戻り値**
   - buildStateFromDbRow で strategyId が確実に復元されるのか
   - DB に strategyId が存在しない場合の処理

4. **provision API**
   - どのタイミングで strategyId を割り当てるのか
   - 既存 strategy がある場合と新規の場合の処理の違い

5. **ensureStrategyId**
   - どの条件で provision を呼び出すのか
   - provision の結果をどう使うのか

## Recovery Refetch の最終フロー決定

### 現時点での推定フロー

以下を前提に設計：

```
① 通常 refetch
   ├─ strategy が取得できた → 完了
   └─ strategy がない or strategyId が null → ②へ

② recovery refetch（1 回限定）
   ├─ strategy が取得できた → 完了
   └─ strategy がない or strategyId が null → ③へ

③ provision へ進む
   ├─ 新規ユーザー：strategy を作成 + strategyId 割り当て
   └─ 既存ユーザー：strategyId を復帰
   ↓
完了
```

### 既存ユーザーの欠損時

```
recovery refetch で strategyId が復帰しない場合
  ↓
provision へ進む（allowCreate=false で既存 strategyId を取得）
  ↓
strategyId が復帰 ✓
  ↓
CEOChatPanel が復旧を確認
```

### 新規ユーザー

```
通常 refetch で strategy が作成される
  ↓
strategyId が存在するか確認
  ├─ YES → recovery refetch 不要
  └─ NO → recovery refetch で取得 or provision へ

recovery 後も strategyId がない
  ↓
provision で作成
```

## 実装前の必須確認

以下をコード上で確認してから実装を開始：

1. [ ] saveStrategyData で新規行 INSERT 時に strategyId が DB で自動生成されるか
2. [ ] refetchFromServer の 2 番目の getFullStrategyDataByCompany で strategyId が取得されるか
3. [ ] 新規ユーザーが確実に strategyId を取得できるまでのフロー
4. [ ] 既存ユーザーでの strategyId 欠損状態がどの段階で起きるのか
5. [ ] provision API が strategyId 復帰に使用できるか（allowCreate=false 時の動作）
