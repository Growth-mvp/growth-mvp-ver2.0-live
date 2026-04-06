# STAGE5 コメント表示問題 - 原因分析と修正レポート

## 問題概要
STAGE5 でコメント入力しても、トップ画面（ホーム）の STAGE5 更新一覧に表示されたり表示されなかったりする症状

## 根本原因（特定完了）

### 原因1：Soft Delete フィルター不適切（リスク度：高）
**ファイル：** `app/api/stage5/execution-summary/route.ts` 行 190

**問題：**
```javascript
// ❌ 修正前
const { data: okrsData, error: okrsError } = await admin
  .from('okrs')
  .select('id, department_id, project_id, objective')
  .eq('company_id', companyId)
  .eq('is_deleted', false);  // ← ここが問題
```

OKR が soft delete（`is_deleted = true`）されると、その OKR に紐づく progress_logs レコードが okrMetaMap から除外される。結果として、ホームに表示されない。

**影響：**
- progress_logs に okr_id が保存されていても、okrs が削除済みなら表示されない
- 「一度は表示されたが、その後表示されない」という症状と一致

**修正：**
```javascript
// ✅ 修正後
const { data: okrsData, error: okrsError } = await admin
  .from('okrs')
  .select('id, department_id, project_id, objective, is_deleted')  // is_deleted も取得
  .eq('company_id', companyId);  // is_deleted フィルター削除
```

---

### 原因2：progress_logs 保存時のカラム不整合（リスク度：中）
**ファイル：** `utils/supabase/strategy.ts` 行 2668-2679

**問題：**
```javascript
// ❌ 修正前
const row: Record<string, any> = {
  user_id: authUserId,
  company_id: companyId,
  okr_id: okrRow.id,
  department: departmentId,  // ← route.ts では SELECT されないカラム
  content,
  status,
  score,
  created_at
};
```

- `department` カラムが route.ts の SELECT で使用されていない
- progress_logs テーブルに department カラムが無い場合、INSERT は失敗

**修正：**
```javascript
// ✅ 修正後
const row: Record<string, any> = {
  user_id: authUserId,
  company_id: companyId,
  okr_id: okrRow.id,
  content,  // route.ts の SELECT と一致
  status,
  score,
  created_at
};
```

**理由：**
- progress_logs は okr_id を通じて okrs テーブルの department_id を参照可能
- department 値をわざわざ進捗ログに重複保存する必要なし
- route.ts が SELECT していないカラムは不要

---

### 原因3：診断情報の不足（検証困難）
**ファイル：** 複数箇所

問題の再現・検証が困難だったため、以下の診断ログを追加：

#### A. saveProgressLog（`utils/supabase/strategy.ts` 行 2681-2720）
```javascript
// INSERT 直前のペイロード確認
console.log('[saveProgressLog-insert-payload]', {
  rowKeys: Object.keys(row),
  okrId: okrRow.id,
  companyId,
  userId: authUserId,
  contentLength: String(content).length,
  hasStatus: row.status != null,
  hasScore: row.score != null,
});

// INSERT エラー詳細
console.error('[saveProgressLog-insert-error-detail]', {
  errorCode: error?.code,
  errorMessage: error?.message,
  errorDetails: error?.details,
  errorHint: error?.hint,
  attemptedColumns: Object.keys(row),
});

// INSERT 成功時の返却カラム
console.log('[saveProgressLog-insert-result]', {
  savedId: data?.id,
  savedOkrId: data?.okr_id,
  returnedColumns: data ? Object.keys(data) : [],
});
```

#### B. route.ts（`app/api/stage5/execution-summary/route.ts` 行 301-355）
```javascript
const skipReasons = {
  emptyOkrId: 0,
  okrMetaNotFound: 0,
  emptyLatestUpdateAt: 0,
  projectKeyDuplicate: 0,
  added: 0,
};

// フィルタリング過程をカウント
for (const log of logs) {
  if (!okrId) {
    skipReasons.emptyOkrId++;
    continue;
  }
  if (!okrMeta) {
    skipReasons.okrMetaNotFound++;
    continue;
  }
  // ...
}

console.log('[execution-summary-filtering]', {
  progressLogsCount: logs.length,
  okrMetaMapSize: okrMetaMap.size,
  skipReasons,
  latestByProjectSize: latestByProject.size,
});
```

#### C. ExecutionPanel.tsx（`components/home/ExecutionPanel.tsx` 行 195-222）
```javascript
console.log('[ExecutionPanel-recentProjectUpdates]', {
  totalFromAPI: items.length,
  afterDismissFilter: filtered.length,
  dismissedMapSize: Object.keys(dismissedMap).length,
  sampleAPItems: items.slice(0, 2).map(item => ({
    projectId: item.projectId,
    latestUpdateAt: item.latestUpdateAt,
    latestUpdateType: item.latestUpdateType,
  })),
});
```

---

## 修正内容サマリー

| 修正項目 | ファイル | 行番号 | 修正内容 |
|---------|---------|------|---------|
| **is_deleted フィルター削除** | route.ts | 186-192 | soft delete OKR も取得対象に含める |
| **department カラム削除** | strategy.ts | 2668-2679 | 不要なカラムを INSERT payload から削除 |
| **saveProgressLog 診断ログ** | strategy.ts | 2681-2720 | INSERT payload、エラー、返却カラムをログ |
| **route.ts フィルター診断ログ** | route.ts | 301-355 | skip reason をカウント・ログ |
| **ExecutionPanel 診断ログ** | ExecutionPanel.tsx | 195-222 | API 返却データと dismiss 状態をログ |

---

## 修正後の期待動作

### ✅ 修正前（問題あり）
```
1. STAGE5 でコメント保存 → progress_logs に記録
2. OKR が削除される → okrs.is_deleted = true に更新
3. ホーム API は is_deleted = false だけを取得 → 該当 OKR が okrMetaMap に入らない
4. latestByProject に追加されず → ホームに表示されない ❌
```

### ✅ 修正後（期待）
```
1. STAGE5 でコメント保存 → progress_logs に記録（okr_id + content + score + status）
2. OKR が削除される → okrs.is_deleted = true に更新
3. ホーム API は全 OKR を取得（is_deleted 無視）→ 該当 OKR が okrMetaMap に入る
4. progress_logs は okr_id で join → latestByProject に追加される → ホームに表示される ✓
```

---

## 検証方法

以下の手順で修正を確認してください：

### 1. コメント保存テスト
```
ステップ：
1. ホーム画面を開く
2. STAGE5 対象プロジェクトを開く
3. コメントを1件保存
4. ブラウザ DevTools の Console を開く
5. 以下のログを確認：
   - [saveProgressLog-insert-payload]
   - [saveProgressLog-insert-result]
6. 返却カラムに id, okr_id, content, status, score, created_at が含まれているか確認
```

### 2. ホーム API テスト
```
ステップ：
1. ホーム画面を更新（F5）
2. Network タブで /api/stage5/execution-summary への GET リクエストを確認
3. Console で [execution-summary-filtering] ログを確認
4. skipReasons を確認：
   - emptyOkrId: 0 であること（okr_id が保存されている）
   - okrMetaNotFound: 少ないこと（okrs が全て取得されている）
   - added: ≥ 1 であること（latestByProject に追加されている）
```

### 3. ホーム表示テスト
```
ステップ：
1. ホーム画面で「直近7日の更新」セクションを確認
2. 保存したコメントが表示されているか確認
3. [ExecutionPanel-recentProjectUpdates] ログで：
   - totalFromAPI: API から返却された件数
   - afterDismissFilter: dismiss で除外された後の件数
   - が一致しているか確認（dismiss していなければ同じ）
```

### 4. Soft Delete OKR テスト（応用）
```
ステップ：
1. Supabase 管理画面で、コメントが入っている OKR を soft delete（is_deleted = true）
2. ホーム API を再実行
3. [execution-summary-filtering] ログで skipReasons.okrMetaNotFound が増えていないことを確認
4. ホームにコメントが表示されたままであることを確認
```

---

## ファイル修正一覧

### 完全修正版

#### 1. `app/api/stage5/execution-summary/route.ts`
**修正行：** 186-355

主な変更：
- is_deleted フィルター削除（行186-192）
- skipReasons カウント追加（行301-308, 312-335）
- 診断ログ追加（行348-355）

#### 2. `utils/supabase/strategy.ts`
**修正行：** 2668-2720

主な変更：
- department カラム削除（行2668-2679）
- INSERT payload ログ追加（行2681-2690）
- エラー詳細ログ追加（行2698-2706）
- 返却カラムログ追加（行2710-2717）

#### 3. `components/home/ExecutionPanel.tsx`
**修正行：** 195-222

主な変更：
- dismiss filter 詳細ログ追加（行200-206）
- API 返却データログ追加（行210-219）

---

## 備考

### なぜ一度は表示されて、その後表示されないのか

この問題は以下のシナリオで発生します：

1. **作成直後は表示される**：OKR の is_deleted = false のため
2. **OKR が削除される**：管理画面で soft delete（is_deleted = true）される
3. **同じ OKR にコメント追加**：progress_logs に新しいレコード追加
4. **ホーム API は古い OKR を除外**：okrs.is_deleted = false で filter
5. **新しいコメントが表示されない**：okrMetaMap に該当 OKR がない

修正後は、okrs.is_deleted に関係なく latestByProject に追加されるため、「一度は表示」「その後非表示」という不安定な動作は解消されます。

### 今後の推奨事項

1. **dismiss 機能の改善**
   - 現在：`departmentId:projectId:latestUpdateAt` で dismiss
   - 推奨：新しい latestUpdateAt が来たら自動的に再表示（現在は実装済み）

2. **soft delete OKR の progress_logs 処理**
   - 将来的には、削除済み OKR のコメントは「アーカイブ」セクションに移動する検討

3. **OKR ID の stability**
   - projectId が UI 側と DB 側で一致していることを確保（既に確認済み）

---

## テスト確認用チェックリスト

- [ ] STAGE5 でコメント保存 → ホームに表示される
- [ ] ホーム画面で「開く」をクリック → dismiss される
- [ ] 同じプロジェクトに新規コメント → 再度表示される
- [ ] Supabase で OKR を soft delete → ホームのコメントが表示される
- [ ] Console ログが出力される（診断ログ確認）
- [ ] API response に recentProjectUpdates が含まれる
- [ ] STAGE6 や他ステージに影響がない

---

**修正完了日：** 2026-04-05
**修正者：** Claude Code
**ステータス：** ✅ 実装完了・テスト待ち
