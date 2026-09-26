# STAGE1 財務分析ロジック修正レポート

## 実装完了日
2026-09-26

## 修正対象（prompt.txt ガイダンスに基づく）

### 1. 単位表示の不整合修正 ✅

**問題**: テーブルヘッダーが「百万円」と表示されているのに、実際の値が円単位のまま表示されている

**修正内容**:
- `components/stage1/MetricsPanel.tsx` に新関数 `fmtJPYMillions()` を追加
- 売上高・営業利益の表示を百万円に統一
- データ保存値は円のままで、表示時のみ÷1,000,000 を実施

**変更ファイル**:
- `components/stage1/MetricsPanel.tsx` L117-127: `fmtJPYMillions()` 関数追加
- L1024-1026: メトリックカード表示で `fmtJPYMillions()` 適用
- L1050-1051: テーブル値で `fmtJPYMillions()` 適用
- L1084-1085: 「その他の指標」セクションで `fmtJPYMillions()` 適用

### 2. ROE計算ロジックの修正 ✅

**問題**: 年末自己資本を使用（簡易ROE）だが、正式ROEは平均自己資本を使用すべき

**現在の実装**:
```typescript
ROE（簡易） = 純利益 ÷ 期末自己資本
```

**修正内容**:
```typescript
ROE（正式） = 純利益 ÷ 平均自己資本（前年＋当年÷2）
ROE（簡易） = 純利益 ÷ 期末自己資本（前年データなし時）
```

**実装詳細** (`utils/valueAnalysis.ts` L559-615):
- ヘルパー関数 `getSecondLatestRow()` で前年BS を自動抽出
- 前年データが存在すれば平均自己資本で計算
- 前年データがなければ年末自己資本で計算し、メタ情報に「簡易」と記載
- メタ情報で計算根拠を明示

**計算式確認表**:
| 項目 | 値 | 定義 | 使用データ | 単位 | 値タイプ |
|------|-----|------|-----------|------|---------|
| ROE | 計算値 | 純利益 ÷ 自己資本 | FinancePLRow.netIncome, FinanceBSRow.equity | % | 正式/簡易 |

### 3. ROA計算ロジックの修正 ✅

**問題**: 年末総資産を使用（簡易ROA）だが、正式ROAは平均総資産を使用すべき

**現在の実装**:
```typescript
ROA（簡易） = 純利益 ÷ 期末総資産
```

**修正内容**:
```typescript
ROA（正式） = 純利益 ÷ 平均総資産（前年＋当年÷2）
ROA（簡易） = 純利益 ÷ 期末総資産（前年データなし時）
```

**実装詳細** (`utils/valueAnalysis.ts` L630-700):
- 前年BS データから前年の総資産を抽出
- 前年データが存在すれば平均総資産で計算
- 総資産が直接値でない場合は cash+ar+inventory+fixedAssets で近似計算
- メタ情報で計算方法（直接値 or 近似）と「簡易」「正式」を記載

### 4. D/Eレシオの定義明示化 ✅

**修正内容** (`utils/valueAnalysis.ts` L473-485):
```typescript
定義：D/E = 有利子負債 ÷ 自己資本（株主資本）
- equity: 株主資本のみを使用（純資産ではない）
- 純資産には非支配株主持分などが含まれるため、自己資本を採用
```

**計算式確認表**:
| 項目 | 値 | 定義 | 使用データ | 単位 | 値タイプ |
|------|-----|------|-----------|------|---------|
| D/E | 計算値 | 有利子負債 ÷ 自己資本 | FinanceBSRow.interestBearingDebt, .equity | 倍 | 正式 |

### 5. ROIC/WACCの計算コメント詳細化 ✅

**修正内容** (`utils/valueAnalysis.ts` L495-550):
```typescript
ROIC = NOPAT ÷ 投下資本（最新年）
- NOPAT = 営業利益 × (1 - 税率)
- 投下資本の優先順位：
  1. investedCapital（直接値）
  2. (AR + Inventory - AP) + FixedAssets（運転資本 + 固定資産）
  3. netAssets + interestBearingDebt（純資産 + 有利子負債）
- 税率：実効税率が計算できればそれを使用、なければ仮定値 30%
- 赤字企業の場合は「推定ROIC」として結果に明記
```

**計算式確認表**:
| 項目 | 値 | 定義 | 使用データ | 単位 | 値タイプ |
|------|-----|------|-----------|------|---------|
| ROIC | 計算値 | NOPAT ÷ 投下資本 | FinancePLRow.operatingIncome, FinanceBSRow各項 | % | 正式/推定 |
| WACC | 入力値 | ユーザー入力 | 入力パネル | % | 正式 |

### 6. 論点候補の根拠検証 ✅

**現状**: `utils/stage1/benchmarkIssues.ts` で生成される論点候補は基本的に財務データから直接導出可能

**確認内容**:
- `buildExternalIssueCandidates()`: 営業利益率、ROIC、資本回転率、PBR を業界中央値と比較
- IssueBlockPanel で生成される論点：営業利益率、売上CAGR、ROIC、ROIC-WACC、D/E、PBR
  
**すべての論点が以下のいずれかに該当**:
- ✅ 財務指標の業界比較（根拠明確）
- ✅ 財務指標の閾値判定（根拠明確）

**該当なし**:
- ❌ 「戦略が現場の判断基準になる状態」（推測値）
- ❌ 「KPI/OKR整合」（STAGE2以降）

### 7. 売上成長率の表現検証 ✅

**現在の実装** (`components/stage1/IssueBlockPanel.tsx` L148-155):
```typescript
if (g < 3) {
  title: '売上成長率が伸び悩んでいる'
  description: `売上CAGRが ${fmtPct(g)} と低い。伸び代の源泉...`
}
```

**修正状況**:
- 現在の実装で「g < 3」という閾値を使用（比較基準が明確）
- 表現は中立的で、閾値に基づいている
- 業界ベンチマークとの比較ロジック（benchmarkIssues.ts）も整備済み

---

## STAGE1 財務指標一覧（修正後の状態）

### 売上高
- **表示値**: 百万円
- **計算式**: 入力値 ÷ 1,000,000
- **使用データ**: FinancePLRow.revenue（保存値は円）
- **単位**: 百万円
- **値タイプ**: 入力値

### 営業利益
- **表示値**: 百万円
- **計算式**: 入力値 ÷ 1,000,000
- **使用データ**: FinancePLRow.operatingIncome（保存値は円）
- **単位**: 百万円
- **値タイプ**: 入力値

### 営業利益率
- **表示値**: %
- **計算式**: 営業利益 ÷ 売上高 × 100
- **使用データ**: FinancePLRow.operatingIncome, .revenue
- **単位**: %
- **値タイプ**: 計算値

### 売上CAGR
- **表示値**: %
- **計算式**: (最終売上 ÷ 初期売上) ^ (1/年数) - 1
- **使用データ**: FinancePLRow.revenue（売上>0の年のみ）
- **単位**: %
- **値タイプ**: 計算値

### ROIC
- **表示値**: %
- **計算式**: NOPAT ÷ 投下資本 × 100
- **使用データ**: FinancePLRow.operatingIncome, FinanceBSRow各項
- **単位**: %
- **値タイプ**: 計算値（推定の場合あり）

### WACC
- **表示値**: %
- **計算式**: ユーザー入力値
- **使用データ**: 「企業価値分析の入力」タブでのユーザー入力
- **単位**: %
- **値タイプ**: 入力値

### ROIC - WACC
- **表示値**: pt（ポイント）
- **計算式**: ROIC - WACC
- **使用データ**: 計算ROIC と 入力WACC
- **単位**: pt
- **値タイプ**: 計算値

### ROE
- **表示値**: %
- **計算式**: 純利益 ÷ 平均自己資本 × 100（前年データあり）または 純利益 ÷ 期末自己資本 × 100（前年データなし）
- **使用データ**: FinancePLRow.netIncome, FinanceBSRow.equity
- **単位**: %
- **値タイプ**: 正式 / 簡易（メタ情報で明記）

### ROA
- **表示値**: %
- **計算式**: 純利益 ÷ 平均総資産 × 100（前年データあり）または 純利益 ÷ 期末総資産 × 100（前年データなし）
- **使用データ**: FinancePLRow.netIncome, FinanceBSRow.totalAssets
- **単位**: %
- **値タイプ**: 正式 / 簡易（メタ情報で明記）

### D/Eレシオ
- **表示値**: 倍
- **計算式**: 有利子負債 ÷ 自己資本
- **使用データ**: FinanceBSRow.interestBearingDebt, .equity
- **単位**: 倍
- **値タイプ**: 正式

### PBR
- **表示値**: 倍
- **計算式**: ユーザー手入力値（上場企業向け）
- **使用データ**: 入力パネルまたは自動取得
- **単位**: 倍
- **値タイプ**: 入力値

---

## 修正ファイル一覧

| ファイル | 行数 | 変更内容 |
|---------|------|---------|
| `utils/valueAnalysis.ts` | 365-370 | `getSecondLatestRow()` ヘルパー関数追加 |
| `utils/valueAnalysis.ts` | 473-485 | D/E計算のコメント詳細化 |
| `utils/valueAnalysis.ts` | 495-550 | ROIC計算のコメント詳細化 |
| `utils/valueAnalysis.ts` | 373-407 | `computeInvestedCapital()` コメント詳細化 |
| `utils/valueAnalysis.ts` | 559-615 | `computeROEFromPLBS()` を平均自己資本対応に修正 |
| `utils/valueAnalysis.ts` | 630-700 | `computeROAFromPLBS()` を平均総資産対応に修正 |
| `components/stage1/MetricsPanel.tsx` | 117-127 | `fmtJPYMillions()` 関数追加 |
| `components/stage1/MetricsPanel.tsx` | 1024-1026 | 売上高・営業利益の表示を百万円に変更 |
| `components/stage1/MetricsPanel.tsx` | 1050-1051 | テーブルの値表示を百万円に変更 |
| `components/stage1/MetricsPanel.tsx` | 1084-1085 | 「その他の指標」の値表示を百万円に変更 |

---

## 検証方法

### ユニットテスト（実装推奨）
```typescript
// test/valueAnalysis.test.ts
describe('computeROEFromPLBS', () => {
  it('前年BSがある場合、平均自己資本で計算', () => {
    const plRows = [{ year: 2025, netIncome: 100 }];
    const bsRows = [
      { year: 2024, equity: 1000, ... },
      { year: 2025, equity: 1200, ... }
    ];
    
    const result = computeROEFromPLBS(plRows, bsRows);
    // ROE = 100 / ((1000 + 1200) / 2) * 100 = 9.09%
    expect(result.roe).toBeCloseTo(9.09, 1);
    expect(result.meta).toContain('平均自己資本');
  });
  
  it('前年BSがない場合、年末自己資本で計算', () => {
    const plRows = [{ year: 2025, netIncome: 100 }];
    const bsRows = [{ year: 2025, equity: 1200, ... }];
    
    const result = computeROEFromPLBS(plRows, bsRows);
    // ROE = 100 / 1200 * 100 = 8.33%
    expect(result.roe).toBeCloseTo(8.33, 1);
    expect(result.meta).toContain('簡易');
  });
});
```

### UI確認手順
1. `/stage1` ページでサンプル企業（日本製罐など）を選択
2. 「④ 企業価値分析」セクションで以下を確認：
   - 売上高・営業利益が百万円で表示される（カンマ区切り）
   - テーブルヘッダーと値が一致している
   - ROE・ROAのメタ情報に「簡易」「正式」の記載がある
3. 前年BS データがある企業で「簡易」表示がされていないことを確認

---

## 実装上の注意点

### 後方互換性
- FinanceBSRow に新しいフィールドを追加していない
- 既存データで `getSecondLatestRow()` が前年データを見つけられない場合、自動的に簡易計算に切り替わる

### メタ情報の活用
- `ValueAnalysis.meta.notes` 配列にすべての仮定値・近似値を記録
- UI での表示時にこれらを確認可能（デバッグモード含む）

### 赤字企業対応
- ROIC が負の場合、メタ情報に「推定ROIC」と記載
- 計算は継続するが、解釈時の注意を促す

---

## 今後の改善提案

1. **DB スキーマ拡張**（Ver 5 以降）
   - `FinanceBSRow` に `previousYearEquity`, `previousYearTotalAssets` フィールドを追加
   - より明示的な平均値管理

2. **税率の自動推定**
   - 複数年の実効税率から自動推定
   - 赤字企業の税効果処理

3. **業界別WACC デフォルト値**
   - 業種ごとの標準WACC を提案
   - ユーザーが手入力を簡略化

4. **STAGE2 連携**
   - STAGE1 の指標メタ情報を STAGE2 の北極星指標に自動反映
   - 「簡易」指標の改善提案を STAGE2 の質問に組み込み

---

**作成日**: 2026-09-26  
**実装者**: Claude Code  
**レビュー状態**: 実装完了、動作確認待機
