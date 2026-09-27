# CEOChatPanel strategyId=null 原因診断レポート

**作成日**: 2026-09-27
**対象**: restoreReady=true, isFetchingFromServer=false なのに strategyId=null という矛盾状態

## 最終報告（prompt.txt 最終報告セクションの回答）

### 1. restoreReady=true をセットしている全箇所
- **strategyStore.ts 4427行**: wasDirty=true パス完了時
- **strategyStore.ts 4507行**: wasDirty=false パス完了時
- **計2箇所**（両方とも refetchFromServer() の success パス内）

### 2. 今回 refetchFromServer は実際に呼ばれていたか？

**結論**: YES - **refetchFromServer() は実行完了している**

**根拠**:
- restoreReady=true がセットされた → success パスに到達
- __isFetchingFromServer=false がセットされた → finally ブロック実行
- isRestoring=false がセットされた → DB restore 処理完了
- 全ての flag が完了状態 → refetchFromServer() は正常に完了

### 3. strategyId取得queryは実行されていたか？

**結論**: YES - **getFullStrategyDataByCompany() は実行されている**

**根拠**:
- refetchFromServer() が success パス に到達した → try ブロック内の全コードが実行された
- DB query エラーは発生していない（error チェック 4190行で restoreReady=false がセットされるが、本番は true）
- したがって query は成功して dbRow を取得

### 4. query結果は取得成功・0件・エラーのどれか？

**結論**: **取得成功**（ただし strategyId がNULLだった可能性が高い）

**根拠**:
- getFullStrategyDataByCompany() でエラーが発生していない
- baseRes.error チェック（1537-1538行）を通過
- baseRes.data が存在して dbRow が作成された
- **しかし、safeRow?.id （DB の id フィールド） が undefined だった可能性**

### 5. strategyId は一度でもstore にセットされたか？

**結論**: YES - **1384行で (normalized as any).strategyId = strategyId がセットされた**

**ただし**: strategyId = undefined だった

**実装箇所** (buildStateFromDbRow):
```typescript
const strategyId = typeof safeRow?.id === 'string' ? safeRow.id : undefined;
(normalized as any).strategyId = strategyId;
```

つまり：
- strategyId 変数は **undefined**
- normalized に undefined がセットされた
- merged に undefined がマージされた
- Zustand state の strategyId が undefined（=null に見える）

### 6. なぜ restoreReady=true && strategyId=null が成立したのか？

**根本原因**:
```
refetchFromServer() の実行フロー:
  ↓
1. getFullStrategyDataByCompany(companyId) 実行
  ↓
2. DB query 成功 → baseRes.data 取得
  ↓
3. buildStateFromDbRow(baseRes.data)
   ├─ safeRow = baseRes.data ??{}
   ├─ const strategyId = typeof safeRow?.id === 'string' ? safeRow.id : undefined
   │  ↓ safeRow.id が undefined/null だった場合
   └─ strategyId = undefined
  ↓
4. strategyId = undefined を (normalized as any).strategyId に設定
  ↓
5. 次のステップで...merged = {...patch, ...} で strategyId: undefined を include
  ↓
6. set({ loaded: true, restoreReady: true, ... })
   ↓ strategyId: undefined が Zustand に保存される
  ↓
CEOChatPanel が読み込み
  ↓ strategyId == null → strategyOK: false
```

**キーポイント**:
- Supabase query は **成功** した
- DB row は **存在した**
- しかし **row.id フィールドが NULL/undefined** だった
- 結果として strategyId が undefined のまま restoreReady: true になった

### 7. 根本原因

**PRIMARY CAUSE**: Supabase strategy_data テーブルの **id フィールドが NULL**

**検証手順**:
```sql
SELECT id, company_id, strategyId, revision FROM strategy_data 
WHERE company_id = '13ebfcc1-a6dc-4cda-98a9-8a218b136059'
ORDER BY updated_at DESC LIMIT 1;
```

Supabase dashboard で確認：
- `id` カラムが NULL になっていないか
- `strategyId` という別カラムがあるのに、Zustand は `id` から読んでいないか

**SECONDARY CAUSE**: カラムマッピングの混乱
- strategy_data テーブルに `id` カラム存在
- strategy_data テーブルに `strategyId` カラムも存在する可能性
- buildStateFromDbRow は `id` を読んでいる （1380行）
- しかし FIELD_MAP には strategyId マッピングがない

### 8. 最小修正案

**案 A: 診断優先**（推奨 - コード変更前）
```
1. Supabase dashboard で該当 strategy_data row を確認
2. id / strategyId / revision が実際に何の値か確認
3. ログから「query は成功してbaseRes.data が存在した」という根拠を確認
```

**案 B: query エラーハンドリング改善**
buildStateFromDbRow で strategyId が undefined の場合、警告ログを出す：
```typescript
if (!strategyId) {
  console.warn('[buildStateFromDbRow] ❌ strategyId is undefined!', {
    safeRow_id: safeRow?.id,
    safeRow_strategyId: safeRow?.strategyId,
    allKeys: Object.keys(safeRow || {})
  });
}
```

**案 C: strategy_data スキーマ検証**
- `id` フィールドが primary key か確認
- `strategyId` という別フィールドがあるなら、FIELD_MAP に追加

## 次のステップ

1. **ユーザーが Supabase dashboard を確認**
   - 対象 company_id の strategy_data row を確認
   - id / strategyId / revision の実値を確認

2. **ログ詳細確認**
   - '[StrategyData] 📊 query result (baseRes)' ログで data_id を確認
   - getFullStrategyDataByCompany の return 値を確認

3. **コード確認**
   - FIELD_MAP に strategyId マッピングがあるか
   - DB schema が変わったか

## 診断ログ活用

診断ログ追加済み箇所：
- `[CEOChatPanel] PRE_ENSURE_STATE` - ensureStrategyId 直前の状態
- `[strategyStore] SET_COMPANY_SCOPE` - 会社スコープ切替時
- `[refetchFromServer] REFRESH_START` - refetch 開始
- `[refetchFromServer] REFRESH_STRATEGY_ID` - strategyId 取得完了
- `[refetchFromServer] REFRESH_DONE` - refetch 完了

これらログを見ることで、実行フローが確定できます。
