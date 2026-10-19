# Growth MVP v2.0 - Phase 3 計画

**目標**: ステークホルダー別計画書の PDF ダウンロード機能実装  
**範囲**: PDF 出力のみ（Supabase 永続化は実施しない）  
**推定工数**: 3-4日  

---

## 📋 実装範囲

### ✅ 実装する機能

1. **PDF 出力機能**
   - 銀行向け（経営改善・事業計画書）
   - 株主向け（中期経営計画書）
   - 社員向け（経営方針・実行計画書）

2. **PDF 構成要素**
   - [ ] 表紙（企業名、audience、生成日時）
   - [ ] ページ番号
   - [ ] 章見出し
   - [ ] 本文（AI生成テキスト）
   - [ ] 表（会社情報、STAGE別データ）
   - [ ] ページブレーク制御

3. **品質保証**
   - [ ] 日本語の文字化け確認
   - [ ] 改ページ・レイアウト検証
   - [ ] 文章切れ確認
   - [ ] AI生成本文と UI での矛盾確認

### ❌ 実装しない

- ❌ Supabase への生成結果保存
- ❌ 生成履歴管理
- ❌ バージョン管理
- ❌ 承認ワークフロー
- ❌ Word・Excel 出力

---

## 🏗️ 実装方式

### 既存資産の再利用

**既存の PDF 出力基盤**:
- `components/export/Stage2ReportView.tsx` - PDF 印刷レイアウト参考
- `components/export/ReportLayout.tsx` - 共通スタイル（pdfReportWrapper など）
- `useStage2PdfExport()` などのフック - 出力パターン参考
- `html2canvas` + `jsPDF` ライブラリ（既に dependencies に存在）

### 実装パターン

```
[audience]-plan/page.tsx
  └─ PlanPreview コンポーネント
      └─ PDFダウンロードボタン
          └─ usePlanPdfExport() フック
              └─ html2pdf 変換 + ダウンロード
```

---

## 📝 必要な修正・追加

### 1. PDF エクスポート用フック（新規）

**`hooks/usePlanPdfExport.ts`**

```typescript
export function usePlanPdfExport(audience: AudienceType) {
  const [isExporting, setIsExporting] = React.useState(false);
  
  const handleExport = async (elementRef: React.RefObject<HTMLElement>) => {
    setIsExporting(true);
    try {
      // 1. html2canvas で HTML を canvas に変換
      // 2. jsPDF に埋め込み
      // 3. PDF をダウンロード
      // 4. ファイル名: `${companyName}_${audience}.pdf`
    } finally {
      setIsExporting(false);
    }
  };
  
  return { handleExport, isExporting };
}
```

### 2. PDF 専用レイアウトコンポーネント（新規）

**`components/export/PlanPdfTemplate.tsx`**

```typescript
// 目的: HTML to PDF 変換用の印刷最適化レイアウト
// - 表紙
// - ページブレーク
// - 章見出し
// - 本文（AI生成）
// - ページ番号

export function PlanPdfTemplate({
  companyName,
  audience,
  generatedDate,
  sections,
  // その他metadata
}) {
  return (
    <div className="pdf-template">
      {/* 表紙 */}
      <CoverPage ... />
      
      {/* 本文（セクション） */}
      {sections.map(section => (
        <Section key={...} content={section} />
      ))}
      
      {/* 検証警告（オプション） */}
      <ValidationPage ... />
    </div>
  );
}
```

### 3. PlanPreview への PDF ボタン統合（改修）

**`components/export/PlanPreview.tsx`**

```typescript
// 既存コード
<button onClick={() => window.print()}>
  📥 PDFダウンロード
</button>

// 修正後
<button ref={printRef} onClick={handlePdfExport}>
  📥 PDFダウンロード
</button>
```

### 4. ページ設定（CSS）

```css
@media print {
  /* ページサイズ: A4 */
  @page {
    size: A4;
    margin: 1cm;
  }
  
  /* ページ番号 */
  body::after {
    content: counter(page);
  }
  
  /* 改ページ制御 */
  .section {
    page-break-inside: avoid;
  }
  
  .page-break {
    page-break-after: always;
  }
}
```

---

## 🧪 テスト項目

### 表示・レイアウト

- [ ] 表紙が正しく表示
- [ ] AI生成本文が正しく表示
- [ ] テーブル・リストが正しくレンダリング
- [ ] ページ番号が表示

### PDF品質

- [ ] 日本語フォント（MS Gothic など）で文字化けなし
- [ ] 改ページが意図通り
- [ ] 長い本文で切れなし
- [ ] 画像が含まれる場合は解像度確認

### 機能

- [ ] 銀行向け PDF 出力
- [ ] 株主向け PDF 出力
- [ ] 社員向け PDF 出力
- [ ] ファイル名が正しい（`{companyName}_{audience}.pdf`）
- [ ] ダウンロード完了後、ボタンが再度使用可能

### 整合性

- [ ] PDF の本文が UI プレビューと同じ
- [ ] 検証警告が PDF にも表示される（またはページ番号）
- [ ] 日付・会社名が正確

---

## 📊 実装ステップ

### Step 1: フック実装（1日）
- [ ] `usePlanPdfExport.ts` 作成
- [ ] html2canvas + jsPDF ラッパー実装
- [ ] エラーハンドリング

### Step 2: PDF テンプレート実装（1日）
- [ ] `PlanPdfTemplate.tsx` 作成
- [ ] 表紙・本文・ページ番号レイアウト
- [ ] CSS 印刷設定

### Step 3: 統合・テスト（1-2日）
- [ ] PlanPreview に PDF ボタン統合
- [ ] 3種類 audience の PDF 出力テスト
- [ ] 日本語フォント確認
- [ ] レイアウト調整

---

## ⚠️ 注意事項

### 既存コード保護

- ✅ STAGE1-6: 変更なし
- ✅ 既存 PDF（Stage2ReportView など）: 変更なし
- ✅ 既存 API: 変更なし
- ✅ strategyStore: 新規フィールド追加なし

### 依存ライブラリ

- ✅ `html2canvas` - 既に dependencies に存在
- ✅ `jspdf` - 既に dependencies に存在
- ⚠️ フォント設定 - 必要に応じて検証

---

## 🚀 開始条件

### Phase 3 開始前に確認

- [x] Phase 2 動作検証完了
- [x] AIモデル（Luna）設定完了
- [x] STAGE5・6 データ連携確認
- [x] セキュリティ検証完了
- [ ] 本番環境でのテスト環境準備（推奨）

---

## 📝 成功基準

- ✅ 3種類の audience 別 PDF 出力可能
- ✅ 日本語表示に問題なし
- ✅ UI プレビュー と PDF の内容が一致
- ✅ 既存機能への影響なし
- ✅ ローカルで安全に生成・PDF出力可能

---

**Phase 3 は Phase 2 完了後、セキュリティ検証に問題がない場合のみ開始。**
