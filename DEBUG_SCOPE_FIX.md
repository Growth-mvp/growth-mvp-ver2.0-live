# STAGE1 財務データ取込 - Scope 検出修正

## 修正概要

3つの重大な問題を修正しました：

1. **全社PL / 全社BS が segment として検出される** → 修正
2. **事業別PL が事業別に分離されない（シート名をsegmentNameにしていた）** → 修正
3. **全社BS から PL 候補が生成される** → 修正予定

## 実装内容

### 1. detectScopeFromTable の詳細ログ追加

**ファイル**: `/utils/stage1/importers/candidateBuilder.ts` (行 54-106)

各プロパティを個別にログ出力し、正規表現マッチの詳細を表示：

```typescript
[detectScopeFromTable] ALL PROPERTIES {
  segmentName: "(empty)",
  sheetName: "全社PL",
  title: "(empty)",
  sourceRef: "Excel:全社PL"
}
[detectScopeFromTable] SELECTED SEG { seg: "全社PL" }
[detectScopeFromTable] Company regex test {
  pattern: "全社|連結|合算|会社|company|consolidated",
  seg: "全社PL",
  matches: true
}
[detectScopeFromTable] → company (matched company keyword)
```

### 2. セグメント名を row データから取得

**ファイル**: `/utils/stage1/importers/candidateBuilder.ts` (行 166-171, 190-198)

#### a) segmentNameColumn 検出
```typescript
const segmentNameColumn =
  scope === 'segment' ?
  (table.headers.find((h) => /事業部名|事業名|セグメント名|segment|division/i.test(h)) ?? undefined)
  : undefined;
```

#### b) 各行で row データから抽出
```typescript
let rowSegmentName = segmentName;
if (segmentNameColumn) {
  const rowSegmentValue = String((row as any)[segmentNameColumn] ?? '').trim();
  if (rowSegmentValue) {
    rowSegmentName = rowSegmentValue;
  }
}
```

**効果**：
- 事業別PL シートの場合、row['事業部名'] の値がセグメント名として使用される
- シート名ではなく、実際の事業部名で分離される

### 3. PL フィールドパターン修正

**ファイル**: `/utils/stage1/importers/candidateBuilder.ts` (行 12-23)

より具体的なパターンを先にチェック：

```typescript
// Before: revenue が先で、/売上/ が "売上原価" に誤マッチ
revenue: [..., /売上/i, ...],
cogs: [/売上原価/i, ...],

// After: cogs を revenue より先に定義
cogs: [/売上原価/i, ...],  // より具体的
revenue: [..., /売上/i, ...],  // より一般的
```

## テスト方法

### 前準備

1. サーバーが起動している確認
   ```bash
   npm run dev
   ```

2. テストファイル（以下どちらでもOK）
   - 既存のExcelファイル（全社PL, 全社BS, 事業別PL を含む）
   - `test-financial-data.xlsx` （自動生成ファイル）

### テスト実行

1. http://localhost:3000/stage1 にアクセス
2. 「ファイルを選択」からExcelファイルをアップロード
3. サーバーターミナルのログを確認

### 期待出力

#### ターミナルログ

全体統計：
```
[stage1/import] candidates distribution: {
  totalCandidates: 20,
  segmentDistribution: {
    'companyPL': 5,
    'companyBS': 5,
    'segmentPL:金属缶製造販売事業': 5,
    'segmentPL:不動産賃貸事業': 5
  },
  segmentNames: [ '金属缶製造販売事業', '不動産賃貸事業' ]
}
```

各シートの詳細：

**全社PL シート**
```
[buildCandidatesFromTable] SCOPE DETECTION RESULT {
  detectedScope: 'company',
  detectedSegmentName: undefined
}
[buildCandidatesFromTable] Row 0: itemName="売上高", segmentName="undefined"
  → PL match: revenue
  → PUSH: companyPL, year=2026, field=revenue, ...
```

**全社BS シート**
```
[buildCandidatesFromTable] SCOPE DETECTION RESULT {
  detectedScope: 'company',
  detectedSegmentName: undefined
}
[buildCandidatesFromTable] Row 0: itemName="現金及び預金", segmentName="undefined"
  → PL match: none
  → BS match: cash
  → PUSH: companyBS, year=2026, field=cash, ...
```

**事業別PL シート**
```
[buildCandidatesFromTable] SCOPE DETECTION RESULT {
  detectedScope: 'segment',
  detectedSegmentName: '事業別PL'
}
[candidateBuilder] Item name column detection {
  itemNameColumn: '項目名',
  segmentNameColumn: '事業部名',  // ← 重要
  ...
}
[buildCandidatesFromTable] Row 0: itemName="売上高", segmentName="金属缶製造販売事業"
  → PUSH: segmentPL, year=2026, field=revenue, segmentName=金属缶製造販売事業
[buildCandidatesFromTable] Row 5: itemName="売上高", segmentName="不動産賃貸事業"
  → PUSH: segmentPL, year=2026, field=revenue, segmentName=不動産賃貸事業
```

## 検証チェックリスト

テスト後、以下をすべて確認：

```
☐ companyPL: 5件 ← 全社PL シートのPL項目
☐ companyBS: 5件 ← 全社BS シートのBS項目
☐ segmentPL (金属缶製造販売事業): 5件
☐ segmentPL (不動産賃貸事業): 5件
☐ segmentBS: 0件 ← 全社BS から BS 候補のみ出力され、PL候補は出ない
☐ 合計: 20件
☐ segmentNames: ['金属缶製造販売事業', '不動産賃貸事業'] のみ
```

## トラブルシューティング

### 問題: detectScopeFromTable が company を返さない

**確認方法**:
```
[detectScopeFromTable] Company regex test で matches: false の場合
```

**原因**: sheet名がマッチしていない
- 正規表現: `/全社|連結|合算|会社|company|consolidated/i`
- シート名が上記のキーワードを含まないか確認

### 問題: 事業別PL が分離されない

**確認方法**:
```
[candidateBuilder] Item name column detection で segmentNameColumn: undefined の場合
```

**原因**: ヘッダーに "事業部名" 列がない
- ヘッダーを確認：`[buildCandidatesFromTable] START` の headers を確認
- パターン `/事業部名|事業名|セグメント名|segment|division/i` に合わせてカラム名を確認

### 問題: 全社BS から PL 候補が出ている

**確認方法**:
```
[buildCandidatesFromTable] Row N: itemName="現金及び預金"
  → PL match: ??? (none以外の場合、問題あり)
```

**原因**: PL フィールドマッチが過度に広い
- "現金及び預金" は BS 項目のみのはず
- matchField の順序を確認

## コード変更一覧

| ファイル | 行 | 変更 |
|--------|-----|------|
| candidateBuilder.ts | 12-23 | PL_FIELD_PATTERNS の順序変更 (cogs→revenue) |
| candidateBuilder.ts | 54-106 | detectScopeFromTable にログ追加 |
| candidateBuilder.ts | 166-171 | segmentNameColumn 検出追加 |
| candidateBuilder.ts | 190-198 | rowSegmentName 抽出追加 |
| candidateBuilder.ts | 221, 247 | rowSegmentName をcandidate に設定 |
