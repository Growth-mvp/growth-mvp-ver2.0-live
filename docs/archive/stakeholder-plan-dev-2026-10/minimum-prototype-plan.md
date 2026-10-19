# Growth MVP v2.0 - ステークホルダー別経営計画書
## 最小プロトタイプ実装計画

**目的**: 日本製罐の宮入さんに実際に動くデモを見せる  
**スコープ**: 3種類の計画書（銀行向け・株主向け・社員向け）の生成・プレビュー・PDF出力  
**実装期間**: 2-3週間（5-7営業日で初期版）  
**デプロイ**: ローカル確認のみ、本番DBへの書き込み禁止  

---

## 1. 既存資産確認と再利用方針

### 1.1 既存ファイル一覧と利用可否

#### ✅ **完全再利用可能（変更不要）**

| ファイルパス | 用途 | 再利用率 | 備考 |
|-----------|------|--------|------|
| `utils/export/buildMidtermPlanData.ts` | STAGE1-4統合データ抽出 | 100% | 共通基盤として使用 |
| `components/export/ReportLayout.tsx` | PDF共通スタイル | 100% | 3種類全て適用 |
| `utils/export/downloadPdf.ts` | HTML→PDF変換 | 100% | html2canvas + jsPDF |
| `components/export/StagePdfExportButton.tsx` | PDF出力ボタン | 100% | UIそのまま再利用 |
| `utils/supabase/strategy.ts` (getFullStrategyDataByCompany) | データ統合取得 | 100% | API統一アクセス |
| `lib/server/rbacGuard.ts` | 認証・認可 | 100% | 企業スコープ確認 |

**合計再利用可能コード**: 約60-70% （新規実装が30-40%）

#### ⚠️ **部分利用・参考程度**

| ファイルパス | 用途 | 再利用率 | 修正内容 |
|-----------|------|--------|--------|
| `components/export/MidtermPlanPreview.tsx` | プレビュー表示構造 | 50% | audience可変化・条件付きレンダリング |
| `utils/export/buildStage[1-4]ReportData.ts` | STAGE別データビルダ | 40% | audience別フィルタリング追加 |

#### ❌ **新規実装が必要**

| コンポーネント | ファイルパス | 理由 |
|------------|-----------|------|
| Audience選択ページ | `app/report/stakeholder-select/page.tsx` | 3種類の選択UI |
| Audience別計画書ページ | `app/report/[audience]-plan/page.tsx` | audience動的ルーティング |
| Audience別プレビュー | `components/export/PlanPreview.tsx` | 条件付きレンダリング |
| Audience別AI生成 | `app/api/plans/[audience]/generate` | 本文生成API |
| 検証パネル | `components/export/ValidationPanel.tsx` | 検証結果表示 |

**新規実装コンポーネント**: 5-6個

---

## 2. 最小ファイル構成（プロトタイプ）

### 2.1 新規作成ファイル（7個）

```
【ページ・ルート】
1. /app/report/stakeholder-select/page.tsx
   ├─ 銀行向け・株主向け・社員向けの3ボタン
   └─ 選択後は /report/[audience]-plan へリダイレクト

2. /app/report/[audience]-plan/page.tsx
   ├─ audience = 'bank' | 'shareholder' | 'employee'
   ├─ buildPlanData(audience) で共通データ取得
   ├─ PlanPreview で表示
   └─ PDF出力ボタン

【API】
3. /app/api/plans/[audience]/generate
   ├─ POST: 計画書データ生成
   ├─ 入力: { companyId, strategyId, audience }
   ├─ 認証: getAuthUserIdFromBearer + requireMembership
   ├─ 処理: AI本文生成（audience別プロンプト）
   └─ 出力: { sections: Section[] }

【コンポーネント】
4. /components/export/PlanPreview.tsx
   ├─ props: data, audience, sections
   ├─ audience別条件付きレンダリング
   └─ ReportLayout を継承

5. /components/export/ValidationPanel.tsx
   ├─ 検証結果表示（警告・エラー）
   └─ 不足情報リスト

【ユーティリティ】
6. /utils/export/buildPlanData.ts
   ├─ buildMidtermPlanData(state)
   ├─ filterByAudience(data, audience)
   └─ PlanData型を返却

7. /utils/export/generatePlanSections.ts (AI呼び出し)
   ├─ getAudiencePrompt(audience)
   ├─ callOpenAiForSections(data, prompt)
   └─ validateSections(sections, audience)
```

**合計新規ファイル**: 7個（軽量）

### 2.2 修正・拡張ファイル（0個）

❌ **既存ファイルの変更なし**（重要！）

- STAGE1-6の既存ページ・API は変更しない
- 既存 strategyStore への新規フィールド追加なし
- 既存 models.json への設定追加は最小限

---

## 3. 実装手順（5-7営業日想定）

### Day 1-2: 基盤構築

**1️⃣ 共通データ抽出・正規化**
- `buildPlanData.ts` を作成
- 既存 `buildMidtermPlanData()` をそのまま利用
- audience別フィルタリング関数を追加
- PlanData型を定義（TypeScript）

**2️⃣ 選択ページを実装**
- `/app/report/stakeholder-select/page.tsx`
- 3種類ボタンのシンプルUI
- リダイレクト処理

**成果**: 
- ✓ PlanData型が確定
- ✓ 選択ページが表示可能

---

### Day 3-4: AI本文生成とプレビュー

**3️⃣ API実装（計画書本文生成）**
- `/app/api/plans/[audience]/generate`
- OpenAI呼び出し（既存の generate-* パターンを踏襲）
- audience別プロンプト設計
  - 銀行向け: 「経営改善・事業計画」中心
  - 株主向け: 「成長戦略・中期経営計画」中心
  - 社員向け: 「経営方針・実行計画」中心

**4️⃣ プレビュー表示**
- `PlanPreview.tsx` を実装
- `MidtermPlanPreview.tsx` をベースに audience分岐
- ReportLayout で統一スタイル適用

**5️⃣ 検証パネル実装**
- `ValidationPanel.tsx`
- 不足情報を UI で表示
  - 「このセクションはSTAGE6未実装」
  - 「データが不足しています」

**成果**:
- ✓ 3種類の計画書がプレビュー表示可能
- ✓ AI生成本文が表示される
- ✓ 検証結果が表示される

---

### Day 5: PDF出力・ローカルテスト

**6️⃣ PDF出力**
- 既存の `downloadPdfFromElement()` を再利用
- StagePdfExportButton で PDF ダウンロード実行
- ファイル名: `GROWTH_{audience}_{companyName}_{YYYYMMDD}.pdf`

**7️⃣ テスト・確認**
- 3種類の計画書が正常生成されるか
- 他社データが見えないか（RLS確認）
- 既存ページ（STAGE1-6）が変更されていないか
- ビルド・型チェック通過

**成果**:
- ✓ 3種類のPDF出力確認
- ✓ セキュリティテスト合格
- ✓ 既存機能回帰なし

---

## 4. 最小実装での制約と明示方法

### 4.1 **不足情報を画面で明示**

#### 銀行向け計画書での表示例

```
【第5章：キャッシュフロー計画】

⚠️ 【準備中】このセクションは以下の理由で簡略表示されます：

理由:
  • STAGE6 シミュレーション機能はまだ基本実装段階
  • 月次キャッシュフロー詳細は確定していません
  • 返済スケジュール自動生成機能は実装予定

代替情報:
  • STAGE4 での期待インパクト（投資額・売上寄与）は表示します
  • CF基礎情報（現状現金・売掛金・買掛金）は表示します
  
完全版を見るには:
  → STAGE6 の完成を待つか
  → 金融機関にご提出前に直接ご相談ください
```

#### 株主向けでの表示例

```
【第5章：株主価値創造戦略】

ℹ️ 【入力待機】以下の項目が未入力のため表示されません：
  □ 配当方針・EPS目標
  □ 資本配分方針（M&A・自社株買い）
  □ ROE・ROIC改善シナリオ

→ CFO室にてご入力ください
   期限: 2024年XX月XX日
```

#### 社員向けでの表示例

```
【第4章：あなたの育成計画】

🔄 【準備中】個人OKRと育成計画は以下のタイミングで確定します：
  • 部門OKR確定: 本日
  • あなたのOKR確定: マネージャーとの1-on-1（明週予定）
  • 育成計画確定: 人事部による割当（3月末まで）

マネージャーへ: {{manager.name}} さん
連絡先: {{manager.email}}
```

### 4.2 **数値の根拠が不明な場合**

```
⚠️ データ根拠が不確定

【表示例】
売上目標: ¥300M（年度） ※計画未確定

この数値について:
  ✓ STAGE2の中計コンセプトから推定
  ✓ STAGE4プロジェクトの期待寄与を合算
  ✗ STAGE6の財務シミュレーションは未実装

検証状況:
  ◇ STAGE4インパクト ↔ STAGE6の整合性: 未検証
  ◇ 部門別売上 の二重計上チェック: 未実施
  
→ ご提出前にCFO室にてご確認ください
```

---

## 5. 安全条件チェックリスト

### 実装前確認（Day 0）

- [ ] ローカル環境が本番Supabaseに接続されていないか確認
- [ ] 既存STAGE1-6のページが変更されないルール確認
- [ ] AIに財務数値を創作させないルール確認
- [ ] 監査ログに機密本文を記録しないルール確認
- [ ] DB保存を行わない（ローカル表示のみ）ルール確認

### 実装中チェック

- [ ] getAuthUserIdFromBearer() で認証実装
- [ ] requireMembership() で企業スコープ確認
- [ ] assertMinRole() で権限確認
- [ ] RLS有効確認（Supabase client経由）
- [ ] 他社 strategyId で 403 Forbidden 確認

### 実装後確認

- [ ] 既存ページ（STAGE1-6）が変更されていない
- [ ] 既存PDF出力が動作
- [ ] 既存 strategyStore が変更されていない
- [ ] 3種類の計画書がプレビュー表示可能
- [ ] 3種類のPDF出力が可能
- [ ] 型チェック通過（npm run type-check）
- [ ] ビルド通過（npm run build）

---

## 6. 実装フロー図

```
Day 1-2: 基盤構築
  ├─ buildPlanData.ts 作成
  ├─ PlanData型定義
  └─ 選択ページ実装
         ↓
Day 3-4: AI生成・プレビュー
  ├─ API 実装 (generate-plan)
  ├─ PlanPreview.tsx 実装
  ├─ ValidationPanel.tsx 実装
  └─ audience別プロンプト設計
         ↓
Day 5: PDF・テスト
  ├─ PDF出力確認
  ├─ 3種類テスト
  └─ セキュリティ・既存機能テスト
         ↓
デモ準備完了 → 宮入さんに展開
```

---

## 7. 実装時の重要ポイント

### ⚠️ AI生成は「本文」を生成する

```typescript
❌ 間違った実装:
const sections = {
  chapter1: buildStage1ReportView().html,  // 既存PDF単なる再表示
  chapter2: buildStage2ReportView().html,
};

✅ 正しい実装:
const prompt = `
銀行向け経営計画書の第1章を作成してください。
以下のデータを使用し、改善・再建に必要な分析を記述してください：
- 企業概要：${data.companyName}, ${data.industry}
- SWOT: [${data.swot.join(', ')}]
- 経営課題: [${data.issues.map(i => i.title).join(', ')}]
...
`;

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: prompt }]
});

const generatedText = response.choices[0].message.content;
// これをセクションのbodyに入れる
```

### ⚠️ 数値は創作しない

```typescript
❌ 間違った例:
// AIに売上予測を任せる
const cfPrompt = `キャッシュフロー計画を作成してください`;
const cf = await generateWithAI(cfPrompt);
// → AIが架空の数値を生成する可能性

✅ 正しい実装:
// 既存データのみを使用
const projectionData = {
  baselineSales: data.stage4.impactRevenueMJPY || null,  // null可
  investmentAmount: data.stage4.impactInvestmentMJPY || null,
  stage6Forecast: data.stage6?.yearlyPL || null
};

if (!projectionData.baselineSales) {
  sections.push({
    title: 'CF計画',
    status: 'incomplete',
    reason: 'STAGE6実装待機中'
  });
} else {
  // 既存データのみで文章化
  const cfText = formatCashFlowText(projectionData);
}
```

### ⚠️ 不足情報を明示する

```typescript
type Section = {
  title: string;
  body?: string;
  status: 'complete' | 'incomplete' | 'pending';
  missingReason?: string;
  missingFields?: string[];
  nextAction?: string;
  estimatedDate?: string;
};

// 実装例
const validateSection = (audience, data, sectionKey) => {
  const requirements = {
    bank: {
      chapter5_cf: ['stage6Data', 'monthlyProjection'],
      chapter6_repay: ['borrowingSchedule', 'debtServiceRatio']
    },
    shareholder: {
      chapter5_shareholder: ['dividendPolicy', 'epsTarget']
    },
    employee: {
      chapter4_okr: ['cascadeOkr', 'personalTarget']
    }
  }[audience][sectionKey];

  const missing = requirements?.filter(req => !data[req]) || [];
  
  if (missing.length > 0) {
    return {
      status: 'incomplete',
      missingFields: missing,
      missingReason: `以下のデータが未入力: ${missing.join(', ')}`
    };
  }
  
  return { status: 'complete' };
};
```

---

## 8. 期待される成果物

### デモ画面

```
1. 選択画面
   ┌─────────────────────────────┐
   │ ステークホルダー別計画書    │
   │                             │
   │ [銀行向け計画書]            │
   │ [株主向け計画書]            │
   │ [社員向け計画書]            │
   └─────────────────────────────┘

2. 銀行向けプレビュー
   ┌─────────────────────────────┐
   │ 経営改善・事業計画書        │
   │ 【表紙】                    │
   │ 【第1章】経営課題の分析    │
   │ 【第2章】改善戦略          │
   │ 【第3章】実行計画          │
   │ ...                         │
   │ [PDFダウンロード]          │
   └─────────────────────────────┘

3. 検証パネル
   ⚠️ 警告:
   • STAGE6未実装: CF計画は準備中
   • 配当政策: 未入力
   
   ℹ️ 情報:
   • 銀行向けの返済計画は別途確認してください

4. PDF出力
   ファイル: GROWTH_bank_CompanyName_20241018.pdf
```

---

## 9. 今後の拡張（次フェーズ）

実装しない（プロトタイプ対象外）：
- [ ] 承認ワークフロー、CFO署名
- [ ] Word/Excel出力
- [ ] Slack共有
- [ ] 個人別OKR生成
- [ ] 100ページ超最適化
- [ ] DB保存・版管理
- [ ] 返済計画シミュレーション

---

**準備完了状態**: 宮入さんにデモ展開可能なプロトタイプを2-3週間で完成させる

