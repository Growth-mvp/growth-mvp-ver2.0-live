# 経営計画書生成機能 - データ連携・数値整合性調査報告書

**調査期間**: 2026-10-19  
**調査対象**: 銀行向け経営計画書生成API（audience=bank）  
**実施者**: Claude Code / 静的コード解析  
**ステータス**: 報告中（実装変更なし）

---

## A. 調査結果の要約

### P0: 根本原因（信頼性に直結）

#### P0-1: `dbRowToStrategyData()` の不完全な変換
- **影響範囲**: API側での全ステージのデータ復元
- **重大度**: 最大（フロントエンド↔API間で データ完全性が不一致）
- **詳細**: route.ts L425-465 の `dbRowToStrategyData()` が以下フィールドを抽出していない
  - STAGE1: `financePL`, `financeBS`, `segmentPL`, `segmentBS`, `csvFinanceData`
  - STAGE2: `companyTargets`, `midtermStrategy`
  - STAGE5/6: `financeSummary`, `projectTargetImpacts`

#### P0-2: `extractNorthStarRevenue()` での目標と施策効果の混同
- **影響範囲**: 北極星収益目標の算出ロジック（計画書全体の信頼性）
- **重大度**: 最大（ビジネスロジックエラー）
- **詳細**: buildPlanData.ts L316-339
  - STAGE4の施策期待効果合計（impactRevenueMJPY）を単純合計
  - 正式な全社目標（STAGE2: companyTargets）と混同
  - 丹青社例: 施策効果 (120+90+10+250+18)M が正式目標488Mとして記載

---

### P1: 重要情報の欠落

#### P1-1: STAGE1の財務実績が計画書に出力されない
- **原因ファイル**: 
  - route.ts L463（simulationResult のみ抽出、financeSummary なし）
  - buildPlanData.ts L287-300 formatFinancialSummary()
- **失われるデータ**:
  - 過去5年の売上・営業利益・営業利益率
  - ROIC、CAGR などの指標
  - セグメント別PL・BS
- **計画書への影響**: 「現状分析」セクションが「データなし」のみになる

#### P1-2: STAGE2の正式な数値目標が取得されていない
- **原因ファイル**: route.ts L425-465（companyTargets 未抽出）
- **失われるデータ**:
  - 売上目標、営業利益率目標等の正式な全社目標
  - 目標の期限、単位、根拠
- **計画書への影響**: 
  - "北極星収益目標"が施策効果合計に置き換わる（P0）
  - 正式な全社目標が計画書に記載されない

#### P1-3: STAGE4の実行計画情報が部分的に欠落
- **原因ファイル**: buildPlanData.ts L211-230 projectImpacts 抽出
- **抽出される項目**: title, impactRevenueMJPY, impactOpIncomeMJPY, impactInvestmentMJPY, impactConfidence のみ
- **削除される項目**:
  - `ownerName`（責任者）
  - `impactRationale`（根拠・計算前提）
  - `planStatus`（draft/review/approved）
  - `skillPlans`、`executionHumanInvestments`（人的投資）
  - `okrsV2`、`kpis`（KPI・実行指標）
  - `planMilestones`（マイルストーン・期限）
- **計画書への影響**: プロンプトに含まれる項目（buildAudiencePrompt L586-590）が限定的
  - 「誰が」責任を持つのか不明確
  - 「何を指標に」進捗を測るのか不明確
  - 実行体制や期限が記載されない

#### P1-4: STAGE6の年度別財務計画が利用されていない
- **原因ファイル**: route.ts L463（simulationResult のみ、financeSummary なし）
- **失われるデータ**:
  - 年度別売上・営業利益予測
  - 月次CF計画（銀行向けでは返済可能性判断に必須）
  - シミュレーション結果の不確実性や前提条件
- **計画書への影響**: 
  - 「財務計画」「返済可能性」セクションが根拠数値を失う

#### P1-5: 複数シミュレーション結果が存在する場合の区別不可
- **原因ファイル**: route.ts L463
  ```typescript
  simulationResult: row.simulation_results 
    ? (Array.isArray(row.simulation_results) ? row.simulation_results[0] : row.simulation_results) 
    : null
  ```
- **問題**: 最初の1件のみ取得。複数シミュレーションが保存されている場合、どれを採用するか不明確
- **計画書への影響**: 試案中の数値と確定数値が混在する可能性

---

### P2: 表現・表示・補足情報の不足

#### P2-1: 件数制限による重要施策の欠落
- **原因ファイル**: buildPlanData.ts L234
  ```typescript
  projectImpacts: projectImpacts.slice(0, 20)
  ```
- **問題**: 20件以上の施策がある場合、後続施策が計画書に含まれない
- **計画書への影響**: 重要な後発施策が見落とされるリスク（P2）

#### P2-2: valueAnalysis が DB に存在しない
- **原因ファイル**: buildPlanData.ts L290-295 formatFinancialSummary()
  ```typescript
  if ((state as any)?.valueAnalysis?.operatingMarginPctLatest !== undefined)
  ```
- **問題**: 計算結果（valueAnalysis）を直接参照しているが、DB には保存されていない
- **計画書への影響**: 営業利益率、ROIC が常に「データなし」になる

---

## B. データマッピング表

| STAGE | データ項目 | DB保存先 | 復元処理 | PlanData | AIプロンプト | 現在の判定 |
|---|---|---|---|---|---|---|
| **1** | financePL | finance_pl | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **1** | financeBS | finance_bs | 存在なし | × | × | **実装未確認** |
| **1** | segmentPL | csv_finance_data | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **1** | segmentBS | csv_finance_data | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **1** | csvFinanceData | csv_finance_data | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **1** | valueAnalysis | 存在なし（計算結果） | N/A | buildPlanData（失敗） | × | **実装未確認** |
| **1** | stage1Issues | stage1_issues | buildStateFromDbRow ✓ | buildPlanData ✓ | ✓ | 利用できている |
| **2** | companyTargets | company_targets | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **2** | midtermStrategy | swot_suggestions | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **2** | finalStory | final_story | buildStateFromDbRow ✓ | buildPlanData ✓ | ✓ | 利用できている |
| **3** | departments | departments | buildStateFromDbRow ✓ | buildPlanData ✓ | ✓ | 利用できている |
| **3** | projects（基本） | departments[]projects | buildStateFromDbRow ✓ | buildPlanData ✓ | ✓ | 利用できている |
| **4** | projects.impactRevenueMJPY | departments[]projects | buildStateFromDbRow ✓ | buildPlanData ✓ | ✓ | 利用できている |
| **4** | projects.ownerName | departments[]projects | buildStateFromDbRow ✓ | buildPlanData × | × | **途中で欠落** |
| **4** | projects.impactRationale | departments[]projects | buildStateFromDbRow ✓ | buildPlanData × | × | **途中で欠落** |
| **4** | projects.planStatus | departments[]projects | buildStateFromDbRow ✓ | buildPlanData × | × | **途中で欠落** |
| **4** | projects.okrsV2/kpis | departments[]projects | buildStateFromDbRow ✓ | buildPlanData × | × | **途中で欠落** |
| **4** | projects.skillPlans | departments[]projects | buildStateFromDbRow ✓ | buildPlanData × | × | **途中で欠落** |
| **5/6** | simulationResults | simulation_results | buildStateFromDbRow ✓（配列） | buildPlanData ✓（最初の1件のみ） | × | **部分的に欠落** |
| **5/6** | financeSummary | finance_summary | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |
| **5/6** | projectTargetImpacts | project_target_impacts | buildStateFromDbRow ✓ | buildPlanData × | × | **そもそも未取得** |

**凡例**:
- ✓: 正しく処理されている
- ×: 処理されていない
- 利用できている: データが計画書に含まれる
- 途中で欠落: DB/復元まではOK、buildPlanData か buildAudiencePrompt で削除
- そもそも未取得: dbRowToStrategyData で抽出されていない

---

## C. 問題ごとの原因（詳細）

### 問題1: STAGE1財務実績が計画書に出ない

**現象**: 
- 過去5年の財務実績（売上、営業利益、営業利益率、ROIC）が計画書に出力されない
- formatFinancialSummary() が常に「データなし」を返す

**原因の流れ**:

1. **DB層**: 
   - financePL, csvFinanceData は strategy_data の JSONB カラムに保存されている
   - 復元関数（buildStateFromDbRow）は FIELD_MAP 経由で完全に復元可能

2. **API層（dbRowToStrategyData）**:
   - route.ts L425-465 の dbRowToStrategyData() が **financePL, csvFinanceData を抽出していない**
   - ```typescript
     // 抽出されている項目（L441-451）
     industry: row.industry,
     employees: row.employees,
     revenue: row.revenue,
     strength: row.strength,
     // ... etc
     
     // 抽出されていない項目
     // financePL, financeBS, csvFinanceData, businessSegments は row から取得していない
     ```

3. **buildPlanData層**:
   - L287-300 formatFinancialSummary() で valueAnalysis を参照
   - ```typescript
     if ((state as any)?.valueAnalysis?.operatingMarginPctLatest !== undefined)
     ```
   - 但し state（dbRowToStrategyData の返値）に valueAnalysis は存在しない
   - 結果: finances = [] のため "データなし" を返す

4. **プロンプト層**:
   - buildAudiencePrompt() L559 で keyFinances が「データなし」で固定
   - 銀行向けプロンプトに現状分析数値が含まれない

**関連ファイル・行番号**:
- route.ts L425-465: dbRowToStrategyData 関数（**欠落のソース**）
- buildPlanData.ts L140: stage1.keyFinances = formatFinancialSummary(state)
- buildPlanData.ts L287-300: formatFinancialSummary 関数
- buildAudiencePrompt() L559: 「業種」と「経営課題」のみ

**影響範囲**: 計画書全体の「現状分析」信頼性

---

### 問題2: 北極星目標が施策効果に置き換わる（最も危険）

**現象**:
- 建企画書に記載される「北極星収益目標」が STAGE4 施策効果合計に置き換わる
- 丹青社例: 施策効果 120M+90M+10M+250M+18M = 488M が「目標」として記載

**原因の流れ**:

1. **設計意図**:
   - 「北極星目標」= STAGE2 で経営陣が定めた正式な全社目標（companyTargets）
   - 「施策効果」= STAGE4 プロジェクトの期待インパクト（impactRevenueMJPY）
   - 本来は **異なるデータ** （混同してはいけない）

2. **extractNorthStarRevenue() の実装**:
   - buildPlanData.ts L316-329
   - ```typescript
     let totalImpact = 0;
     projectImpacts.forEach((p) => {
       const impact = p.impactRevenue?.replace(/[¥M]/g, '');
       if (impact && !isNaN(parseFloat(impact))) {
         totalImpact += parseFloat(impact);
       }
     });
     
     if (totalImpact > 0) return `¥${totalImpact.toFixed(0)}M`;  // ← 施策効果を目標として返す
     ```

3. **fallback ロジック**:
   - L332-336: companyTargets から売上目標を探すが、**companyTargets が state に存在しないため常にスキップ**
   - ```typescript
     if (Array.isArray((state as any)?.companyTargets)) {
       // ← state に companyTargets がないので、この分岐は実行されない
     }
     ```

4. **根本原因**:
   - dbRowToStrategyData() で companyTargets を抽出していない（route.ts L425-465）
   - 結果: extractNorthStarRevenue() は常に施策効果合計を目標として返す

**関連ファイル・行番号**:
- route.ts L425-465: dbRowToStrategyData（**companyTargets 未抽出**）
- buildPlanData.ts L316-340: extractNorthStarRevenue（**ロジックエラー**）
- buildAudiencePrompt() L595: 「北極星収益目標」として使用

**影響範囲**: 
- 計画書全体の信頼性（P0）
- 金融機関の意思決定（返済可能性判断）

---

### 問題3: STAGE4の責任者・KPI・期限が計画書に記載されない

**現象**:
- STAGE4で入力した「責任者」「KPI」「マイルストーン」「根拠」が計画書に含まれない
- プロンプトに渡される項目は title, impactRevenue, impactOpIncome, impactInvestment のみ

**原因の流れ**:

1. **DB/復元層**:
   - departments[].projects[] に以下フィールドが保存されている（types.ts より）：
     - ownerName, impactRationale, planStatus, okrsV2, kpis, skillPlans, etc.
   - buildStateFromDbRow() で departments は完全に復元される

2. **buildPlanData 層**:
   - L211-230 projectImpacts を抽出する際、以下のみを含める：
   - ```typescript
     projectImpacts.push({
       title: proj?.title,
       impactRevenue: proj?.impactRevenueMJPY ? `¥${proj.impactRevenueMJPY}M` : undefined,
       impactOpIncome: proj?.impactOpIncomeMJPY ? ... ,
       impactInvestment: proj?.impactInvestmentMJPY ? ... ,
       confidence: proj?.impactConfidence,
     });
     // ownerName, kpis, planStatus, skillPlans は **意図的に削除**
     ```

3. **buildAudiencePrompt 層**:
   - L586-590: planData.stage4.projectImpacts から項目を選択
   - ```typescript
     `施策: ${p.title}
      売上寄与: ${p.impactRevenue || '未定'}
      営業利益寄与: ${p.impactOpIncome || '未定'}
      投資額: ${p.impactInvestment || '未定'}`
     ```
   - 責任者、KPI、期限は含まれない

**関連ファイル・行番号**:
- buildPlanData.ts L211-235: projectImpacts 抽出（**意図的にフィルタリング**）
- buildAudiencePrompt() L586-590: プロンプト構築

**影響範囲**:
- 計画書の「実行管理体制」「重要指標」セクションが欠落（P1）
- 銀行が実行可能性を判定できない

**設計判断？**:
- (不明確) わざと削除しているのか、将来の拡張の予定か不明

---

### 問題4: STAGE6の年度別財務計画が利用されていない

**現象**:
- STAGE6で生成した年度別売上・営業利益予測が計画書に含まれない
- 銀行向け計画書で「返済可能性」の根拠となるCF計画が欠落

**原因の流れ**:

1. **DB/復存層**:
   - simulationResults: `simulation_results` (JSONB array)
   - financeSummary: `finance_summary` (JSONB)
   - 両方とも strategy_data に保存されている

2. **dbRowToStrategyData 層**:
   - L463: simulationResult のみ復元（最初の1件のみ）
   - ```typescript
     simulationResult: row.simulation_results 
       ? (Array.isArray(row.simulation_results) ? row.simulation_results[0] : row.simulation_results) 
       : null
     ```
   - **financeSummary は一切抽出されていない**

3. **buildPlanData 層**:
   - L242: evaluateProjectionCompleteness() で financeSummary の有無をチェック
   - ```typescript
     const hasProjection = (state as any)?.financeSummary?.length > 0;
     ```
   - state に financeSummary が存在しないため常に false

4. **プロンプト層**:
   - L596-598: projectionStatus = "incomplete" となり、備考に「財務予測: 準備中」
   - 年度別数値がプロンプトに含まれない

**関連ファイル・行番号**:
- route.ts L463: dbRowToStrategyData（**financeSummary 未抽出**）
- buildPlanData.ts L361-383: evaluateProjectionCompleteness
- buildAudiencePrompt() L596-598

**影響範囲**:
- 「財務計画」「返済可能性」セクションが根拠数値を失う（P1）
- 銀行の融資判定ができない可能性

**追加問題**:
- simulation_results が複数存在する場合、最初の1件のみ取得
- どれが「確定」でどれが「試案」かを区別できない

---

## D. 最小限の修正案（段階的）

### 段階1: dbRowToStrategyData() の完全化（必須・高優先度）

**目的**: API側での DB データ復元の完全性を確保

**修正内容**:

```typescript
// route.ts L425-465 の dbRowToStrategyData()を以下のように拡張

function dbRowToStrategyData(row: any): Record<string, any> | null {
  if (!row) return null;

  return {
    // 現在の項目（L429-464）+ 以下を追加：
    
    // STAGE1：財務データ
    financePL: Array.isArray(row.finance_pl) ? row.finance_pl : undefined,
    csvFinanceData: (row.csv_finance_data && typeof row.csv_finance_data === 'object') 
      ? row.csv_finance_data 
      : undefined,
    businessSegments: Array.isArray(row.business_segments) 
      ? row.business_segments 
      : undefined,
    
    // STAGE2：全社目標・戦略
    companyTargets: Array.isArray(row.company_targets) 
      ? row.company_targets 
      : undefined,
    // midtermStrategy は swot_suggestions 内に埋め込まれているため、
    // normalize.ts と同様に展開する必要がある
    midtermStrategy: row.swot_suggestions?.midtermStrategy 
      ? row.swot_suggestions.midtermStrategy 
      : undefined,
    
    // STAGE5/6：財務シミュレーション
    financeSummary: Array.isArray(row.finance_summary) 
      ? row.finance_summary 
      : undefined,
    projectTargetImpacts: Array.isArray(row.project_target_impacts)
      ? row.project_target_impacts
      : undefined,
  };
}
```

**影響**: 
- データ復元がフロントエンドと同等になる
- buildPlanData() に完全なデータが到達

**関連フィールド確認**:
- すべて FIELD_MAP (strategy.ts L509-565) に定義されている
- DB カラム存在確認: finance_pl, csv_finance_data, business_segments, company_targets, finance_summary, project_target_impacts が実装済み

**テスト対象**:
- DBから正しく読み込まれるか（console.log で確認）
- buildPlanData の入力が変わるか

---

### 段階2: extractNorthStarRevenue() ロジックの修正（必須・高優先度）

**目的**: STAGE2の正式目標と STAGE4の施策効果を区別

**修正内容**:

```typescript
// buildPlanData.ts L316-340 を以下のように修正

function extractNorthStarRevenue(
  state: Partial<StrategyData>,
  projectImpacts: any[]
): string | undefined {
  // ★ 優先度1: STAGE2の正式目標を最優先に取得
  if (Array.isArray((state as any)?.companyTargets)) {
    // 「売上」と明記された目標を探す
    const salesTarget = (state as any).companyTargets.find(
      (t: any) => t?.label?.includes('売上') || t?.label?.includes('Revenue')
    );
    if (salesTarget?.base && typeof salesTarget.base === 'string') {
      // 数値が含まれているか確認
      const numMatch = salesTarget.base.match(/[\d.]+/);
      if (numMatch) {
        return `${salesTarget.base}${salesTarget.unit || ''}`;
      }
    }
  }

  // ★ 優先度2: STAGE6のシミュレーション結果から推定年度売上を取得
  if ((state as any)?.simulationResult?.projection?.points?.length > 0) {
    const points = (state as any).simulationResult.projection.points;
    // 最終年度の売上を取得
    const lastPoint = points[points.length - 1];
    if (lastPoint?.revenue && typeof lastPoint.revenue === 'number') {
      // 百万円単位に正規化
      const mjpy = lastPoint.revenue > 1000 ? lastPoint.revenue / 100 : lastPoint.revenue;
      return `¥${mjpy.toFixed(0)}M（計画年度末）`;
    }
  }

  // ★ 優先度3: STAGE4の施策効果は「参考」に降格
  // （ただし、STAGE2・STAGE6がない場合の補足情報として使用）
  let totalImpact = 0;
  projectImpacts.forEach((p) => {
    const impact = p.impactRevenue?.replace(/[¥M]/g, '');
    if (impact && !isNaN(parseFloat(impact))) {
      totalImpact += parseFloat(impact);
    }
  });

  if (totalImpact > 0) {
    return `¥${totalImpact.toFixed(0)}M（施策期待効果の合計・参考値）`;
  }

  return undefined;
}
```

**差分**:
- 優先度を明確化：①STAGE2目標 > ②STAGE6計画 > ③STAGE4参考値
- 施策効果は「参考」と明記
- 正式目標がない場合の fallback のみ施策効果を使用

**プロンプト への反映**:
- buildAudiencePrompt() L595 で「北極星収益目標」の説明を修正
- ```
  北極星収益目標: ${planData.stage56.northStarRevenue}
  ※ 【注】施策期待効果が含まれる場合、参考値として扱ってください
  ```

**テスト対象**:
- STAGE2目標がある場合：STAGE2目標を優先に取得
- STAGE6シミュレーション結果がある場合：計画値を取得
- 両方ない場合：施策効果を「参考」として記載

---

### 段階3: STAGE4情報の完全抽出（高優先度）

**目的**: 責任者・KPI・期限・根拠を計画書に含める

**修正内容**:

```typescript
// buildPlanData.ts L211-230 を以下のように拡張

const projectImpacts: any[] = [];
departments.forEach((dept: Department) => {
  if (Array.isArray(dept?.projects)) {
    dept.projects.forEach((proj: Project) => {
      projectImpacts.push({
        title: proj?.title,
        impactRevenue: proj?.impactRevenueMJPY
          ? `¥${proj.impactRevenueMJPY}M`
          : undefined,
        impactOpIncome: proj?.impactOpIncomeMJPY
          ? `¥${proj.impactOpIncomeMJPY}M`
          : undefined,
        impactInvestment: proj?.impactInvestmentMJPY
          ? `¥${proj.impactInvestmentMJPY}M`
          : undefined,
        confidence: proj?.impactConfidence,
        
        // ★ 追加フィールド
        ownerName: proj?.ownerName || undefined,
        impactRationale: proj?.impactRationale || undefined,
        planStatus: proj?.planStatus || 'draft',
        // KPIは okrsV2 または kpis から取得
        kpis: Array.isArray(proj?.okrsV2)
          ? proj.okrsV2.map((kr: any) => kr?.label || kr?.objective).filter(Boolean)
          : Array.isArray(proj?.kpis) ? proj.kpis : undefined,
        // マイルストーン（期限）を抽出
        milestones: Array.isArray(proj?.planMilestones)
          ? proj.planMilestones.map((m: any) => ({
              title: m?.title,
              dueYm: m?.dueYm,
            }))
          : undefined,
      });
    });
  }
});

const stage4 = {
  companyThemes: stage2.priorityThemes,
  projectImpacts: projectImpacts.slice(0, 20), // 件数制限は維持（または拡張）
};
```

**プロンプト反映**:
- buildAudiencePrompt() L586-590 を拡張
- ```
  施策: ${p.title}
  責任者: ${p.ownerName || '未定'}
  売上寄与: ${p.impactRevenue || '未定'}
  営業利益寄与: ${p.impactOpIncome || '未定'}
  投資額: ${p.impactInvestment || '未定'}
  承認状態: ${p.planStatus}
  ${p.kpis?.length ? `KPI: ${p.kpis.join(', ')}` : ''}
  ${p.impactRationale ? `根拠: ${p.impactRationale}` : ''}
  ${p.milestones?.length ? `期限: ${p.milestones.map(m => m.title).join(', ')}` : ''}
  ```

**テスト対象**:
- 責任者が正しく表示されるか
- KPIが計画書に含まれるか
- 承認状態（draft/review/approved）が表示されるか

---

### 段階4: STAGE6データの完全活用（中優先度）

**目的**: 年度別財務計画を計画書に含める

**修正内容**:

```typescript
// buildPlanData.ts の extractNorthStarMetrics() を拡張

function extractNorthStarMetrics(
  state: Partial<StrategyData>
): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];

  // ★ 優先度1: STAGE6シミュレーション結果から年度別指標を抽出
  if ((state as any)?.simulationResult?.projection?.points?.length > 0) {
    const points = (state as any).simulationResult.projection.points;
    const lastPoint = points[points.length - 1];
    
    if (lastPoint) {
      if (lastPoint.revenue) {
        metrics.push({
          label: '計画年度末売上',
          value: `¥${(lastPoint.revenue > 1000 ? lastPoint.revenue / 100 : lastPoint.revenue).toFixed(0)}M`,
        });
      }
      if (lastPoint.operatingIncome) {
        metrics.push({
          label: '計画年度末営業利益',
          value: `¥${(lastPoint.operatingIncome > 1000 ? lastPoint.operatingIncome / 100 : lastPoint.operatingIncome).toFixed(0)}M`,
        });
      }
      if (lastPoint.operatingMargin) {
        metrics.push({
          label: '計画年度末営業利益率',
          value: `${(lastPoint.operatingMargin * 100).toFixed(1)}%`,
        });
      }
    }
  }

  // ★ 優先度2: STAGE2の companyTargets（正式目標）
  if (Array.isArray((state as any)?.companyTargets)) {
    (state as any).companyTargets.slice(0, 5).forEach((t: any) => {
      if (t?.label && t?.base) {
        metrics.push({
          label: t.label,
          value: `${t.base}${t.unit || ''}`,
        });
      }
    });
  }

  return metrics;
}

// 同時に evaluateProjectionCompleteness() を更新
function evaluateProjectionCompleteness(
  state: Partial<StrategyData>,
  audience: AudienceType
): 'complete' | 'partial' | 'incomplete' {
  const hasStage6 = !!(state as any)?.simulationResult?.projection?.points?.length > 0;
  const hasProjection = (state as any)?.financeSummary?.length > 0;

  if (audience === 'bank') {
    if (hasStage6 && hasProjection) return 'complete';
    if (hasStage6 || hasProjection) return 'partial';
    return 'incomplete';
  }

  // ... etc
}
```

**テスト対象**:
- STAGE6のシミュレーション結果が正しく抽出されるか
- 年度別売上・営業利益が計画書に含まれるか

---

### 段階5: 件数制限の合理化（低優先度）

**目的**: 20件以上の施策がある場合の対応

**修正内容**: buildPlanData.ts L234
```typescript
// 案1: 件数を増やす（30件に拡張）
projectImpacts: projectImpacts.slice(0, 30),

// 案2: 件数制限を撤廃（全施策を含める）
projectImpacts: projectImpacts,

// 案3: 優先度で選別（impactConfidence が高い順）
projectImpacts: projectImpacts
  .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
  .slice(0, 20),
```

**推奨**: 案3（優先度で選別）

**テスト対象**:
- 30件以上の施策がある場合、重要度の高い施策が優先されるか

---

## E. 追加で必要な情報

### E-1: DB の実装確認が必要な項目

以下のカラムが実装されているか、読み取り専用で確認が必要です：

```sql
-- Supabase console または psql で確認可能
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'strategy_data'
  AND column_name IN (
    'finance_pl',
    'finance_bs', -- 未実装の可能性
    'csv_finance_data',
    'company_targets',
    'finance_summary',
    'project_target_impacts',
    'okr_target_scores'
  );
```

**確認結果**（静的解析から）:
- `finance_pl`: ✓ FIELD_MAP に存在（L533）
- `csv_finance_data`: ✓ FIELD_MAP に存在（L532）
- `company_targets`: ✓ FIELD_MAP に存在（L554）
- `finance_summary`: ✓ FIELD_MAP に存在（L563）
- `project_target_impacts`: ✓ FIELD_MAP に存在（L556）
- `finance_bs`: ✗ FIELD_MAP に存在しない（未実装）

### E-2: 単位の正規化ルール

以下の単位正規化が既に実装されているか確認:

```typescript
// strategy.ts L798-801 より
// 「百万円で保存されたデータを yen に変換」の処理
if (financePL.revenue < 1000 && financePL.revenue > 0) {
  // 百万円と判定して × 100万 に変換する処理
}
```

**確認事項**:
- 年度別売上の単位（億円か百万円か）が統一されているか
- STAGE1/STAGE4/STAGE6で単位が混在していないか

### E-3: シミュレーション結果の複数管理

`simulation_results` が複数個存在する場合の選別ルール：

```typescript
// 現在: 最初の1件のみ取得
// 改善案: 以下のロジックを実装
if (Array.isArray(row.simulation_results)) {
  // 日付の最新のものを取得、または
  // status='confirmed' のものを取得
  simulationResult = row.simulation_results
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}
```

**確認事項**:
- simulation_results に `created_at`, `status`, `scenario` などのメタデータがあるか
- 「確定」vs「試案」を区別するフィールドが存在するか

---

## 結論と推奨事項

### 実装優先度

1. **段階1（必須）**: dbRowToStrategyData() の完全化
   - 実装量: 小（10行程度の追加）
   - リスク: 低
   - 効果: 大（全ステージのデータ欠落が解決）

2. **段階2（必須）**: extractNorthStarRevenue() の修正
   - 実装量: 中（30行程度の修正）
   - リスク: 中（優先度ロジックが複雑）
   - 効果: 大（最も危険な混同が解決）

3. **段階3（高優先度）**: STAGE4情報の完全抽出
   - 実装量: 小（10行程度の追加）
   - リスク: 低
   - 効果: 中（責任者・KPI が計画書に含まれる）

4. **段階4（中優先度）**: STAGE6の完全活用
   - 実装量: 中
   - リスク: 中（日付・単位の正規化が必要）
   - 効果: 中

5. **段階5（低優先度）**: 件数制限の合理化
   - 実装量: 小
   - リスク: 低
   - 効果: 小

### テスト戦略

修正後は以下のテストを実施：

1. **静的テスト**:
   - API応答の構造確認
   - console.log で dbRowToStrategyData() の出力確認

2. **機能テスト**:
   - 銀行向け計画書プレビューで全セクションが正しく生成されるか
   - 数値が正しく集計されているか（重複なし）

3. **比較テスト**:
   - フロントエンド (Zustand ストア) と API 側の buildPlanData() 出力を比較
   - 同じ会社 ID で両経路の計画書を生成し、内容が一致するか検証

### リスク評価

**低リスク**:
- 段階1: 既存カラムの追加取得のみ

**中リスク**:
- 段階2: 優先度ロジックの変更により、他のaudienceタイプ（shareholder, employee）の出力も変わる可能性
- 段階4: 年度別データの単位が不明確な場合、誤った数値が計画書に含まれるリスク

**修正前の確認**:
- 本番DB への直接アクセスなしで、テスト環境でのみ実装検証

---

## git status（コード変更なし）

```
git status --short
```

**結果**: 実装変更なし、調査のみ完了
