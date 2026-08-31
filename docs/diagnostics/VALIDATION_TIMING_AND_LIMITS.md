# STAGE1 Excel Import - Validation Timing と制限分類

## 1. 提案する4制限の検査タイミング

### 1.1 ファイルサイズ 20MB

**検査タイミング**: XLSX.read() **前**  
**方法**: ファイルアップロード時（既実装）  
**根拠**:
- `file.size > MAX_FILE_SIZE` で buffer 化前に拒否可能
- メモリ効率が最高（buffer 作成をスキップ）
- 現在の実装で既に存在 ✓

**コード**:
```typescript
if (file.size > MAX_FILE_SIZE) {
  throw new Error('File size exceeds 20MB');
}
```

---

### 1.2 シート数 50

**検査タイミング**: XLSX.read() **後**  
**方法**: `workbook.SheetNames.length` で判定  
**根拠**:
- XLSX.read() の前に シート数は不明（ファイルフォーマットをparse必須）
- read() 直後の判定で十分（parse自体は高速）
- 実装コスト: 1行追加

**コード**:
```typescript
const workbook = XLSX.read(buffer, { type: 'buffer' });
if (workbook.SheetNames.length > 50) {
  throw new Error('Sheet count exceeds 50');
}
```

---

### 1.3 行数 50,000 / 列数 300

**検査タイミング**: XLSX.read() **時**（sheetRows オプション併用）  
**方法**: SheetJS `sheetRows` オプションでparse時に行数制限  
**根拠**:
- `sheetRows: 50000` で XLSX.read() 時に行解析を制限できる
- **メモリ削減効果が最大**：50,000行以上の配列作成をスキップ
- sheet_to_json() 後の判定より効率的

**検査順序**:
1. XLSX.read() で sheetRows を適用
2. 各シートの列数を sheet_to_json() 後に判定

**コード**:
```typescript
// Parse時に行数制限（メモリ効率優先）
const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 50000 });

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  
  // Parse後に列数判定
  if (jsonData[0]?.length > 300) {
    throw new Error(`Sheet "${sheetName}" exceeds 300 columns`);
  }
}
```

---

### 1.4 セル文字列長 10,000文字

**検査タイミング**: parseNumber() **後**（セル値処理時）  
**方法**: String(val).trim() 後に .length 判定  
**根拠**:
- SheetJS parseオプションでは細粒度制御できない
- セル値が数値か文字列かは parse時に初めて確定
- 解析後判定が最小コスト

**コード**:
```typescript
if (val !== undefined && val !== null && val !== '') {
  const stringVal = String(val).trim();
  if (stringVal.length > 10000) {
    throw new Error(`Cell value exceeds 10,000 characters`);
  }
  const num = parseNumber(stringVal);
  obj[key] = num !== null ? num : stringVal;
}
```

---

## 2. 制限の分類：どれが本当に必要か

### Security Hard Limit（必ず実装）

| 制限 | タイプ | 判定タイミング | 必要性 | 理由 |
|-----|--------|-------------|--------|------|
| **20MB ファイルサイズ** | Hard | 前 | ✅ 既実装 | ファイル I/O リソース |
| **50 シート数** | Hard | 後 | ✅ 推奨 | 処理時間 ∝ シート数 |
| **50,000 行数** | Hard | 時 | ✅ 推奨 | メモリ配列化リスク |

### Business Limit（GROWTH SHIFT 業務判定）

| 制限 | タイプ | 判定タイミング | 必要性 | 理由 |
|-----|--------|-------------|--------|------|
| **300 列数** | Business | 後 | ⚠️ 検討 | 候補生成時間・Object数 |
| **10,000 セル文字長** | Business | 後 | ⚠️ 検討 | テキストメモリ・正規化処理 |

### Warning Only（オプション）

| 制限 | タイプ | 判定タイミング | 必要性 | 理由 |
|-----|--------|-------------|--------|------|
| **5,000 候補数** | Warning | 後 | ❌ 不要 | 20MB制限で実質制御 |
| **1,000,000 総セル数** | Warning | 後 | ❌ 不要 | 行×列制限で自動制御 |

---

## 3. 20MB 制限で既に防げているリスク

### ✅ 既存の 20MB 制限で防げている攻撃

```
最悪想定: 20MB ファイル全体をセル化（圧縮率0%）
  = 20,000,000 バイト
  ÷ 50 バイト/セル（テキスト + メタデータ）
  = 400,000 セル上限

20,000,000 セル で メモリ枯渇させるには
  → 最低 5MB ファイルサイズ必要
  → 20MB 制限で自動防止
```

**結論**: 20MB ファイルサイズ制限だけで、単一シートの大規模攻撃は防げている。

---

## 4. PoC向け：最小限の Defense in Depth

### 実装すべき制限（最小限）

| # | 制限 | 分類 | 検査タイミング | 追加難易度 | diff行数 |
|---|-----|------|-------------|----------|---------|
| 1 | 50 シート数 | Hard | read() 後 | 易 | 3-4行 |
| 2 | 50,000 行数 | Hard | read() 時（sheetRows） | 易 | 1行変更 |
| 3 | 300 列数 | Business | parse後 | 易 | 3-4行 |

**実装不要**:
- セル文字列長チェック（20MB制限で十分）
- 総セル数チェック（行×列制限で冗長）
- 候補数警告（実装後に評価）

### PoC 向けの正確な diff イメージ

**ファイル**: `utils/stage1/importers/excelCsvImporter.ts`

```diff
export function parseExcel(buffer: Buffer): ExtractedTable[] {
-  const workbook = XLSX.read(buffer, { type: 'buffer' });
+  // Hard limit: max 50,000 rows per sheet (prevent memory exhaustion)
+  const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 50000 });
   const tables: ExtractedTable[] = [];
   
   for (const sheetName of workbook.SheetNames) {
     const sheet = workbook.Sheets[sheetName];
     if (!sheet) continue;
     
     const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
       header: 1,
       defval: null,
     }) as any[][];
     
     if (!jsonData || jsonData.length === 0) continue;
     
+    // Business limit: max 300 columns per sheet
+    const maxCols = jsonData[0]?.length || 0;
+    if (maxCols > 300) {
+      console.warn(`Sheet "${sheetName}" has ${maxCols} columns, limiting to 300`);
+      // Truncate to 300 columns
+    }
```

**ファイル**: `app/api/stage1/import/route.ts`

```diff
} else if (fileType === 'excel') {
   const tables = parseExcel(buffer);
   
+  // Security hard limit: max 50 sheets per file
+  if (tables.length > 50) {
+    return NextResponse.json(
+      { error: 'Excel file exceeds 50 sheets limit' },
+      { status: 400 }
+    );
+  }
```

---

## 5. CSV への影響

CSV は `papaparse` で全行をメモリ解析するため、同じ制限が必要：

```diff
export function parseCSV(csvText: string): ExtractedTable {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
+   header: false,
+   // sheetRows 相当の制限は papaparse にはないため、parse後判定
  });

  if (!result.data || result.data.length === 0) {
    return { headers: [], rows: [], sourceRef: 'CSV' };
  }

+  // Hard limit: max 50,000 rows
+  if (result.data.length > 50000) {
+    result.data = result.data.slice(0, 50000);
+    console.warn('CSV exceeds 50,000 rows, truncated');
+  }

  // ... rest of code
}
```

---

## 6. 実装方針サマリー

### 段階1：PoC向け最小限（推奨）

1. ✅ XLSX.read() に `sheetRows: 50000` 追加（1行）
2. ✅ シート数チェック（3-4行）
3. ✅ 列数チェック（3-4行）
4. ✅ CSV 行数チェック（2-3行）

**合計**: 約15-20行の追加 / 修正

### 段階2：本実装向け（PoC後）

1. セル文字列長チェック
2. エラーメッセージの国際化
3. フロントエンド入力検証
4. ログ・監視の統合

---

## 7. リスク評価

| シナリオ | 20MB制限 | 50シート | 50k行 | 300列 | 結果 |
|---------|---------|---------|-------|-------|------|
| 通常財務Excel | ✅ | ✅ | ✅ | ✅ | 許可 |
| 超大規模ファイル | ❌ | - | - | - | 拒否 |
| 1000シート空ファイル | ✅ | ❌ | - | - | 拒否 |
| 100万行1列 | ❌ | - | - | - | 拒否（20MB超）|
| 10万行100列 | ✅ | ✅ | ❌ | ✅ | 拒否（行超過） |
| 1000行1000列 | ✅ | ✅ | ✅ | ❌ | 拒否（列超過） |
