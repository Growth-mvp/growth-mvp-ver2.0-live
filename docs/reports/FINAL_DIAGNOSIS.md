# CEOChatPanel strategyId=null 最終診断

**診断日**: 2026-09-27
**状態**: restoreReady=true, isFetchingFromServer=false, strategyId=null
**追加診断ログ**: 一切出ていない

## 最終報告

### 1. restoreReady は persist されているか？

**結論**: NO - persist されていない

**根拠**:
- partialize (4896-4978行) に restoreReady は含まれていない
- migrate (4979行以降) で明示的に `restoreReady: false` がセット
- restoreReady: true は runtime にのみセット

### 2. strategyId=null は persist され得るか？

**結論**: YES - strategyId は persist される可能性

**根拠**:
- partialize で strategyId が persist 対象に含まれている（4898行）
- setCompanyScope で strategyId = undefined にリセット（2036行）
- もし setCompanyScope 直後の状態が hydrate されれば、strategyId=null が復元される

### 3. 現在の localStorage からこの不整合状態が復元され得るか？

**結論**: NO - localStorage からの復元ではない

理由：
- restoreReady は persist されていないため、localStorage に restoreReady=true は存在しない
- migrate で restoreReady: false が明示的に初期化される
- 本番で restoreReady=true が出現したのは runtime に setされたもの

### 4. 今回 refetchFromServer が起動しなかった理由

**最有力な原因**：refetchRanForCompany ガード条件（layoutClient 579行）

```typescript
if (refetchRanForCompany.current === companyId) return;
```

**シナリオ**:
1. 前回セッション（またはページ前回リロード）で refetch が実行された
2. refetchRanForCompany.current = companyId がセット
3. ページ内遷移またはマウント再実行
4. layoutClient は unmount されず hydrated も true のまま
5. refetch useEffect が実行されるが、refetchRanForCompany.current === companyId で skip される

**追加診断ログが出ない理由**:
- refetchFromServer() 自体が呼ばれていない
- したがって 4133行（REFRESH_START）に到達していない

### 5. restoreReady=true && strategyId=null が成立する正確な経路

**主原因**：古い状態の localStorage が hydrate されて、その後 refetch が skip される

```
ページ前回リロード
  ↓
localStorage hydrate
  ├─ strategyId が restore される（persist対象だから）
  └─ restoreReady は false に init（partialize に含まれないから）
  ↓
layoutClient useEffect で setCompanyScope() 実行
  ├─ strategyId = undefined にリセット
  └─ restoreReady = false (のまま)
  ↓
layoutClient useEffect で refetchFromServer() 実行...
  ↓
しかし refetchRanForCompany.current === companyId で skip される！
  ↓
refetchFromServer が実行されず restoreReady も true にならない

ところが本番ログでは restoreReady=true が出ている？
↓
可能性：
A) 別のコミット/セッションで restoreReady: true の不整合が既に存在
B) layoutClient の別の useEffect が restoreReady を上書き
C) ユーザーログと実際の状態の時系列がずれている
```

### 6. 根本原因の最終結論

**PRIMARY**: refetchRanForCompany ガード条件により、2回目以降のアクセスで refetch が skip される

**SECONDARY**: setCompanyScope による strategyId = undefined リセット後、refetch が実行されない場合、strategyId は undefined のまま

**TERTIARY**: partialize で strategyId は persist されるが、restoreReady は persist されないため、不整合状態が復元され得る

## 次に確認すべき項目

1. **ブラウザコンソール**で refetchRanForCompany がどの値になっているか
   - DevTools で `__STRATEGY_STORE_GETSTATE__()` を実行して確認

2. **localStorage** の実際の内容
   - Application → localStorage → strategy-store-v5 を確認
   - strategyId の値
   - restoreReady の有無

3. **ページリロード vs ページ内遷移**
   - ページリロード後の動作
   - ページ内遷移後の動作
   を分離して確認

4. **refetchRanForCompany のリセット条件**
   - layoutClient では一度セットされると同じ companyId では reset されない
   - マルチセッション/マルチタブでの挙動

## 最小修正案

### 案 A: refetchRanForCompany をリセット可能にする
```typescript
// layoutClient
useEffect(() => {
  // companyId が変わったら refetchRanForCompany をリセット
  refetchRanForCompany.current = null;
}, [companyId]);
```

**効果**: ページ内遷移でも新しい companyId では refetch が実行される

### 案 B: restoreReady を smarter に定義する
```typescript
// strategyStore
// restoreReady の定義を「refetch 完了」ではなく「strategyId 取得完了」に変更
// strategyId が null なら restoreReady: false にしておく
```

**効果**: 不整合状態（strategyId=null, restoreReady=true）を作らない

### 案 C: setCompanyScope でも refetchRanForCompany をリセット
```typescript
setCompanyScope: (id) => {
  refetchRanForCompany.current = null;  // ← reset
  return { ... };
}
```

**効果**: 会社切替時は常に新規 refetch が実行される

### 推奨: 案 A + 案 B の組み合わせ
- refetchRanForCompany をより自由にリセット可能にする
- restoreReady の定義を厳密にする（strategyId が null なら false）
