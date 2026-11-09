/* 既存STAGE4草案（app/api/stage4/generate-execution-draft/route.ts）のプロンプトの複製。比較評価専用。
 * route の関数は非公開で、インポートすると OpenAI クライアントの初期化で落ちるため、文面を複製している。
 * テンプレート文字列は route.ts と文字単位で一致させ、legacyPrompt.test.ts が両者を比較する。
 * 変数名（projectInfo）も本番に合わせている。現在日時だけは引数から受け取る（評価の再現性のため）。 */
import { companyContextSection, REASONING_OUTPUT_FIELDS, REASONING_RULES } from '@/lib/stage4/draftPromptSections';
import type { ExecutionCompanyContext } from '@/lib/stage4/companyContext';

export type LegacyRequestBody = {
  aiProvisionalKpis?: string[];
  departmentName: string;
  projectTitle: string;
  hypothesis: string;
  rationale: string;
  reason: string;
  kind: string;
  mainLever: string;
  horizon: string;
  role: string;
  due: string;
  ownerName: string;
  sourceKpis: string[];
  companyStrategy: string;
  companyTargets: unknown[];
  companyContext: ExecutionCompanyContext;
};

/** 本番と同じ「現在日」を与えるための引数（評価の再現性のため） */
export type LegacyNow = { year: number; month: number; day: number };

export function buildLegacyDraftPrompt(projectInfo: LegacyRequestBody, now: LegacyNow): string {
  const currentYear = now.year;
  const currentMonth = now.month;
  const currentDay = now.day;
  const currentYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const currentDateStr = `${currentYear}年${currentMonth}月${currentDay}日`;

  // 期限の目安を計算：現在月から3〜6ヶ月後の範囲
  const kpiDueMonthsFrom = 3;
  const kpiDueMonthsTo = 6;
  const stepDueMonthsFrom = 1;
  const stepDueMonthsTo = 3;

  const getMonthAfter = (months: number): string => {
    let m = currentMonth + months;
    let y = currentYear;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  const kpiDueLowerBound = getMonthAfter(kpiDueMonthsFrom);
  const kpiDueUpperBound = getMonthAfter(kpiDueMonthsTo);
  const stepDueLowerBound = getMonthAfter(stepDueMonthsFrom);
  const stepDueUpperBound = getMonthAfter(stepDueMonthsTo);

  // ★ STAGE3由来の固定KPI をプロンプトに明記（AIが変更しない）
  const sourceKpisText = Array.isArray(projectInfo.sourceKpis) && projectInfo.sourceKpis.length > 0
    ? `【既存のKPI（変更不可）】\n${projectInfo.sourceKpis.map((kpi, idx) => `${idx + 1}. ${kpi}`).join('\n')}\n\n★重要★ 上記のKPI名は絶対に変更・追加・削除しないでください。`
    : '【既存のKPI】未設定のため、AIで補完してください。';
  const aiKpisText = Array.isArray(projectInfo.aiProvisionalKpis) && projectInfo.aiProvisionalKpis.length > 0
    ? `\n\n【以前にAIが仮に置いた目標（確定ではない。書き直してよい）】\n${projectInfo.aiProvisionalKpis.map((kpi, idx) => `${idx + 1}. ${kpi}`).join('\n')}`
    : '';

  // プロジェクト情報をプロンプトに組み込む
  const projectContext = `
【プロジェクト情報】
- プロジェクト名: ${projectInfo.projectTitle}
- 部門: ${projectInfo.departmentName || '—'}
- 仮説: ${projectInfo.hypothesis || '—'}
- 理由: ${projectInfo.rationale || projectInfo.reason || '—'}
- 改革のポイント: ${projectInfo.mainLever || '—'}
- 成長ポイント（kind）: ${projectInfo.kind || '—'}
- タイムホライズン: ${projectInfo.horizon || '—'}
- 期限: ${projectInfo.due || '—'}
- オーナー: ${projectInfo.ownerName || '—'}
- 役割（Revenue/Cost/Future）: ${projectInfo.role || 'REVENUE'}

${sourceKpisText}${aiKpisText}

${projectInfo.companyStrategy ? `【全社戦略】\n${projectInfo.companyStrategy}` : ''}
${projectInfo.companyTargets && projectInfo.companyTargets.length > 0 ? `【全社目標】\n${projectInfo.companyTargets.map((t: any) => `- ${t.label}: ${t.base}→${t.high || t.base} (${t.unit})`).join('\n')}` : ''}
${companyContextSection(projectInfo.companyContext)}
  `.trim();

  const prompt = `【重要：現在日時】
現在日は ${currentDateStr} です。
本プロンプトで「現在月」「今月」と表記した場合、${currentMonth}月を指します。
本プロンプトで「現在年月」と表記した場合、${currentYearMonth} を指します。

---

以下のプロジェクト情報と全社戦略をもとに、実行計画のたたき台を生成してください。
現場社員が白紙から入力しなくてもよいように、具体的で実行可能なKPI・ステップを提案してください。

${projectContext}

---

${REASONING_RULES}

## 出力形式

JSON形式で以下を返してください。

{
  "objective": "このプロジェクトで目指す達成状態（30～50文字）",
  "role": "REVENUE | COST | FUTURE",
  "impact": {
    "revenueMJPY": 数値またはnull,
    "opIncomeMJPY": 数値またはnull,
    "investmentMJPY": 数値またはnull,
    "rationale": "数値目安の根拠",
    "assumptions": {
      "targetCustomers": 数値（REVENUE時のみ）,
      "conversionRatePct": 数値（REVENUE時のみ）,
      "averageDealMJPY": 数値（REVENUE時のみ）,
      "currentCostMJPY": 数値（COST時のみ）,
      "reductionRatePct": 数値（COST時のみ）,
      "peopleCount": 数値（FUTURE時のみ）,
      "durationMonths": 数値（FUTURE時のみ）,
      "monthlyCostPerPersonMJPY": 数値（FUTURE時のみ）,
      "externalCostMJPY": 数値（FUTURE時のみ）
    }
  },
${REASONING_OUTPUT_FIELDS}  "kpis": [
    {
      "label": "KPI名",
      "target": 数値,
      "unit": "% または件数など",
      "due": "YYYY-MM形式の期限",
      "owner": "担当者名（未定の場合は空文字列）",
      "milestones": [
        {
          "title": "途中の目安（例：ベータ版リリース）",
          "dueYm": "YYYY-MM形式"
        }
      ]
    }
  ],
  "steps": [
    {
      "title": "最初の実行ステップ",
      "dueYm": "YYYY-MM形式"
    }
  ]
}

---

## 生成ガイドライン

### objective
- プロジェクトの最終状態を1文で表現
- 例：「既存顧客へのアップセルにより、平均売上単価を30%向上させる」

### role
- REVENUE: 売上拡大を目指すプロジェクト
- COST: コスト削減・効率化を目指すプロジェクト
- FUTURE: 将来の競争力強化・基盤構築を目指すプロジェクト

### impact
- revenueMJPY: 売上増分（百万円単位）
- opIncomeMJPY: 営業利益増分（百万円単位）
- investmentMJPY: 必要投資額（百万円単位）
- rationale: 数値の根拠（文字列）
- assumptions: 計算前提（role に応じて設定）
  - REVENUE: targetCustomers（対象顧客数）, conversionRatePct（受注率%）, averageDealMJPY（平均単価）
  - COST: currentCostMJPY（現在コスト）, reductionRatePct（削減率%）
  - FUTURE: peopleCount（人数）, durationMonths（期間月数）, monthlyCostPerPersonMJPY（月単価）, externalCostMJPY（外部費用）
- 不明な項目はnullを指定

### kpis
- ★ STAGE3で確定されたKPIがある場合は、そのKPI名をそのまま使用すること
  - KPI名を変更・追加・削除するなど、勝手に編集しないこと
  - ★ 非常に重要 ★ STAGE3 KPI の個数に合わせて、「同じ個数」「同じ順番」で生成すること
    - STAGE3 KPI件数：N件
    - STAGE4 KPI件数：必ずN件
    - 1番目のSTAGE3 KPI → 1番目のSTAGE4 KPIに対応させること

- STAGE3 KPIがない場合のみ、新規にKPI名を生成する
  - KPI名は「テーマ名：指標名」のように冗長にせず、具体的で成長につながる指標にする
  - NG例: 「半導体企業向け製品強化：売上向上（%）」
  - OK例: 「重点顧客向け新製品売上比率」、「半導体領域の有効商談数」

- AIが生成してよいのは、各KPIに対する以下のみ：
  - target: 目標値
  - unit: 単位
  - due: 期限（${kpiDueLowerBound} ～ ${kpiDueUpperBound}）
  - owner: 担当者案
  - milestones: マイルストーン

- 期限は ${kpiDueLowerBound} ～ ${kpiDueUpperBound} の範囲で設定すること（過去日付は絶対に使用しない）
  - この範囲は現在（${currentYearMonth}）から3～6ヶ月後の期間
  - 必ず YYYY-MM 形式で、この範囲内の日付を指定すること

- ★ 絶対に守ること ★
  - STAGE3 KPIより多く返さない
  - STAGE3 KPIより少なく返さない
  - 返す順番を変えない

### steps
- 初期段階の実行ステップを3～5個列挙
- 各ステップは1～3ヶ月単位で実行可能な粒度
- ステップ名は「誰に対して」「何をするか」を含む具体的な行動に
  - NG例: 「顧客アンケート実施」「提案内容ブラッシュアップ」
  - OK例: 「重点顧客10社への課題ヒアリング」「営業・開発合同で顧客別提案方針を確認」
- 期限は ${stepDueLowerBound} ～ ${stepDueUpperBound} の範囲で設定すること（過去日付は絶対に使用しない）
  - この範囲は現在（${currentYearMonth}）から1～3ヶ月後の期間
  - 必ず YYYY-MM 形式で、この範囲内の日付を指定すること

---

厳密には JSON のみを出力してください。説明やコメントは不要です。`;

  return prompt;
}
