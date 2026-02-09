/**
 * _lib/model.ts
 * OpenAI API integration for key results generation
 */

import { openai } from '@/lib/openai';
import { extractJsonObject } from '@/app/api/_shared/utils';
import { ProjectType, GenKRResult } from './types';

/**
 * ★ TASK 2: 種別別 KPI メニュー生成（プロンプト構築）
 * - projectType に応じて適切な KPI 候補と禁止パターンをプロンプトに埋め込む
 */
export function generateTypeSpecificPrompt(projectType: ProjectType, projectTitle: string, isRetry: boolean): string {
  const typeConfig: Record<ProjectType, { candidates: string; forbidden: string }> = {
    customer_research: {
      candidates: `
【推奨KPI候補】
- ヒアリング実施数（件数/月）
- ペルソナ検証数（件数/月）
- 提案反映率（%）
- VoC抽出件数（件数）
- ニーズマッチ度（%）`,
      forbidden: '不良率|合格率|稼働率|納期|生産性|歩留まり|稼働時間',
    },
    inventory_system: {
      candidates: `
【推奨KPI候補】
- 在庫精度（%）
- 欠品率（%）
- 滞留在庫金額（万円）
- 棚卸工数（h/月）
- 入出庫精度（%）`,
      forbidden: '試験合格率|不良率|ヒアリング|ニーズ|提案反映',
    },
    sales_process: {
      candidates: `
【推奨KPI候補】
- 見積リードタイム（日）
- 受注率（%）
- 失注率（%）
- 提案から成約まで期間（日）
- 案件進捗速度（件数/月）`,
      forbidden: '在庫|棚卸|稼働率|不良率|試験合格',
    },
    new_market: {
      candidates: `
【推奨KPI候補】
- PoC実施数（件数/月）
- 新規リード数（件数）
- 商談化率（%）
- 仮説検証完了数（件数）
- 市場調査進捗度（スコア）`,
      forbidden: '既存事業改善|既知顧客|安定供給|製造稼働',
    },
    dx: {
      candidates: `
【推奨KPI候補】
- 自動化率（%）
- 利用率（%）
- 手作業削減工数（h/月）
- システム導入期間短縮（日）
- RPA処理件数（件数/月）`,
      forbidden: '顧客満足度|ヒアリング|在庫精度|不良率',
    },
    quality: {
      candidates: `
【推奨KPI候補】
- 不良率低減（ppm）
- 納期達成率（%）
- クレーム件数（件数/月）
- 品質検査合格率（%）
- トレーサビリティ完全性（%）`,
      forbidden: '提案反映|ニーズ|商談化|利用率',
    },
    r_and_d: {
      candidates: `
【推奨KPI候補】
- プロトタイプ開発期間短縮（日）
- 試作試験実施数（件数）
- 特性改善幅（%）
- 設計検証完了率（%）
- 新商品上市準備度（%）`,
      forbidden: '顧客満足度|稼働率|在庫精度|失注率',
    },
    default: {
      candidates: `
【推奨KPI候補】
- 実行進捗度（%）
- 目標達成度（%）
- 効果実現度（%）`,
      forbidden: '',
    },
  };

  const config = typeConfig[projectType] || typeConfig.default;

  return `
${config.candidates}

【禁止パターン】
【絶対に使用禁止】：${config.forbidden || '生産性向上、NPS、プロセス改善スコア、顧客満足度、従業員満足度、エンゲージメント'}

※ プロジェクト名「${projectTitle}」に合わせて、上記の推奨候補から3本を選び、必要に応じてカスタマイズしてください。
※ 3本のKPIは異なる視点・指標である必要があります（同じKPIの焼き直しは禁止）
`;
}

/**
 * ★ TASK 2-3: KR専用生成関数（LLMで必ず3本埋める）
 */
export async function generateKeyResultsByLLM(
  params: {
    deptName: string;
    projectTitle: string;
    mainLever?: string;
    kind?: string;
    objective?: string;
    laneType?: 'existing' | 'new';
    projectType?: ProjectType;
    attempt?: number;
    missionDraft?: string;
    projectDescription?: string;
    dept6AnswersBlock?: string;
  }
): Promise<GenKRResult> {
  const {
    deptName,
    projectTitle,
    mainLever,
    kind,
    objective,
    laneType = 'existing',
    projectType = 'default',
    attempt = 1,
    missionDraft,
    projectDescription,
    dept6AnswersBlock,
  } = params;

  const isRetry = attempt >= 2;
  const strictnessLevel = isRetry ? '厳格' : '標準';
  const typeSpecificContent = generateTypeSpecificPrompt(projectType, projectTitle, isRetry);

  const qualityProductivityExamples = (() => {
    switch (projectType) {
      case 'sales_process':
        return '見積作成時間、提案件数、商談化率、リードタイム、営業工数';
      case 'dx':
        return '自動化率、データ入力工数、処理時間、システムエラー率、データ精度';
      case 'new_market':
        return 'PoC完了数、仮説検証リードタイム、検証継続率、パイロット顧客数';
      case 'quality':
        return '不良率、再工数、手戻り率、稼働率、歩留まり';
      case 'inventory_system':
        return '納期遵守率、在庫回転数、リードタイム、配送精度';
      case 'customer_research':
        return 'リサーチ完了数、分析精度、顧客満足度、レポート品質';
      case 'r_and_d':
        return '試作完了数、開発リードタイム、実験成功率、知識共有度';
      default:
        return '業務効率、作業時間、精度、完了率、工数削減';
    }
  })();

  const prompt = `
部門: ${deptName}
部門ミッション: ${missionDraft || '未定'}
プロジェクト: ${projectTitle}
プロジェクト説明: ${projectDescription || '未定'}
プロジェクト種別: ${projectType}
レバー: ${mainLever || '未定'}
種別: ${kind || '未定'}
目標: ${objective || '未定'}
${laneType === 'new' ? '※ 新規探索レーン：新規市場/新規顧客の検証に適したKRを' : '※ 既存進化レーン：既存事業の改善に適したKRを'}

【部門の6問回答（プロジェクト背景）】
${dept6AnswersBlock || '（6問回答なし）'}

${isRetry ? `
【${strictnessLevel}モード: 前回失敗のため、さらに厳格に要件を確認します】
` : ''}

${typeSpecificContent}

【★ KPI の3カテゴリ制約（必須）】
以下の3カテゴリから、それぞれ1本ずつ選択すること（合計3本）：

1. **主要成果KPI**: プロジェクトの直接成果（売上、粗利、受注率、リードタイム、案件数など）
2. **品質/生産性KPI**: 業務品質や効率（${qualityProductivityExamples}）
3. **顧客価値KPI**: 顧客体験や満足度（納期遵守率、クレーム数、NPS、再購買率、案件継続率など）

以下の要件で、このプロジェクトの KPI（Key Result）を3本だけ生成してください：

【必須要件】
1. JSONのみ返す（説明・前後の言葉は絶対禁止）
2. keyResultsは必ず3本、各カテゴリから1本ずつ
3. ★★★ label形式は必ず 「${projectTitle}：{KPI名}（{unit}）」に統一する
4. 各KRの unit は単位のみ（例："ppm", "日", "%" など）
5. 上記の【部門の6問回答】と整合性を保つこと
6. プロジェクト種別（${projectType}）に適した指標を選択すること

【返却フォーマット】
{
  "keyResults": [
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" },
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" },
    { "label": "${projectTitle}：{KPI名}（{unit}）", "unit": "単位コード" }
  ]
}

【例】
{
  "keyResults": [
    { "label": "${projectTitle}：不良率低減（100ppm以下）", "unit": "ppm" },
    { "label": "${projectTitle}：納期短縮（30日以内）", "unit": "日" },
    { "label": "${projectTitle}：歩留まり改善（98.5%以上）", "unit": "%" }
  ]
}

★重要★ label に必ずプロジェクト名を含めること。JSON以外は返さないこと。
`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `あなたは製造業 B2B の経営戦略コンサルタント。JSON 形式のみで回答する。前後の説明や注記は絶対禁止。`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(rawContent);

    if (!parsed) {
      console.log(
        `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=parse_failed`
      );
      return { keyResults: [], errorCode: 'ai_error_parse' };
    }

    const krArray = parsed?.keyResults;
    if (!Array.isArray(krArray) || krArray.length < 3) {
      console.log(
        `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=schema krCount=${Array.isArray(krArray) ? krArray.length : 0}`
      );
      return { keyResults: [], errorCode: 'ai_error_schema' };
    }

    const valid = krArray.slice(0, 3).every((kr: any) => {
      const label = String(kr?.label ?? '').trim();
      return label.length > 0;
    });

    if (!valid) {
      return { keyResults: [], errorCode: 'ai_error_schema' };
    }

    const extracted = krArray.slice(0, 3).map((kr: any) => ({
      label: String(kr.label).trim(),
      unit: kr.unit ? String(kr.unit).trim() : null,
    }));

    console.log(
      `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" success krCount=3`
    );
    return { keyResults: extracted };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isNetworkErr = errMsg.includes('socket') || errMsg.includes('timeout') || errMsg.includes('connection');

    console.log(
      `[cascade][kpi][ai-gen-debug] attempt=${attempt} dept="${deptName}" project="${projectTitle}" error=network msg="${isNetworkErr ? 'network_error' : errMsg.slice(0, 50)}"`
    );

    return { keyResults: [], errorCode: 'ai_error_network' };
  }
}
