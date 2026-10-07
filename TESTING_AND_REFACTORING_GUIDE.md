# STAGE1 Import テスト・リファクタリングガイド

## テスト計画

### Playwright E2E テスト (`tests/stage1-import.spec.ts`)

**実行方法:**
```bash
npm run test  # または playwright test
```

**テスト対象ファイル:**
1. ✅ `test-01-empty-format.xlsx` - 空の標準フォーマット
2. ✅ `test-02-company-pl-only.xlsx` - 全社PL のみ
3. ✅ `test-03-company-pl-bs.xlsx` - 全社PL + BS
4. ✅ `test-04-company-pl-bs-segment-pl.xlsx` - 事業別PL あり
5. ✅ `test-05-all-sheets.xlsx` - 事業別BS あり
6. ✅ `test-06-with-empty-cells.xlsx` - 空欄を含むファイル
7. ✅ `test-07-alternative-sheet-names.xlsx` - 非標準シート名
8. ✅ `test-08-many-sheets.xlsx` - 複数シート
9. ✅ `test-09-three-segments.xlsx` - 3事業部

**手動テスト対象:**
- 丹青社の実データ入りファイル（ユーザーが提供）

### エラーハンドリング検証 (`tests/stage1-import-errors.spec.ts`)

**確認項目:**
- ✅ エラー時は JSON を返す（HTML 500 ではない）
- ✅ レスポンス Content-Type は application/json
- ✅ エラーレスポンスに `success: false` と `error` フィールドがある
- ✅ DOMMatrix エラーが発生しない（PDF dynamic import で解決）

## 共通ロジック構造

### 現状分析

**ファイル:**
- `/api/stage1/import/route.ts` - 認証あり（本番）
- `/api/stage1/import-dev/route.ts` - 認証なし（開発用）

**共通部分:**
- Excel/CSV/PDF パース処理 ✅ 同一ロジック
- 候補生成処理 ✅ 同一ロジック
- レスポンス形式 ✅ 同一構造

**相違点:**
- 認証チェック（Steps 1-5）- 本番のみ
- ログのプレフィックス - `[stage1/import]` vs `[stage1/import-dev]`

### リファクタリング提案

**オプション A（推奨）: 関数抽出**

```typescript
// /lib/server/stage1-import-handler.ts
export async function handleStage1Import(
  buffer: Buffer,
  fileName: string,
  requestId: string
): Promise<Stage1ImportCandidate[]> {
  // 共通ロジック（File → Excel/CSV/PDF パース → 候補生成）
  // 認証チェックなし
}
```

**利点:**
- ロジック重複なし
- テストが簡単（単体テスト可能）
- 保守性向上

**オプション B（現状維持）: 構造は良好**

現在のコード構造は既に十分で、エラーハンドリングも正しく実装されています。

## エラーハンドリング検証

### 実装済みの確認項目

✅ **例外キャプチャ:**
```typescript
catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error ? err.stack : undefined;
  const errorCause = (err as any)?.cause;
  
  console.error(`[stage1/import] [${reqId}] Fatal Error`, {
    message: errorMessage,
    stack: errorStack,
    cause: errorCause,
    // ...
  });
}
```

✅ **JSON レスポンス:**
```typescript
return NextResponse.json<Stage1ImportResult>(
  {
    success: false,
    error: 'ファイル解析に失敗しました',
    candidates: [],
    previewText: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
  },
  { status: 500 }
);
```

✅ **DOMMatrix 対策:**
- pdfImporter は dynamic import
- Excel/CSV では PDF モジュール不要
- モジュールロード時エラー回避

## テスト実行チェックリスト

### ローカル開発環境

- [ ] `npm run dev` でサーバー起動
- [ ] `npm run test` で E2E テスト実行
- [ ] すべてのテストファイルが HTTP 200 で処理される
- [ ] JSON エラー（HTML 500 ではない）が返される
- [ ] ブラウザコンソールに DOMMatrix エラーなし

### 本番環境（Vercel）

- [ ] デプロイ完了を確認
- [ ] STAGE1 ページでファイルアップロード
- [ ] test-02-company-pl-only.xlsx が正常処理
- [ ] Vercel ログで DOMMatrix エラーなし
- [ ] 候補が正常に画面に表示

## 今後の改善案

1. **ユニットテスト追加:**
   - Excel パース関数の単体テスト（Jest）
   - エラーハンドリングのテスト

2. **CI/CD 統合:**
   - PR 時に自動テスト実行
   - テスト失敗でマージブロック

3. **ファイルバリデーション強化:**
   - ファイルサイズ警告
   - シート数上限
   - 行数上限

4. **ユーザーフィードバック:**
   - 候補数をユーザーに通知
   - 抽出パフォーマンス表示
   - 推奨形式ガイダンス

## デバッグ時の注意点

**Vercel ログで確認すべき項目:**
```
[stage1/import] [${reqId}] === REQUEST START ===
[stage1/import] [${reqId}] [Step 1] getSupabaseAdmin()
[stage1/import] [${reqId}] [Step 3] getAuthUserIdFromBearer()
[stage1/import] [${reqId}] [Step 4] requireMembership()
[stage1/import] [${reqId}] [Step 6] formData parsed successfully
[stage1/import] [${reqId}] [Step 9] parseExcel succeeded
[stage1/import] [${reqId}] [Step 10] buildCandidatesFromTable
[stage1/import] [${reqId}] [Step 11] POST completed successfully
```

**もし DOMMatrix エラーが再発したら:**
1. Vercel ログで `[PDF]` タグを検索
2. PDF 処理以外のエラーがないか確認
3. 静的 import の漏れを確認（grep: `import.*pdfImporter`）
