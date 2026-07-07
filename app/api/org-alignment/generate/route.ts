// /app/api/org-alignment/generate/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getFullStrategyDataByCompany, getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';

const ROUTE_TAG = 'app/api/org-alignment/generate';

type CompanyRecognitionMode = 'strategy_based' | 'needs_confirmation';
type RiskLevel = 'low' | 'medium' | 'high';

type OrgMisalignmentType =
  | 'department_cooperation'
  | 'challenge_and_failure'
  | 'evaluation_system'
  | 'executive_policy'
  | 'authority_decision'
  | 'role_responsibility'
  | 'priority_conflict'
  | 'tool_or_process_distrust'
  | 'communication_gap'
  | 'workload_resource'
  | 'business_process_efficiency'
  | 'culture_motivation'
  | 'talent_development'
  | 'skill_capability_gap'
  | 'customer_market_gap'
  | 'kpi_goal_misalignment'
  | 'change_resistance'
  | 'unknown';

type OrgAlignmentResult = {
  title: string;
  inputSummary: string;
  issueType: string;
  participantRecognitionHypothesis: string;
  companyRecognitionMode: CompanyRecognitionMode;
  companyRecognitionTitle: string;
  companyRecognition: string;
  alignmentPoints: string[];
  recommendedNextAction: {
    title: string;
    detail: string;
  };
  riskLevel: RiskLevel;
  riskReason: string;
};

type GeneratePayload = {
  situationText?: string;
  myRecognitionText?: string;
  idealText?: string;
  expectationText?: string;
  counterpartyType?: string;
  counterpartyDetail?: string;
  visibilityMode?: string;
  strategyId?: string;
  strategyContext?: any;
  concernType?: OrgMisalignmentType | string;
  // snake_case fallback
  situation_text?: string;
  my_recognition_text?: string;
  ideal_text?: string;
  expectation_text?: string;
  counterparty_type?: string;
  counterparty_detail?: string;
  visibility_mode?: string;
};

/* ========== helpers ========== */
function json(res: any, status = 200, routeTag: string = ROUTE_TAG) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-GROWTH-Route': routeTag,
    },
  });
}

function cleanApiKey(raw?: string | null): string {
  return (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n|\r/g, '')
    .trim();
}

function extractMessage(e: any): string {
  return (
    e?.message ??
    e?.response?.data?.error?.message ??
    e?.response?.data ??
    e?.error?.message ??
    String(e)
  );
}

function firstText(...values: any[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function containsAny(text: string, terms: string[]): boolean {
  if (!text) return false;
  return terms.some((term) => text.includes(term));
}

function normalizeConcernType(value: any): OrgMisalignmentType {
  const allowed: OrgMisalignmentType[] = [
    'department_cooperation',
    'challenge_and_failure',
    'evaluation_system',
    'executive_policy',
    'authority_decision',
    'role_responsibility',
    'priority_conflict',
    'tool_or_process_distrust',
    'communication_gap',
    'workload_resource',
    'business_process_efficiency',
    'culture_motivation',
    'talent_development',
    'skill_capability_gap',
    'customer_market_gap',
    'kpi_goal_misalignment',
    'change_resistance',
    'unknown',
  ];
  return allowed.includes(value) ? value : 'unknown';
}

const ISSUE_LABEL_BY_TYPE: Record<OrgMisalignmentType, string> = {
  department_cooperation: '部門間協力のズレ',
  challenge_and_failure: '挑戦と失敗許容のズレ',
  evaluation_system: '評価制度とのズレ',
  executive_policy: '経営方針と現場実態のズレ',
  authority_decision: '権限・意思決定のズレ',
  role_responsibility: '役割責任のズレ',
  priority_conflict: '優先順位のズレ',
  tool_or_process_distrust: 'ツール・仕組みへの不信',
  communication_gap: '情報共有・説明不足',
  workload_resource: '人員・時間・負荷のズレ',
  business_process_efficiency: '業務プロセス・効率化のズレ',
  culture_motivation: '組織風土・モチベーションのズレ',
  talent_development: '人材育成・成長支援のズレ',
  skill_capability_gap: 'スキル・能力要件のズレ',
  customer_market_gap: '顧客・市場とのズレ',
  kpi_goal_misalignment: 'KPI・目標設計のズレ',
  change_resistance: '変化への抵抗',
  unknown: 'その他',
};

function classifyConcernFallback(text: string): OrgMisalignmentType {
  const t = text || '';
  // 優先度が高いものから判定。generate側ではintakeから渡された concernType を優先し、これはfallback用。
  if (containsAny(t, ['顧客ニーズ', '顧客の声', '市場', '競合', '顧客価値', '市場環境', 'お客様', 'ユーザーのニーズ'])) return 'customer_market_gap';
  if (containsAny(t, ['KPI', 'OKR', '目標', '部門目標', '短期業績', '長期戦略', '評価指標', '数字ばかり'])) return 'kpi_goal_misalignment';
  if (containsAny(t, ['今までのやり方', '前例', '過去の成功体験', '変化', '抵抗', '新しいやり方', '従来通り'])) return 'change_resistance';
  if (containsAny(t, ['業務プロセス', '業務フロー', '非効率', '無駄', '二重入力', '手作業', '承認フロー', '会議', '報告', '資料作成', '転記', '効率化'])) return 'business_process_efficiency';
  if (containsAny(t, ['風土', '雰囲気', '空気', 'モチベーション', 'やる気', '指示待ち', '諦め', '心理的安全性', '意見を言いにくい', '閉塞感'])) return 'culture_motivation';
  if (containsAny(t, ['育成', '人材育成', '若手', '部下', '教育', '研修', 'OJT', '成長機会', 'フィードバック', '管理職育成'])) return 'talent_development';
  if (containsAny(t, ['スキル', '能力', '知識', '経験', '専門性', 'DX', 'データ活用', '分析', 'マネジメント力', '技術力', '不足'])) return 'skill_capability_gap';
  if (containsAny(t, ['GROWTH SHIFT', 'GROWTHSHIFT', 'ツール', 'システム', '入力しても', '意味があるのか', '意味がない', '会社は変わらない', '活用されない'])) return 'tool_or_process_distrust';
  if (containsAny(t, ['他部門', '関連部門', '部門間', '協力', '依頼', 'お願い', '連携', '調整', '支援', '動いてくれない'])) return 'department_cooperation';
  if (containsAny(t, ['挑戦', '失敗が許されない', '失敗すると', '新しい施策', '新しい取り組み', 'リスク'])) return 'challenge_and_failure';
  if (containsAny(t, ['評価', '人事評価', '査定', '賞与', '昇格', '評価制度', '評価されない', '評価に反映'])) return 'evaluation_system';
  if (containsAny(t, ['経営', '経営層', '経営者', '会社方針', '経営方針', '現場の実情', '現場の実態', '無理な指示', '現場を理解', '見ていない'])) return 'executive_policy';
  if (containsAny(t, ['権限', '判断権限', '承認', '決裁', '稟議', '判断できない', '確認ばかり'])) return 'authority_decision';
  if (containsAny(t, ['役割', '責任', '誰が責任', '責任範囲', '丸投げ', '担当が曖昧'])) return 'role_responsibility';
  if (containsAny(t, ['優先順位', '優先度', '後回し', '重要プロジェクト', '温度差'])) return 'priority_conflict';
  if (containsAny(t, ['説明不足', '共有されない', '情報共有', '理由が分からない', '納得感がない', '伝わってこない'])) return 'communication_gap';
  if (containsAny(t, ['人が足りない', '時間がない', '忙しすぎる', '負荷', '業務量', '余裕がない', 'リソース'])) return 'workload_resource';
  return 'unknown';
}

function getIssueTypeLabel(concernType: OrgMisalignmentType): string {
  return ISSUE_LABEL_BY_TYPE[concernType] ?? ISSUE_LABEL_BY_TYPE.unknown;
}

function buildConcernTypeInstruction(concernType: OrgMisalignmentType, issueTypeLabel: string): string {
  const common = `\n\n【今回の分類】\nこのケースは「${issueTypeLabel}」として整理してください。\nissueType には必ず「${issueTypeLabel}」を入れてください。\n`; 

  const instructions: Record<OrgMisalignmentType, string> = {
    department_cooperation: `
${common}
部門や担当者を責めるのではなく、部門間で「どこまで協力すべきか」「顧客・案件・業務に対する優先順位をどう揃えるか」「どの役割責任を誰が持つか」が揃っていない状態として整理してください。
STEP4では、どの部門に何を依頼したのか、相手部門がどの前提で動かなかったのか、会社としてどこまで協力を標準期待にするのかを問いにしてください。`,

    challenge_and_failure: `
${common}
社員の挑戦意欲の問題ではなく、会社が挑戦を求める一方で、失敗時の評価・責任・支援の扱いが明確でないため、安全策を選ぶことが合理的になっている状態として整理してください。
STEP4では、どこまでの失敗を学習として許容するのか、仮説・行動・検証プロセスを評価するのか、管理職がどう支援するのかを問いにしてください。`,

    evaluation_system: `
${common}
評価されない不満としてではなく、会社が求める行動・変革・貢献と、実際に評価される成果・指標・処遇の間にズレがある状態として整理してください。
STEP4では、どの行動や成果を評価対象にするのか、短期成果以外のプロセスや協働をどう見るのかを問いにしてください。`,

    executive_policy: `
${common}
単なる経営批判ではなく、経営が掲げる方針・戦略・指示と、現場で実際に求められる短期成果・業務負荷・権限・支援の間にズレがある状態として整理してください。
「報告」「フィードバック」「現場を見ていない」「実情を理解していない」が含まれる場合は、現場情報が経営判断・現場支援・優先順位調整にどう使われているかが見えないズレとして扱ってください。
STEP4では、経営が何を判断するために報告を求めているのか、現場情報がどう活用されるのか、現場制約をどう把握するのかを問いにしてください。`,

    authority_decision: `
${common}
現場や管理職の能力不足ではなく、誰がどの範囲を判断できるのか、承認・決裁・相談の基準が明確でない状態として整理してください。
STEP4では、どの判断を現場に任せるのか、どこから承認が必要なのか、責任と権限をどう一致させるのかを問いにしてください。`,

    role_responsibility: `
${common}
誰かに仕事を押し付けている問題としてではなく、役割責任・担当範囲・最終責任者の認識が揃っていない状態として整理してください。
STEP4では、どの業務の責任が曖昧なのか、誰が主担当・支援者・承認者なのか、境界業務をどう扱うのかを問いにしてください。`,

    priority_conflict: `
${common}
やる気や協力姿勢の問題ではなく、全社・部門・現場で何を優先すべきかの判断基準が揃っていない状態として整理してください。
STEP4では、どの案件・業務・プロジェクトを優先するのか、優先順位を誰がどう決めるのか、他業務をどう調整するのかを問いにしてください。`,

    tool_or_process_distrust: `
${common}
ツールへの否定ではなく、入力・相談・提案した内容が実際の判断・支援・改善に活かされるのかが見えないことによる不信として整理してください。
STEP4では、入力内容を誰が見て、どのように扱い、どのタイミングでフィードバックし、改善につなげるのかを問いにしてください。`,

    communication_gap: `
${common}
説明不足への不満としてだけでなく、方針・決定・背景・判断理由が共有されず、現場が何を基準に動けばよいか分からない状態として整理してください。
STEP4では、どの決定の背景を共有すべきか、誰にどの粒度で説明するか、質問やフィードバックの場をどう作るかを問いにしてください。`,

    workload_resource: `
${common}
現場の努力不足ではなく、求められる目標・追加業務・新施策に対して、人員・時間・予算・優先順位調整が不足している状態として整理してください。
STEP4では、何を増やすだけでなく、何を減らす・止める・後回しにするのか、必要な支援は何かを問いにしてください。`,

    business_process_efficiency: `
${common}
人の仕事の仕方を責めるのではなく、作業手順、承認フロー、情報連携、システム分断、二重入力、会議・報告負荷などの構造上のズレとして整理してください。
STEP4では、どの業務を減らす・統合する・標準化する・自動化するか、どの承認や情報連携を見直すかを問いにしてください。`,

    culture_motivation: `
${common}
社員の意識ややる気の問題として扱わず、前向きに動く意味を感じにくい構造、評価・支援・心理的安全性・過去経験とのズレとして整理してください。
STEP4では、何が前向きな行動を妨げているのか、意見や挑戦がどう扱われれば動きやすいのかを問いにしてください。`,

    talent_development: `
${common}
人が育たないという個人批判ではなく、会社が期待する成長・役割と、育成時間・機会・責任者・フィードバック・評価が揃っていない状態として整理してください。
STEP4では、誰にどの能力を期待するのか、誰が育成責任を持つのか、育成時間や評価をどう確保するのかを問いにしてください。`,

    skill_capability_gap: `
${common}
スキル不足を個人の能力不足として責めず、会社や上司が求める業務水準・戦略実行能力と、現場にある知識・経験・教育機会・支援体制のズレとして整理してください。
STEP4では、どの業務にどのスキルが必要か、教育・支援・外部活用・役割分担をどう整えるかを問いにしてください。`,

    customer_market_gap: `
${common}
顧客や市場の声を現場の主観として片づけず、顧客ニーズ・市場変化と、会社方針・商品・サービス・社内ルール・意思決定のズレとして整理してください。
STEP4では、どの顧客変化をどう捉えるか、現場の顧客情報を戦略や商品・サービス改善にどう反映するかを問いにしてください。`,

    kpi_goal_misalignment: `
${common}
目標未達やKPIへの不満ではなく、全社戦略・部門目標・現場行動・評価指標がつながっていない状態として整理してください。
STEP4では、KPIがどの戦略に紐づいているのか、短期数字と長期戦略のどちらをどう優先するのか、評価指標をどう見直すかを問いにしてください。`,

    change_resistance: `
${common}
抵抗する人を責めるのではなく、過去の成功体験・前例・慣習が、未来に向けた変化や新しいやり方を阻害している状態として整理してください。
STEP4では、何を変える必要があるのか、何を残すのか、前例がない取り組みをどう試行・検証するのかを問いにしてください。`,

    unknown: `
${common}
入力内容を、人や部署への批判ではなく、方針・優先順位・役割責任・評価・意思決定・支援・情報共有などの認識のズレとして整理してください。
STEP4では、抽象的な改善テーマではなく、実際のすり合わせの場で確認できる問いにしてください。`,
  };

  return instructions[concernType] ?? instructions.unknown;
}

function safeJsonParse(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function asStringArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 5);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function ensureResultShape(raw: any, fallback: OrgAlignmentResult): OrgAlignmentResult {
  const r = raw && typeof raw === 'object' ? raw : {};
  const risk = ['low', 'medium', 'high'].includes(r.riskLevel) ? r.riskLevel : fallback.riskLevel;
  return {
    title: firstText(r.title, fallback.title),
    inputSummary: firstText(r.inputSummary, fallback.inputSummary),
    issueType: firstText(r.issueType, fallback.issueType),
    participantRecognitionHypothesis: firstText(
      r.participantRecognitionHypothesis,
      fallback.participantRecognitionHypothesis,
    ),
    companyRecognitionMode: r.companyRecognitionMode === 'strategy_based' ? 'strategy_based' : fallback.companyRecognitionMode,
    companyRecognitionTitle: firstText(r.companyRecognitionTitle, fallback.companyRecognitionTitle),
    companyRecognition: firstText(r.companyRecognition, fallback.companyRecognition),
    alignmentPoints: asStringArray(r.alignmentPoints).length > 0 ? asStringArray(r.alignmentPoints) : fallback.alignmentPoints,
    recommendedNextAction: {
      title: firstText(r.recommendedNextAction?.title, fallback.recommendedNextAction.title),
      detail: firstText(r.recommendedNextAction?.detail, fallback.recommendedNextAction.detail),
    },
    riskLevel: risk,
    riskReason: firstText(r.riskReason, fallback.riskReason),
  };
}

function truncate(value: any, max = 900): any {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function buildStrategyContextForPrompt(strategyData: any, payloadStrategyContext?: any) {
  const source = strategyData || payloadStrategyContext || null;
  if (!source) return null;

  const departments = Array.isArray(source.departments)
    ? source.departments.slice(0, 8).map((d: any) => ({
        name: d?.name || d?.departmentName || d?.title || null,
        mission: truncate(d?.mission, 400),
        winPatternPrimary: d?.winPatternPrimary || null,
        projects: Array.isArray(d?.projects)
          ? d.projects.slice(0, 6).map((p: any) => ({
              title: p?.title || p?.name || null,
              role: p?.role || null,
              objective: p?.objective || p?.okrs?.[0]?.objective || null,
            }))
          : [],
      }))
    : [];

  return {
    // STAGE1: 企業価値分析
    mission: truncate(source.mission),
    vision: truncate(source.vision),
    value: truncate(source.value),
    ceoIntent: truncate(source.ceoIntent),
    // STAGE2: 全社戦略
    story: Array.isArray(source.story)
      ? source.story.slice(0, 2).map((s: any) => truncate(typeof s === 'string' ? s : s?.content || s?.body || s?.title, 700))
      : truncate(source.story),
    answers2: Array.isArray(source.answers2)
      ? source.answers2.slice(0, 3).map((a: any) => truncate(typeof a === 'string' ? a : a?.answer || a?.body || a?.content, 500))
      : null,
    winPatterns: Array.isArray(source.winPatterns) ? source.winPatterns.slice(0, 5).map((w: any) => truncate(w, 600)) : null,
    // STAGE3: 事業・部門別戦略
    finalStory: Array.isArray(source.finalStory)
      ? source.finalStory.slice(0, 2).map((s: any) => truncate(typeof s === 'string' ? s : s?.content || s?.body || s?.title, 700))
      : truncate(source.finalStory),
    departments,
    companyTargets: truncate(source.companyTargets || source.targets || source.okrs, 900),
    // その他
    financeSummary: truncate(source.financeSummary, 900),
    businessPortfolio: truncate(source.businessPortfolio, 900),
    executionPlans: Array.isArray(source.executionPlans) ? source.executionPlans.slice(0, 5).map((p: any) => truncate(p, 700)) : null,
  };
}

// STAGE1〜3の戦略情報が使可能か判定
function hasStage1Or2Or3StrategyContext(strategyContextForPrompt: any): boolean {
  if (!strategyContextForPrompt) return false;
  // STAGE1: mission / vision / value / ceoIntent
  const hasStage1 = !!(
    strategyContextForPrompt.mission ||
    strategyContextForPrompt.vision ||
    strategyContextForPrompt.value ||
    strategyContextForPrompt.ceoIntent
  );
  // STAGE2: story / answers2 / winPatterns（全社戦略）
  const hasStage2 = !!(
    strategyContextForPrompt.story ||
    strategyContextForPrompt.answers2 ||
    strategyContextForPrompt.winPatterns
  );
  // STAGE3: departments（部門戦略・ミッション・プロジェクト） / companyTargets（KPI判断基準）
  // ※ finalStory は全社ストーリーの最終版のため STAGE2由来と考える
  const hasStage3 = !!(
    (Array.isArray(strategyContextForPrompt.departments) && strategyContextForPrompt.departments.length > 0) ||
    strategyContextForPrompt.companyTargets
  );
  return hasStage1 || hasStage2 || hasStage3;
}

// すべての利用可能な戦略情報（含むSTAGE4以降）
function hasUsableStrategyContext(strategyContextForPrompt: any): boolean {
  if (!strategyContextForPrompt) return false;
  return (
    hasStage1Or2Or3StrategyContext(strategyContextForPrompt) ||
    strategyContextForPrompt.financeSummary ||
    strategyContextForPrompt.businessPortfolio
  );
}

function buildFallbackResult(args: {
  issueTypeLabel: string;
  companyRecognitionMode: CompanyRecognitionMode;
  situationText: string;
  myRecognitionText: string;
  idealText: string;
  expectationText: string;
}): OrgAlignmentResult {
  return {
    title: `${args.issueTypeLabel}に関する認識のズレ`,
    inputSummary: args.situationText,
    issueType: args.issueTypeLabel,
    participantRecognitionHypothesis:
      '関係者側には、限られた情報・時間・役割責任の中で現在の対応を合理的と捉えている可能性があります。一方で、入力者側はその前提や判断基準が共有されていないため、違和感を抱いています。',
    companyRecognitionMode: args.companyRecognitionMode,
    companyRecognitionTitle:
      args.companyRecognitionMode === 'strategy_based'
        ? '会社の方針に照らした、あるべき認識'
        : '会社として確認すべき認識',
    companyRecognition:
      args.companyRecognitionMode === 'strategy_based'
        ? '会社方針や戦略に照らすと、個人や部門を責めるのではなく、今回の違和感がどの判断基準・優先順位・役割責任・評価・支援のズレから生じているのかを確認し、現場が迷わず行動できる状態に整える必要があります。'
        : '現時点では会社方針や戦略情報との接続が十分ではないため、会社として何を優先し、どの判断基準で対応すべきかを確認する必要があります。',
    alignmentPoints: [
      '今回の違和感について、どの判断基準・優先順位・役割責任が揃っていないのか。',
      '関係者はそれぞれ何を重視して行動しているのか。',
      '会社として、今後どのような対応・支援・評価・情報共有を行うべきか。',
    ],
    recommendedNextAction: {
      title: '認識のズレに関するすり合わせの場の設定',
      detail:
        '入力内容をもとに、関係者間で判断基準・役割責任・優先順位・支援内容を確認する短いすり合わせの場を設けることを推奨します。',
    },
    riskLevel: 'medium',
    riskReason:
      '放置すると、現場の納得感低下、部門間の不信、戦略実行の遅れにつながる可能性があります。',
  };
}

/* ========== POST ========== */
export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const membership = await requireMembership(admin, userId);
    if (!membership) return json({ error: 'forbidden' }, 403);

    let payload: GeneratePayload;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const situationText = firstText(payload.situationText, payload.situation_text);
    const myRecognitionText = firstText(payload.myRecognitionText, payload.my_recognition_text);
    const idealText = firstText(payload.idealText, payload.ideal_text);
    const expectationText = firstText(payload.expectationText, payload.expectation_text);
    const counterpartyType = firstText(payload.counterpartyType, payload.counterparty_type, 'unknown');
    const counterpartyDetail = firstText(payload.counterpartyDetail, payload.counterparty_detail);
    const visibilityMode = firstText(payload.visibilityMode, payload.visibility_mode, 'manager_only');
    const strategyId = payload.strategyId;

    if (!situationText || !myRecognitionText || !idealText || !expectationText) {
      return json({ error: '入力フィールドが不足しています。' }, 400);
    }

    if (!strategyId) {
      return json({ error: '戦略IDが不足しています。' }, 400);
    }

    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ error: 'OPENAI_API_KEY が未設定です。' }, 500);

    let strategyData: any = null;
    let strategyFetchMethod: 'strategy_id' | 'not_found' = 'not_found';
    let strategyFetchError: string | null = null;

    // strategyId + companyId で直接取得（データ混在防止）
    if (strategyId && membership.companyId) {
      const { data, error } = await getFullStrategyDataByStrategyId(strategyId, membership.companyId);
      if (error) {
        strategyFetchError = error.message ?? String(error);
      } else if (data) {
        strategyData = data;
        strategyFetchMethod = 'strategy_id';
      }
    }

    // strategyData が取得できない場合はエラーを返す
    if (!strategyData) {
      const errorMsg = strategyFetchError || '戦略情報を取得できません。';
      return json({ error: errorMsg, detail: { strategyFetchError } }, 400);
    }

    const strategyContextForPrompt = buildStrategyContextForPrompt(strategyData, payload.strategyContext);
    // STAGE1〜3の情報がある場合のみ strategy_based。executionPlans だけでは needs_confirmation
    const companyRecognitionMode: CompanyRecognitionMode = hasStage1Or2Or3StrategyContext(strategyContextForPrompt)
      ? 'strategy_based'
      : 'needs_confirmation';

    const fallbackClassified = classifyConcernFallback(
      [situationText, myRecognitionText, idealText, expectationText, counterpartyDetail].join('\n'),
    );
    const concernType = normalizeConcernType(payload.concernType) !== 'unknown'
      ? normalizeConcernType(payload.concernType)
      : fallbackClassified;
    const issueTypeLabel = getIssueTypeLabel(concernType);
    const concernTypeInstruction = buildConcernTypeInstruction(concernType, issueTypeLabel);

    const companyRecognitionTitle =
      companyRecognitionMode === 'strategy_based'
        ? '会社の方針に照らした、あるべき認識'
        : '会社として確認すべき認識';

    const fallback = buildFallbackResult({
      issueTypeLabel,
      companyRecognitionMode,
      situationText,
      myRecognitionText,
      idealText,
      expectationText,
    });

    const systemPrompt = `あなたは、GROWTH SHIFTの「組織変革・違和感を伝えるルーム」で、社員の違和感を「認識のズレ」として構造化するAIです。

目的：
- 個人や部署を責めない。
- 不満や愚痴として扱わない。
- 方針・戦略、優先順位、役割責任、評価、意思決定、業務プロセス、育成・支援、顧客価値などにある「認識のズレ」として整理する。
- すり合わせの場で実際に確認できる問いに変換する。

重要ルール：
1. inputSummary は、入力者の違和感・困りごと・納得できていない点を、戦略用語に置き換えすぎず、まず本人にとって分かる言葉で受け止める。
2. STEP2 participantRecognitionHypothesis は、相手方・制度設計側・経営側・運用側の「あり得る認識仮説」として書く。断定しない。
3. STEP2では、相手側の行動・発言・判断が会社方針、部門戦略、KPI、重点施策、優先順位に関係している場合に限り、会社方針・戦略情報を判断材料として使う。その場合も「相手は戦略上こうするべき」と断定せず、「その戦略・KPI・優先順位を重視していた可能性がある」と仮説として書く。
4. 相手方が人や部門ではない場合、制度・仕組み・運用側・経営側の前提として整理する。
5. STEP3 companyRecognition は、会社としての判断基準・優先順位・役割責任・評価・支援・戦略実行に照らして書く。strategy_based の場合は、原則としてSTAGE1〜3の会社方針・全社戦略・部門方針・重点テーマ・KPI判断基準のいずれかを判断材料にする。
6. STEP3では、現場の不満を会社都合に従わせる表現にしない。「会社の戦略上こうすべき」ではなく、「この違和感は、会社として何を確認すべきズレか」に翻訳する。
7. STEP4 alignmentPoints は、抽象的な改善テーマではなく、すり合わせの場でそのまま確認できる「問い」にする。戦略用語を使いすぎず、現場・上司・管理者が会話できる言葉にする。
8. alignmentPoints は3〜5個。各項目は具体的な問いにする。
9. 会社や経営、上司、他部門を一方的に責める表現は禁止。
10. 入力者に過度に迎合せず、複数の立場の前提を整理する。
11. 出力は必ずJSONのみ。Markdownや説明文は出さない。

${concernTypeInstruction}

【会社方針・戦略情報の扱い】
companyRecognitionMode は必ず「${companyRecognitionMode}」にしてください。
companyRecognitionTitle は必ず「${companyRecognitionTitle}」にしてください。
${companyRecognitionMode === 'strategy_based'
  ? 'strategy_based のため、下記の会社方針・戦略情報を判断材料として使ってください。ただし、入力者の違和感を無理に戦略用語へ置き換えないでください。participantRecognitionHypothesis では、相手側の行動や発言が会社方針・部門戦略・KPI・重点施策・優先順位と関係する場合のみ、具体情報を自然に反映してください。companyRecognition では、STAGE1〜3の情報を踏まえ、「会社として何を確認すべきか」「どの判断基準・優先順位・役割責任・支援が揃っていない可能性があるか」を書いてください。alignmentPoints では、戦略用語を現場で話せる問いに噛み砕いてください。存在しない情報は捏造しないでください。'
  : 'needs_confirmation のため、会社方針・戦略情報が十分ではない前提で、会社として確認すべき判断基準を示してください。'}

【出力JSONスキーマ】
{
  "title": "短いタイトル",
  "inputSummary": "入力内容の要約",
  "issueType": "${issueTypeLabel}",
  "participantRecognitionHypothesis": "関係当事者・制度設計側・運用側の認識仮説",
  "companyRecognitionMode": "${companyRecognitionMode}",
  "companyRecognitionTitle": "${companyRecognitionTitle}",
  "companyRecognition": "会社としてあるべき認識または確認すべき認識",
  "alignmentPoints": ["すり合わせの場で確認できる問い", "..."],
  "recommendedNextAction": {
    "title": "次のアクション名",
    "detail": "具体的な説明"
  },
  "riskLevel": "low | medium | high",
  "riskReason": "リスク理由"
}`;

    const userPrompt = `【入力内容】
- どんな場面でもやもやしたか：${situationText}
- その時、自分はどう受け止めたか：${myRecognitionText}
- 本来どうあるべきだと思うか：${idealText}
- 相手・会社・仕組みに期待していたこと：${expectationText}
- 関係している相手・部門・仕組み：${counterpartyType}${counterpartyDetail ? ` / ${counterpartyDetail}` : ''}
- 共有範囲：${visibilityMode}
- intake側分類：${concernType}（${issueTypeLabel}）

【会社方針・戦略情報】
${strategyContextForPrompt ? JSON.stringify(strategyContextForPrompt, null, 2) : '利用可能な会社方針・戦略情報はありません。'}

上記をもとに、社員の違和感を「認識のズレ」として整理してください。`;

    // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
    const requestId = req.headers.get('x-request-id') || `req_${Date.now()}`;
    const hasCompanyInfo = !!strategyContextForPrompt?.mission;
    const hasStage1Context = !!(strategyContextForPrompt?.mission || strategyContextForPrompt?.vision);
    const hasStage2Answers = !!strategyContextForPrompt?.answers2;
    const hasStage2Story = !!strategyContextForPrompt?.story;
    const hasStage3Context = !!strategyContextForPrompt?.departments;
    const hasStage4Context = !!strategyContextForPrompt?.executionPlans;

    const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
    const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

    const suspiciousKeywords = checkSuspiciousKeywords(userPrompt);

    logInputGuard({
      requestId,
      apiName: 'org-alignment/generate',
      companyId: membership.companyId,
      strategyId: strategyId,
      meaningfulInputScore,
      hasCompanyInfo,
      hasStage1Context,
      hasStage2Answers,
      hasStage2Story,
      hasStage3Context,
      hasStage4Context,
      promptLength: userPrompt.length,
      suspiciousKeywordFlags: suspiciousKeywords,
    });

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? '';
    const parsed = safeJsonParse(content);
    let result = ensureResultShape(parsed, fallback);

    // サーバー側で重要フィールドを固定し、AIの分類ブレを防ぐ
    result = {
      ...result,
      issueType: issueTypeLabel,
      companyRecognitionMode,
      companyRecognitionTitle,
    };

    // STAGE別availability判定
    const stage1Available = !!(
      strategyContextForPrompt?.mission ||
      strategyContextForPrompt?.vision ||
      strategyContextForPrompt?.value ||
      strategyContextForPrompt?.ceoIntent
    );
    const stage2Available = !!(
      strategyContextForPrompt?.story ||
      strategyContextForPrompt?.answers2 ||
      strategyContextForPrompt?.winPatterns
    );
    // STAGE3: departments（部門戦略）/ companyTargets（KPI判断基準）
    // finalStory は全社ストーリー最終版のためSTAGE2由来と考える
    const stage3Available = !!(
      (Array.isArray(strategyContextForPrompt?.departments) && strategyContextForPrompt.departments.length > 0) ||
      strategyContextForPrompt?.companyTargets
    );
    const executionPlansAvailable = !!strategyContextForPrompt?.executionPlans;

    const debug = {
      concernType,
      issueTypeLabel,
      companyRecognitionMode,
      strategyDataExists: !!strategyData,
      strategyFetchMethod,
      strategyFetchError,
      hasUsableStrategyContext: hasUsableStrategyContext(strategyContextForPrompt),
      stage1Available,
      stage2Available,
      stage3Available,
      executionPlansAvailable,
      strategyContextFields: strategyContextForPrompt ? {
        // STAGE1
        mission: !!strategyContextForPrompt.mission,
        vision: !!strategyContextForPrompt.vision,
        value: !!strategyContextForPrompt.value,
        ceoIntent: !!strategyContextForPrompt.ceoIntent,
        // STAGE2
        story: !!strategyContextForPrompt.story,
        answers2: !!strategyContextForPrompt.answers2,
        winPatterns: !!strategyContextForPrompt.winPatterns,
        // STAGE3
        finalStory: !!strategyContextForPrompt.finalStory,
        departmentCount: Array.isArray(strategyContextForPrompt.departments) ? strategyContextForPrompt.departments.length : 0,
        companyTargets: !!strategyContextForPrompt.companyTargets,
        // その他
        financeSummary: !!strategyContextForPrompt.financeSummary,
        businessPortfolio: !!strategyContextForPrompt.businessPortfolio,
        executionPlans: !!strategyContextForPrompt.executionPlans,
      } : null,
    };

    return json({
      ...result,
      result,
      aiResult: result,
      debug,
    });
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    return json({ error: extractMessage(err) }, err?.status || 500);
  }
}
