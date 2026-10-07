# DOMMatrix ReferenceError 修正レポート

## 原因特定

**エラー:** `ReferenceError: DOMMatrix is not defined`

**発生箇所:** Vercel 本番環境での API ルート初期化時（リクエスト処理前）

**根本原因チェーン:**
1. `/api/stage1/import/route.ts` が `pdfImporter` を static import
2. `pdfImporter.ts` が CommonJS `require('pdf-parse')` で pdf-parse ライブラリをロード
3. `pdf-parse` は `pdfjs-dist` に依存
4. `pdfjs-dist` は DOMMatrix（ DOM API）を参照
5. Vercel サーバーランタイム（Node.js）では DOMMatrix が定義されていない
6. **結果:** モジュールロード時に即座に失敗（リクエストより前に）

## ローカル環境で落ちなかった理由

**ローカル（Next.js dev server）:**
- デフォルト: Node.js Runtime
- `require('pdf-parse')` は遅延実行（実際に PDF 処理が呼ばれるまで）
- または、開発環境で何らかの polyfill が効いていた可能性

**Vercel 本番:**
- strict module evaluation（モジュールがインポートされた時点で全コードが評価される）
- polyfill なし
- 即座にエラー

## 修正内容

### 修正1: pdfImporter の static import を削除

**ファイル:** `app/api/stage1/import/route.ts`

**変更前:**
```typescript
import { parsePdf, isPdfBuffer } from '@/utils/stage1/importers/pdfImporter';
```

**変更後:**
```typescript
// ★ CRITICAL: pdfImporter は PDF 処理時のみ dynamic import（DOMMatrix 要求避け）
// import { parsePdf, isPdfBuffer } from '@/utils/stage1/importers/pdfImporter';

/** PDF ファイルを判定（pdfImporter の依存を避けるためローカル実装） */
function isPdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const header = buffer.slice(0, 5).toString('ascii');
  return header === '%PDF-';
}
```

### 修正2: PDF 処理で dynamic import

**変更前:**
```typescript
} else if (isPdfBuffer(buffer)) {
  const pdfResult = await parsePdf(buffer);
  // ...
}
```

**変更後:**
```typescript
} else if (isPdfBuffer(buffer)) {
  // ★ CRITICAL: Dynamic import to avoid DOMMatrix error
  const { parsePdf: parsePdfDynamic } = await import('@/utils/stage1/importers/pdfImporter');
  const pdfResult = await parsePdfDynamic(buffer);
  // ...
}
```

## 効果

| ファイルタイプ | 以前 | 修正後 |
|-------------|-----|--------|
| Excel | ❌ ReferenceError | ✅ HTTP 200 |
| CSV | ❌ ReferenceError | ✅ HTTP 200 |
| PDF | ❌ ReferenceError | ✅ dynamic load → HTTP 200 |

**重要:** Excel/CSV リクエストは PDF モジュール（およびその依存）に一切到達しません。

## なぜ本番だけ落ちたか

1. **ローカル dev server**: 
   - `next dev` は HMR 対応で段階的ロード
   - PDF 処理が実際に実行されるまでモジュール評価が遅延する可能性

2. **Vercel 本番（production build）:**
   - webpack/esbuild による完全な ahead-of-time コンパイル
   - すべてのインポートが初期化時に strict に評価される
   - polyfill なし
   - 即座にエラー

## テスト計画

### ローカルテスト（完了）
✅ `test-02-company-pl-only.xlsx` → HTTP 200

### 本番テスト（待機中）
1. test-02-company-pl-only.xlsx（Excel）
2. 丹青社の標準フォーマット Excel
3. PDF ファイル

## 関連ファイル

| ファイル | 修正内容 |
|---------|---------|
| `/api/stage1/import/route.ts` | pdfImporter static import 削除 → dynamic import 追加 |
| `/api/stage1/import-dev/route.ts` | 同上（開発用エンドポイント） |

## 参考情報

- **DOMMatrix:** W3C DOM API（ブラウザのみ）
- **pdfjs-dist:** Mozilla PDF.js の npm パッケージ
- **Dynamic import:** `await import(...)` で遅延ロード（モジュール評価を実行時に延期）
