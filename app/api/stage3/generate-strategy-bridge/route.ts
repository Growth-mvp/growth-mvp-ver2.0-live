// /app/api/stage3/generate-strategy-bridge/route.ts
// STAGE3戦略展開ブリッジ生成：STAGE2最終ストーリーからAI生成
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';

interface ChapterStory {
  title: string;
  body: string;
}

interface StrategicCore {
  primaryShift?: string;
  concreteDomains?: string[];
  customerValue?: string;
  coreCapabilities?: string[];
  portfolioShift?: string;
  behaviorChange?: string;
  nonNegotiableThemes?: string[];
}

interface Stage3StrategyBridge {
  keyThemes: string[];
  departmentIssues: string[];
  kpiCriteria: string[];
  commonBehaviorChanges: string[];
  strategicCore: StrategicCore;
  departmentTranslationRules: string[];
  generatedAt: string;
}

interface Stage2FinalDocumentEdits {
  conclusion?: string;
  assumptions?: {
    external?: string[];
    internal?: string[];
    implications?: string[];
  };
  overview?: {
    whyChange?: string;
    whereToPlay?: string;
    whatToWin?: string;
    howToExecute?: string;
  };
  midtermStrategy?: {
    midtermConcept?: string;
    targetVisionForMidterm?: string;
    priorityStrategicThemes?: string[];
    growthStrategy?: string;
    profitImprovementStrategy?: string;
    portfolioPolicy?: string;
    companyWideDecisionCriteria?: string[];
    deploymentPrinciplesForUnits?: string[];
    managementMeetingIssues?: string[];
    strategicCore?: StrategicCore;
  };
}

function createFallbackStrategicCore(
  parsed: any,
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits,
  finalStoryFinal?: ChapterStory[]
): StrategicCore {
  const mts = stage2FinalDocumentEdits?.midtermStrategy;

  // primaryShift：midtermConcept または growthStrategy から作る
  let primaryShift: string | undefined;
  if (mts?.midtermConcept) {
    primaryShift = mts.midtermConcept;
  } else if (mts?.growthStrategy) {
    primaryShift = mts.growthStrategy;
  } else if (parsed.keyThemes?.length > 0) {
    primaryShift = parsed.keyThemes[0];
  }

  // concreteDomains：priorityStrategicThemes から具体語を抽出。なければ departmentIssues を使う
  let concreteDomains: string[] = [];
  if (mts?.priorityStrategicThemes?.length) {
    concreteDomains = mts.priorityStrategicThemes.slice(0, 8);
  } else if (parsed.departmentIssues?.length) {
    concreteDomains = parsed.departmentIssues.slice(0, 4);
  }

  // customerValue：targetVisionForMidterm を優先。なければ最終ストーリーから抽出
  let customerValue: string | undefined;
  if (mts?.targetVisionForMidterm) {
    customerValue = mts.targetVisionForMidterm;
  } else if (finalStoryFinal?.length > 0) {
    const storyBody = finalStoryFinal[0]?.body || '';
    const valueMatch = storyBody.match(/(?:顧客価値|選ばれる理由|提供価値)[：:].+?(?=\n|$)/);
    if (valueMatch) {
      customerValue = valueMatch[0];
    }
  }

  // coreCapabilities：最終ストーリーから技術・能力・強みらしい語を抽出
  let coreCapabilities: string[] = [];
  if (stage2FinalDocumentEdits?.assumptions?.internal?.length) {
    coreCapabilities = stage2FinalDocumentEdits.assumptions.internal.slice(0, 6);
  } else if (mts?.priorityStrategicThemes?.length) {
    coreCapabilities = mts.priorityStrategicThemes.slice(0, 6);
  } else if (parsed.keyThemes?.length) {
    coreCapabilities = parsed.keyThemes.slice(0, 4);
  }

  // portfolioShift：portfolioPolicy を優先。なければ kpiCriteria を使う
  let portfolioShift: string | undefined;
  if (mts?.portfolioPolicy) {
    portfolioShift = mts.portfolioPolicy;
  } else if (parsed.kpiCriteria?.length > 0) {
    portfolioShift = parsed.kpiCriteria[0];
  }

  // behaviorChange：deploymentPrinciplesForUnits を優先。なければ commonBehaviorChanges を使う
  let behaviorChange: string | undefined;
  if (mts?.deploymentPrinciplesForUnits?.length > 0) {
    behaviorChange = mts.deploymentPrinciplesForUnits[0];
  } else if (parsed.commonBehaviorChanges?.length > 0) {
    behaviorChange = parsed.commonBehaviorChanges[0];
  }

  // nonNegotiableThemes：priorityStrategicThemes + concreteDomains + keyThemes から重複排除して3～8個
  const themes = new Set<string>();
  if (mts?.priorityStrategicThemes) {
    mts.priorityStrategicThemes.forEach(t => themes.add(t));
  }
  concreteDomains.forEach(d => themes.add(d));
  if (parsed.keyThemes) {
    parsed.keyThemes.slice(0, 3).forEach((t: string) => themes.add(t));
  }
  const nonNegotiableThemes = Array.from(themes).slice(0, 8);

  return {
    ...(primaryShift ? { primaryShift } : {}),
    ...(concreteDomains.length > 0 ? { concreteDomains } : {}),
    ...(customerValue ? { customerValue } : {}),
    ...(coreCapabilities.length > 0 ? { coreCapabilities } : {}),
    ...(portfolioShift ? { portfolioShift } : {}),
    ...(behaviorChange ? { behaviorChange } : {}),
    ...(nonNegotiableThemes.length > 0 ? { nonNegotiableThemes } : {}),
  };
}

function createFallbackDepartmentTranslationRules(
  parsed: any,
  strategicCore: StrategicCore
): string[] {
  const rules: string[] = [];

  if (strategicCore.primaryShift) {
    rules.push(`各部門ミッションには ${strategicCore.primaryShift.slice(0, 30)} のうち自部門が担う役割を明記する`);
  }

  if (strategicCore.concreteDomains?.length) {
    rules.push(`各プロジェクトは ${strategicCore.concreteDomains[0]} などの重点領域またはコア・テーマのいずれかに接続する`);
  }

  if (strategicCore.customerValue || strategicCore.portfolioShift || strategicCore.behaviorChange) {
    const dims = [
      strategicCore.customerValue ? '顧客価値' : '',
      strategicCore.portfolioShift ? 'ポートフォリオ転換' : '',
      strategicCore.behaviorChange ? '行動変化' : ''
    ].filter(Boolean).join(' / ');
    if (dims) {
      rules.push(`KPIは ${dims} の変化を測る指標にする`);
    }
  }

  if (strategicCore.nonNegotiableThemes?.length) {
    rules.push(`全部門が保持すべき ${strategicCore.nonNegotiableThemes[0]} などのテーマは、部門戦略でも具体化する`);
  }

  if (rules.length < 3) {
    if (parsed.keyThemes?.length) {
      rules.push(`各部門の戦略は全社 keyThemes（${parsed.keyThemes[0]}など）に整合させる`);
    }
    if (parsed.departmentIssues?.length) {
      rules.push(`${parsed.departmentIssues[0]}など全社重点領域への貢献を明示する`);
    }
  }

  return rules.slice(0, 6);
}

async function generateStrategyBridge(
  finalStoryFinal: ChapterStory[],
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits
): Promise<{ bridge: Stage3StrategyBridge; debugInfo: any }> {
  const debugInfo: any = {
    storyLength: finalStoryFinal.length,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    openaiKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0,
  };

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const storyText = finalStoryFinal
    .map((ch, i) => `【第${i + 1}章】${ch.title}\n${ch.body}`)
    .join('\n\n');

  debugInfo.storyTextLength = storyText.length;

  // 補助セクション情報がある場合は組み込む
  let contextText = `【最終ストーリー】
${storyText}`;

  if (stage2FinalDocumentEdits) {
    if (stage2FinalDocumentEdits.conclusion) {
      contextText += `

【この戦略ストーリーの結論】
${stage2FinalDocumentEdits.conclusion}`;
    }
    if (stage2FinalDocumentEdits.assumptions) {
      const { external, internal, implications } = stage2FinalDocumentEdits.assumptions;
      contextText += '\n\n【戦略判断の前提】';
      if (external?.length) {
        contextText += `\n外部環境：\n${external.map(e => `・${e}`).join('\n')}`;
      }
      if (internal?.length) {
        contextText += `\n内部環境：\n${internal.map(i => `・${i}`).join('\n')}`;
      }
      if (implications?.length) {
        contextText += `\n戦略上の含意：\n${implications.map(i => `・${i}`).join('\n')}`;
      }
    }
    if (stage2FinalDocumentEdits.overview) {
      const { whyChange, whereToPlay, whatToWin, howToExecute } = stage2FinalDocumentEdits.overview;
      contextText += '\n\n【戦略ストーリーの全体像】';
      if (whyChange) contextText += `\n危機認識：${whyChange}`;
      if (whereToPlay) contextText += `\n戦略選択：${whereToPlay}`;
      if (whatToWin) contextText += `\n目指す未来：${whatToWin}`;
      if (howToExecute) contextText += `\n実行設計：${howToExecute}`;
    }
    if (stage2FinalDocumentEdits.midtermStrategy) {
      const mts = stage2FinalDocumentEdits.midtermStrategy;
      contextText += '\n\n【中計設計：全社戦略の展開軸】';
      if (mts.midtermConcept) contextText += `\n基本コンセプト：${mts.midtermConcept}`;
      if (mts.targetVisionForMidterm) contextText += `\n目指す姿：${mts.targetVisionForMidterm}`;
      if (mts.priorityStrategicThemes?.length) {
        contextText += `\n重点戦略テーマ：\n${mts.priorityStrategicThemes.map((t: string) => `・${t}`).join('\n')}`;
      }
      if (mts.growthStrategy) contextText += `\n成長戦略：${mts.growthStrategy}`;
      if (mts.profitImprovementStrategy) contextText += `\n収益改善戦略：${mts.profitImprovementStrategy}`;
      if (mts.portfolioPolicy) contextText += `\n事業ポートフォリオ方針：${mts.portfolioPolicy}`;
      if (mts.companyWideDecisionCriteria?.length) {
        contextText += `\n全社共通の判断基準：\n${mts.companyWideDecisionCriteria.map((c: string) => `・${c}`).join('\n')}`;
      }
      if (mts.deploymentPrinciplesForUnits?.length) {
        contextText += `\n部門・社員への展開方針：\n${mts.deploymentPrinciplesForUnits.map((p: string) => `・${p}`).join('\n')}`;
      }
      if (mts.managementMeetingIssues?.length) {
        contextText += `\n経営会議で確認すべき論点：\n${mts.managementMeetingIssues.map((i: string) => `・${i}`).join('\n')}`;
      }
      if (mts.strategicCore) {
        const core = mts.strategicCore;
        contextText += '\n\n【戦略の芯（STAGE3で保持すべき固有テーマ）】';
        if (core.primaryShift) contextText += `\n転換の軸：${core.primaryShift}`;
        if (core.concreteDomains?.length) contextText += `\n重点領域：${core.concreteDomains.map((d) => `・${d}`).join('\n')}`;
        if (core.customerValue) contextText += `\n顧客価値：${core.customerValue}`;
        if (core.coreCapabilities?.length) contextText += `\n中核能力：${core.coreCapabilities.map((c) => `・${c}`).join('\n')}`;
        if (core.portfolioShift) contextText += `\n資源配分・ポートフォリオ転換：${core.portfolioShift}`;
        if (core.behaviorChange) contextText += `\n行動変化：${core.behaviorChange}`;
        if (core.nonNegotiableThemes?.length) contextText += `\n保持すべきテーマ：${core.nonNegotiableThemes.map((t) => `・${t}`).join('\n')}`;
      }
    }
  }

  const prompt = `以下はSTAGE2で策定された全社戦略の最終ストーリーおよび補助セクションです。
このストーリーをもとに、各事業部門長が自部門戦略・重点プロジェクト・KPIを設計する際の判断材料となる全社戦略サマリーを、6つのキーで変換してください。

${contextText}

---

## 出力形式（必須・重要）

JSON形式で以下を返してください。
【重要】keyThemes / departmentIssues / kpiCriteria / commonBehaviorChanges だけを返すのは禁止です。
【必須】JSONには必ず6つのキーをすべて含めてください：
  1. keyThemes
  2. departmentIssues
  3. kpiCriteria
  4. commonBehaviorChanges
  5. strategicCore
  6. departmentTranslationRules

各項目は箇条書き3～4個、1項目40～60文字程度。
STAGE2の章タイトル（第1章～第4章）は含めず、部門長が実行判断に使える具体的な表現で書いてください。

{
  "keyThemes": ["会社として目指す方向1", "方向2", ...],
  "departmentIssues": ["重点的に伸ばす領域1", "領域2", ...],
  "kpiCriteria": ["見直すべき事業・活動1", "活動2", ...],
  "commonBehaviorChanges": ["各部門に求める役割1", "役割2", ...],
  "strategicCore": {
    "primaryShift": "既存の何から、どの方向へ転換するのか",
    "concreteDomains": ["入力に出てきた重点市場・用途・顧客領域・技術領域"],
    "customerValue": "顧客が選ぶ理由・提供価値",
    "coreCapabilities": ["戦略実現の源泉となる強み・能力"],
    "portfolioShift": "経営資源や事業ポートフォリオをどう移すか",
    "behaviorChange": "社員・部門に求める行動変化",
    "nonNegotiableThemes": ["STAGE3以降で一般語に丸めず保持するテーマ"]
  },
  "departmentTranslationRules": ["部門戦略へ展開するときの必須ルール1", "ルール2", ...]
}

---

## 出力内容の定義

### keyThemes（会社として目指す方向）
会社全体のビジョン・基本方針。部門長が自部門の活動を整合させる上での指針。
重要：抽象名詞で終わらせず、「〜する」「〜に転換する」などの動作表現で書くこと。
例：
- 成長領域に人材・予算・開発工数を優先配分する
- 既存顧客の課題深掘りにより、提案単価を高める
- グローバル市場での現地化戦略を強化する
- デジタル基盤への投資をすすめて業務効率を改善する

### departmentIssues（重点的に伸ばす領域）
全社が重点的に取り組む成長テーマ。各部門がリソース配分の優先順位を判断する材料。
重要：各部門に求める具体的なアクション・テーマを述べること。
例：
- AI・データを活用した新規事業・新商品開発に取り組む
- 既存顧客へのアップセル・クロスセル機会を拡大する
- 業務プロセスをデジタル化し非効率をなくす
- 新興市場の顧客ニーズを把握して事業化を進める

### kpiCriteria（見直すべき事業・活動）
継続するべきでない・スケールダウンするべき事業領域。各部門が経営資源の転換判断をする基準。
重要：具体的なアクション（廃止・外部化・統合など）を示すこと。
例：
- 低採算事業からの段階的撤退スケジュールを確定する
- 付加価値が低い周辺サービスを廃止・外部化する
- レガシーなオペレーションを自動化・統合し効率化を進める
- 戦略に非整合な提携や協力関係を見直す

### commonBehaviorChanges（各部門に求める役割）
全部門が共通して実践すべき方針・期待される行動変化。各部門の戦略設計の共通基準。
重要：「各部門が〜を明確にする」「〜に転換する」など、各部門の実行責任を示すこと。
例：
- 各部門が全社戦略に対する具体的な貢献領域・KPI目標を明確にする
- 顧客課題の変化を常に把握し、提供価値の見直しを進める
- 部門最適ではなく全社最適を基準に経営資源の配分・転換判断をする
- 他部門との協業機会を主体的に探索し相乗効果を追求する

### strategicCore（戦略の芯・必須）
STAGE2の12問回答・最終ストーリー・補助セクション（特に中計設計）から、この会社固有の戦略の芯を抽出する。
【必須】「成長領域」「新市場」「高付加価値」「新技術」などの一般語だけに丸めず、入力に含まれる重点市場・用途・技術・顧客価値・やめることを保持すること。
【禁止】入力にない市場名・技術名・製品名・顧客名は絶対に追加しないこと。企業固有ワードは必ず入力から引用すること。

primaryShift：midtermConcept または growthStrategy から作る。存在しない場合は keyThemes から作る。
concreteDomains：priorityStrategicThemes から具体語を抽出。なければ departmentIssues を使う。
customerValue：targetVisionForMidterm を優先。なければ最終ストーリーから「顧客価値」「選ばれる理由」に近い文を使う。
coreCapabilities：最終ストーリーから技術・能力・強みらしい語を抽出。
portfolioShift：portfolioPolicy を優先。なければ kpiCriteria を使う。
behaviorChange：deploymentPrinciplesForUnits を優先。なければ commonBehaviorChanges を使う。
nonNegotiableThemes：priorityStrategicThemes + concreteDomains + keyThemes から重複排除して3～8個。

### departmentTranslationRules（部門展開ルール・必須）
STAGE3で部門ミッション・重点プロジェクト・KPIを作る際に守るべき必須ルール。
【必須】3～6個のルールを含めること。以下は例だが、入力の内容に応じて作成すること：
- 各部門ミッションには strategicCore.primaryShift のうち自部門が担う役割を明記する
- 各プロジェクトは strategicCore.concreteDomains または nonNegotiableThemes のいずれかに接続する
- KPIは customerValue / portfolioShift / behaviorChange の変化を測る指標にする
- 部門間での重複を避け、strategicCore.primaryShift を分割配置する

---

【最終確認】JSONに以下がすべて含まれているか確認してから出力してください：
- keyThemes（配列）
- departmentIssues（配列）
- kpiCriteria（配列）
- commonBehaviorChanges（配列）
- strategicCore（オブジェクト・必須）
- departmentTranslationRules（配列・必須）

JSON のみを出力してください。説明やコメントは不要です。`;

  console.log('[STAGE3] OpenAI API call start', { model: 'gpt-4o', promptLength: prompt.length });

  let response;
  try {
    response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    debugInfo.openaiResponseReceived = true;
    debugInfo.choicesLength = response.choices.length;
  } catch (e: any) {
    debugInfo.openaiError = {
      message: e?.message,
      code: e?.code,
    };
    throw new Error(`OpenAI API failed: ${e?.message || 'unknown error'}`);
  }

  const content = response.choices[0]?.message?.content ?? '';
  debugInfo.contentLength = content.length;
  debugInfo.contentPreview = content.substring(0, 200);

  console.log('[STAGE3] OpenAI response received', { contentLength: content.length });

  let parsed: Stage3StrategyBridge;
  try {
    // JSON抽出
    console.log('[STAGE3] Attempting JSON extraction from content');
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      debugInfo.jsonExtractionFailed = true;
      throw new Error('JSON not found in response');
    }

    debugInfo.jsonFound = true;
    console.log('[STAGE3] JSON found, length:', jsonMatch[0].length);

    const raw = JSON.parse(jsonMatch[0]);
    debugInfo.jsonParseSuccess = true;

    console.log('[STAGE3] JSON parsed successfully', {
      keys: Object.keys(raw),
    });

    // 型チェック＆標準化
    const toStringArray = (v: any): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, 5); // 最大5個まで
    };
    const toLongStringArray = (v: any, max = 8): string[] => {
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, max);
    };
    const toString = (v: any, max = 500): string | undefined => {
      const s = String(v ?? '').trim();
      return s ? s.slice(0, max) : undefined;
    };
    const rawCore = raw.strategicCore && typeof raw.strategicCore === 'object' && !Array.isArray(raw.strategicCore)
      ? raw.strategicCore
      : undefined;
    const aiStrategicCore = rawCore
      ? Object.fromEntries(
          Object.entries({
            primaryShift: toString(rawCore.primaryShift),
            concreteDomains: toLongStringArray(rawCore.concreteDomains),
            customerValue: toString(rawCore.customerValue),
            coreCapabilities: toLongStringArray(rawCore.coreCapabilities),
            portfolioShift: toString(rawCore.portfolioShift),
            behaviorChange: toString(rawCore.behaviorChange),
            nonNegotiableThemes: toLongStringArray(rawCore.nonNegotiableThemes),
          }).filter(([, v]) => Array.isArray(v) ? v.length > 0 : v !== undefined),
        ) as StrategicCore
      : undefined;

    const baseParsed = {
      keyThemes: toStringArray(raw.keyThemes),
      departmentIssues: toStringArray(raw.departmentIssues),
      kpiCriteria: toStringArray(raw.kpiCriteria),
      commonBehaviorChanges: toStringArray(raw.commonBehaviorChanges),
    };

    // strategicCore: AI結果を優先、なければfallbackを作成
    let strategicCoreSource: 'ai' | 'fallback' = 'fallback';
    let finalStrategicCore: StrategicCore;
    if (aiStrategicCore && Object.keys(aiStrategicCore).length > 0) {
      finalStrategicCore = aiStrategicCore;
      strategicCoreSource = 'ai';
    } else {
      finalStrategicCore = createFallbackStrategicCore(baseParsed, stage2FinalDocumentEdits, finalStoryFinal);
    }

    // departmentTranslationRules: AI結果を優先、なければfallbackを作成
    let departmentTranslationRulesSource: 'ai' | 'fallback' = 'fallback';
    let finalDepartmentTranslationRules = toLongStringArray(raw.departmentTranslationRules, 6);
    if (finalDepartmentTranslationRules.length > 0) {
      departmentTranslationRulesSource = 'ai';
    } else {
      finalDepartmentTranslationRules = createFallbackDepartmentTranslationRules(baseParsed, finalStrategicCore);
    }

    parsed = {
      ...baseParsed,
      strategicCore: finalStrategicCore,
      departmentTranslationRules: finalDepartmentTranslationRules,
      generatedAt: new Date().toISOString(),
    };

    // デバッグ情報に追加
    debugInfo.strategicCoreSource = strategicCoreSource;
    debugInfo.departmentTranslationRulesSource = departmentTranslationRulesSource;

    // バリデーション
    const requiredKeys = ['keyThemes', 'departmentIssues', 'kpiCriteria', 'commonBehaviorChanges'];
    for (const key of requiredKeys) {
      if (!Array.isArray((parsed as any)[key])) {
        throw new Error(`${key} is not an array`);
      }
    }

    // strategicCore と departmentTranslationRules は必須
    if (!parsed.strategicCore || typeof parsed.strategicCore !== 'object') {
      throw new Error('strategicCore must be an object');
    }
    if (!Array.isArray(parsed.departmentTranslationRules)) {
      throw new Error('departmentTranslationRules must be an array');
    }

    // 最低1個は確保
    for (const key of requiredKeys) {
      if ((parsed as any)[key].length === 0) {
        (parsed as any)[key] = [`${key}の情報が生成されませんでした`];
      }
    }

    // departmentTranslationRules は最低1個は確保
    if (parsed.departmentTranslationRules.length === 0) {
      parsed.departmentTranslationRules = ['部門戦略展開時のルール情報が生成されませんでした'];
    }

    debugInfo.validationSuccess = true;
    console.log('[STAGE3] Bridge object generated successfully', {
      keyThemesCount: parsed.keyThemes.length,
      departmentIssuesCount: parsed.departmentIssues.length,
      kpiCriteriaCount: parsed.kpiCriteria.length,
      commonBehaviorChangesCount: parsed.commonBehaviorChanges.length,
      hasStrategicCore: !!parsed.strategicCore,
      strategicCoreSource: debugInfo.strategicCoreSource,
      departmentTranslationRulesCount: parsed.departmentTranslationRules.length,
      departmentTranslationRulesSource: debugInfo.departmentTranslationRulesSource,
    });
  } catch (e: any) {
    console.error('[STAGE3] JSON parse/validation error:', e?.message);
    console.error('[STAGE3] Full content:', content);
    debugInfo.parseError = e?.message;
    throw new Error(`Failed to parse OpenAI response: ${e?.message}`);
  }

  return { bridge: parsed, debugInfo };
}

export async function POST(request: NextRequest) {
  console.log('[STAGE3] POST /api/stage3/generate-strategy-bridge called');

  try {
    // ★ 修正：既存API と同じ認証方式に統一
    const admin = getSupabaseAdmin();

    // Bearer token authentication
    let userId: string | null;
    try {
      userId = await getAuthUserIdFromBearer(admin, request);
      console.log('[STAGE3] getAuthUserIdFromBearer result:', {
        hasUserId: !!userId,
        userIdLength: userId ? userId.length : 0,
      });
    } catch (e: any) {
      console.error('[STAGE3] Auth check failed:', e?.message);
      return NextResponse.json(
        { error: '認証が必要です', detail: e?.message },
        { status: 401 }
      );
    }

    if (!userId) {
      console.warn('[STAGE3] No userId from auth (userId is null)');
      return NextResponse.json(
        { error: '認証が必要です', detail: 'Authorization header not found or invalid' },
        { status: 401 }
      );
    }

    console.log('[STAGE3] Auth OK, userId obtained');

    // リクエストボディ解析（membership 確認前に必要）
    let body: any;
    try {
      body = await request.json();
      console.log('[STAGE3] Request body received, keys:', Object.keys(body));
    } catch (e: any) {
      console.error('[STAGE3] Failed to parse request body:', e?.message);
      return NextResponse.json(
        { error: 'リクエストボディが不正です', detail: e?.message },
        { status: 400 }
      );
    }

    const { finalStoryFinal, companyId: bodyCompanyId, stage2FinalDocumentEdits } = body;

    if (!bodyCompanyId) {
      console.warn('[STAGE3] companyId not provided in body');
      return NextResponse.json(
        { error: '会社IDが必要です', detail: 'companyId is missing from body' },
        { status: 400 }
      );
    }

    console.log('[STAGE3] Check membership for company:', bodyCompanyId);

    // ★ 修正：body の companyId で membership を検証
    let membership;
    try {
      membership = await requireMembership(admin, userId, bodyCompanyId);
      console.log('[STAGE3] requireMembership result:', {
        hasMembership: !!membership,
        membershipCompanyId: membership?.companyId ? '***' : null,
      });
    } catch (e: any) {
      console.error('[STAGE3] Membership check failed:', e?.message);
      return NextResponse.json(
        { error: 'アクセス権限がありません', detail: e?.message },
        { status: 403 }
      );
    }

    if (!membership) {
      console.warn('[STAGE3] No membership found for this company', {
        bodyCompanyId: bodyCompanyId ? 'provided' : 'missing',
        membershipCheck: 'company not authorized',
      });
      return NextResponse.json(
        { error: 'この会社にアクセス権がありません', detail: 'Company not authorized' },
        { status: 403 }
      );
    }

    // ★ manager以上の権限チェック
    try {
      await assertMinRole(membership, 'manager');
    } catch {
      console.warn('[STAGE3] Insufficient role for this operation');
      return NextResponse.json(
        { error: 'この操作に必要な権限がありません', detail: 'Manager role required' },
        { status: 403 }
      );
    }

    console.log('[STAGE3] Membership OK - company authorized');

    // finalStoryFinal の確認
    console.log('[STAGE3] Check finalStoryFinal:', {
      isArray: Array.isArray(finalStoryFinal),
      length: Array.isArray(finalStoryFinal) ? finalStoryFinal.length : undefined,
      type: typeof finalStoryFinal,
    });

    if (!Array.isArray(finalStoryFinal) || finalStoryFinal.length === 0) {
      console.warn('[STAGE3] finalStoryFinal not provided or empty');
      return NextResponse.json(
        {
          error: 'STAGE2最終ストーリーが確定されていません',
          detail: `finalStoryFinal: ${Array.isArray(finalStoryFinal) ? finalStoryFinal.length : 0} items`,
        },
        { status: 400 }
      );
    }

    console.log('[STAGE3] finalStoryFinal OK, items:', finalStoryFinal.length);

    // ★ 修正：権限確認は frontend authFetchJson で行われているため、ここでは省略
    // 認証済み userId があれば十分（RLS は Supabase にまかせる）

    // AI生成実行
    // ★ membership.companyId が身分で確認された会社ID
    console.log('[STAGE3] Starting generateStrategyBridge', {
      authorizedCompanyId: membership.companyId,
      storyLength: finalStoryFinal.length,
    });

    // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
    const requestId = request.headers.get('x-request-id') || `req_${Date.now()}`;
    const storyContent = finalStoryFinal?.map((s: any) => s?.body || '').join(' ') || '';
    const hasCompanyInfo = !!body.finalStoryFinal;
    const hasStage1Context = !!body.finalStoryFinal;
    const hasStage2Answers = false;
    const hasStage2Story = !!body.finalStoryFinal;
    const hasStage3Context = false;
    const hasStage4Context = false;

    const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
    const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

    const suspiciousKeywords = checkSuspiciousKeywords(storyContent);

    logInputGuard({
      requestId,
      apiName: 'stage3/generate-strategy-bridge',
      companyId: membership.companyId,
      strategyId: bodyCompanyId,
      meaningfulInputScore,
      hasCompanyInfo,
      hasStage1Context,
      hasStage2Answers,
      hasStage2Story,
      hasStage3Context,
      hasStage4Context,
      promptLength: storyContent.length,
      suspiciousKeywordFlags: suspiciousKeywords,
    });

    const { bridge, debugInfo } = await generateStrategyBridge(finalStoryFinal, stage2FinalDocumentEdits);

    console.log('[STAGE3] generateStrategyBridge completed', {
      ...debugInfo,
      authorizedCompanyId: '***',
    });

    // ★ 修正：DB直接更新ではなく、結果のみ返す
    // フロントエンド側で store に setState → autosave で保存される
    // これにより FIELD_MAP による正しい保存・復元パスが実行される

    console.log('[STAGE3] Returning bridge result');
    return NextResponse.json(bridge);
  } catch (error: any) {
    console.error('[STAGE3] Unexpected error in POST handler:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack?.substring(0, 500),
    });

    // エラーメッセージの詳細化
    let detail = 'Unknown error';
    if (error?.message?.includes('OPENAI_API_KEY')) {
      detail = error.message;
    } else if (error?.message?.includes('OpenAI API failed')) {
      detail = error.message;
    } else if (error?.message?.includes('Failed to parse OpenAI response')) {
      detail = error.message;
    } else {
      detail = error?.message || 'Unknown error occurred';
    }

    return NextResponse.json(
      {
        error: '戦略展開ブリッジの生成に失敗しました',
        detail,
      },
      { status: 500 }
    );
  }
}
