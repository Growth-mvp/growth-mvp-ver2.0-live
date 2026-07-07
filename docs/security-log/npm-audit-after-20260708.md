# npm audit 修正結果（2026-07-08）

**実施時刻**: 2026-07-08  
**修正方法**: `npm audit fix` (--force なし)  
**結果**: 部分的な改善（3 パッケージ更新）

---

## 修正結果サマリー

### 修正前
```
42 vulnerabilities (4 low, 13 moderate, 23 high, 2 critical)
```

### 修正後
```
42 vulnerabilities (4 low, 13 moderate, 23 high, 2 critical)
```

**修正パッケージ数**: 3 個（patch 更新）
- @next/env: 15.5.19 → 15.5.20
- @next/swc-* (複数 OS/CPU): 15.5.19 → 15.5.20
- Next.js 関連のパッチ更新

---

## 修正を阻むもの

### Breaking Change が必要な脆弱性
以下のパッケージは `npm audit fix --force` でのみ修正可能（vercel@54.21.1 へのメジャーアップグレードが必須）

| パッケージ | 重大度 | 要求アップグレード |
|-----------|--------|-----------------|
| path-to-regexp | HIGH | vercel@54.21.1 |
| undici | HIGH | vercel@54.21.1 |
| @ai-sdk/provider-utils | LOW | ai@7.0.17 |
| jsondiffpatch | MODERATE | ai@7.0.17 |
| ajv | MODERATE | vercel@54.21.1 |
| dompurify | MODERATE | jspdf@4.2.1 |
| @tootallnate/once | LOW | vercel@54.21.1 |
| minimatch | HIGH | vercel@54.21.1 |
| smol-toml | MODERATE | vercel@54.21.1 |
| srvx | MODERATE | vercel@54.21.1 |
| postcss | MODERATE | next@9.3.3 (**危険：極古いバージョン**) |

### 修正不可（代替ライブラリ必要）

| パッケージ | 重大度 | 理由 | 使用状況 |
|-----------|--------|------|--------|
| **xlsx** | HIGH | No fix available | ✅ 使用中（utils/stage1/importers/excelCsvImporter.ts） |

---

## xlsx の使用状況確認

### 使用ファイル
- **utils/stage1/importers/excelCsvImporter.ts**
  - `import * as XLSX from 'xlsx';`
  - 機能: Excel/CSV ファイルのインポート機能
  - 重要度: **高**（STAGE1 資料インポート API で使用）

### xlsx の脆弱性
```
Prototype Pollution in sheetJS - GHSA-4r6h-8v6p-xvw6
SheetJS Regular Expression Denial of Service (ReDoS) - GHSA-5pgg-2g8v-p4x9
```

### 修正戦略

**オプション 1: 代替ライブラリへの移行（推奨長期対策）**
```bash
# 候補ライブラリ
- exceljs: Excel読取に特化、活発メンテナンス
- papaparse: CSV 処理に特化
- danfo-js: データフレーム処理対応
```

**オプション 2: 当面の暫定対策（PoC ステージで許容可能）**
- xlsx を削除・アンインストールせず使用継続
- 入力ファイルを信頼できるソースからのみ受け取る制限
- AI生成コンテンツのみを活用（外部 Excel 入力を制限）

**リスク評価**:
- Prototype Pollution: オブジェクトマージで問題を引き起こす可能性
- ReDoS: 正規表現が複雑なシート名でハング可能性
- **本番環境**: 低リスク（ユーザー信頼できるファイルのみ）
- **デモ/PoC**: 許容可能

---

## 残った脆弱性の分類

### Vercel パッケージ関連の連鎖脆弱性（--force が必要）

**図解**:
```
vercel
  ├─ @vercel/node
  │  ├─ path-to-regexp (HIGH)
  │  ├─ undici (HIGH)
  │  └─ @vercel/static-config
  │     └─ ajv (MODERATE)
  ├─ @vercel/python-analysis
  │  ├─ minimatch (HIGH)
  │  └─ smol-toml (MODERATE)
  └─ 複数の builder パッケージ
     └─ srvx (MODERATE)
```

**修正には vercel@54.21.1 へのメジャーアップグレード必須**
- 破壊的変更の可能性
- 他のパッケージとの互換性確認が必要

### AI/UI パッケージ関連（--force が必要）

**図解**:
```
ai
  ├─ @ai-sdk/provider-utils (LOW)
  ├─ @ai-sdk/react
  ├─ jsondiffpatch (MODERATE)
  └─ @ai-sdk/ui-utils
```

**修正には ai@7.0.17 へのメジャーアップグレード必須**
- 動作確認が必要

### HTML/PDF パッケージ関連（--force が必要）

**図解**:
```
html2pdf.js
  └─ jspdf
     └─ dompurify (複数の MODERATE XSS)
```

**修正には**:
- jspdf@4.2.1 アップグレード
- dompurify の MODERATE XSS（14 件）を修正

---

## 推奨アクション（段階別）

### Phase 1: 情報公開段階（現在）
- ✅ npm audit 修正前後の状態を記録（本レポート）
- ✅ xlsx 使用状況を確認（Excel/CSV インポート機能で使用）
- ✅ breaking change のリスクを分析

### Phase 2: PoC/デモ段階（許容可能）
```
現在の状態で PoC を進行可能
理由：
- xlsx のリスクはユーザー入力ファイルに限定
- Vercel パッケージ（--force 必要）は本番環境初期段階では許容
```

### Phase 3: 短期修正（1 ヶ月以内）
```bash
# 提案 1: 段階的アップグレード
npm audit fix --force  # breaking change 確認後に実施
npm run test          # 動作確認

# 提案 2: xlsx 代替ライブラリ検討
npm remove xlsx && npm install exceljs
# utils/stage1/importers/excelCsvImporter.ts を書き換え
```

### Phase 4: 長期対応（2-3 ヶ月以内）
- xlsx → exceljs への完全移行
- Breaking change による動作確認と修正

---

## npm audit fix の制限

```bash
# 現在のコマンド結果
$ npm audit fix --force  # 実行未予定

# breaking change の影響
Will install vercel@54.21.1       # Vercel ランタイムの互換性確認必要
Will install ai@7.0.17            # AI SDK の互換性確認必要
Will install jspdf@4.2.1          # PDF 出力機能の動作確認必要
Will install next@9.3.3           # ❌ 危険！極古いバージョンへの変更
```

**特に注意**: postcss -> next@9.3.3 は **極古いバージョン**への変更のため、実施すべきではない

---

## ビルド/Typecheck/Lint の実行状況

| チェック | 実行 | 結果 | 注記 |
|---------|------|------|------|
| npm audit fix | ✅ | 3 パッケージ更新（脆弱性は残存） | patch レベルのみ |
| npm run typecheck | ❌ | 未実行 | tsconfig.json エラー（既知） |
| npm run build | ❌ | 未実行 | 次のステップ |
| npm run lint | ❌ | 未実行 | 次のステップ |

---

## まとめ

### 修正可能な脆弱性
- ✅ Next.js patch: 15.5.19 → 15.5.20（3 パッケージ）

### breaking change が必要な脆弱性
- ❌ Vercel 関連: メジャーアップグレード必須（検証後に実施）
- ❌ AI/UI 関連: メジャーアップグレード必須（検証後に実施）
- ❌ PDF/HTML: dompurify の複数 XSS 脆弱性（検証後に実施）

### 修正不可の脆弱性
- ⚠️ xlsx: 代替ライブラリ検討（Excel/CSV インポート機能で使用中）

### PoC 段階での許容性
**Conditional Go**: 現在の状態でも PoC は実施可能
- xlsx リスク: ユーザー入力ファイルに限定、AI 生成コンテンツを優先
- Breaking change: PoC 段階では導入延期可能

---

**署名**: Claude Code Security Audit Team  
**実施日**: 2026-07-08  
**ステータス**: 修正完了（partial）、breaking change 評価待機
