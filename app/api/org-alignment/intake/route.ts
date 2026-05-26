// /app/api/org-alignment/intake/route.ts
import 'server-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const ROUTE_TAG = 'app/api/org-alignment/intake';
const MAX_FOLLOW_UP_COUNT = 2;

/* ========== types ========== */

type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

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

type IntakeDraft = {
  situation_text?: string;
  my_recognition_text?: string;
  ideal_text?: string;
  expectation_text?: string;
  counterparty_type?: CounterpartyType;
  counterparty_detail?: string;
};

type IntakeResponse = {
  assistantMessage: string;
  status: 'asking' | 'ready_for_review';
  draft: IntakeDraft;
  /** AIが追加質問を返した回数。ユーザー送信回数ではない。 */
  conversationRound: number;
  /** デバッグ・検証用。フロント側で使わなくても問題ありません。 */
  concernType?: OrgMisalignmentType;
};

type ChatMessage = {
  role: 'user' | 'assistant' | string;
  content: string;
};

type QuestionPriority =
  | 'department_cooperation_detail'
  | 'department_cooperation_impact'
  | 'challenge_detail'
  | 'challenge_risk_detail'
  | 'evaluation_target'
  | 'evaluation_ideal'
  | 'executive_policy_gap'
  | 'executive_policy_conflict'
  | 'authority_decision_point'
  | 'authority_expected_scope'
  | 'role_responsibility_target'
  | 'role_responsibility_ideal'
  | 'priority_conflict_target'
  | 'priority_conflict_ideal'
  | 'tool_reason'
  | 'tool_expectation'
  | 'communication_target'
  | 'communication_expectation'
  | 'workload_gap'
  | 'workload_adjustment'
  | 'business_process_target'
  | 'business_process_impact'
  | 'culture_scene'
  | 'culture_ideal'
  | 'talent_target'
  | 'talent_constraint'
  | 'skill_target'
  | 'skill_impact'
  | 'customer_market_target'
  | 'customer_market_impact'
  | 'kpi_goal_target'
  | 'kpi_goal_ideal'
  | 'change_resistance_target'
  | 'change_resistance_reason'
  | 'general_scene'
  | 'ideal'
  | 'expectation'
  | null;

type Assessment = {
  concernType: OrgMisalignmentType;
  isComplete: boolean;
  nextQuestionPriority: QuestionPriority;
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

function containsAny(text: string, terms: string[]): boolean {
  if (!text) return false;
  return terms.some((term) => text.includes(term));
}

function joinDraftText(draft: IntakeDraft): string {
  return [
    draft.situation_text,
    draft.my_recognition_text,
    draft.ideal_text,
    draft.expectation_text,
    draft.counterparty_detail,
  ]
    .filter(Boolean)
    .join(' ');
}

function historyToText(history: ChatMessage[], includeAssistant = false): string {
  return history
    .filter((m) => includeAssistant || m.role === 'user')
    .map((m) => m.content)
    .filter(Boolean)
    .join(' ');
}

function countUserMessages(history: ChatMessage[]): number {
  return history.filter((m) => m.role === 'user').length;
}

function isCounterpartyType(value: any): value is CounterpartyType {
  return [
    'executive',
    'manager',
    'own_department',
    'other_department',
    'backoffice',
    'field_member',
    'customer',
    'unknown',
    'other',
  ].includes(value);
}

function buildFinalizedDraft(currentDraft: IntakeDraft): IntakeDraft {
  return {
    ...currentDraft,
    situation_text: currentDraft.situation_text || '（必要に応じて追記してください）',
    my_recognition_text: currentDraft.my_recognition_text || '（必要に応じて追記してください）',
    ideal_text: currentDraft.ideal_text || '（必要に応じて追記してください）',
    expectation_text: currentDraft.expectation_text || '（必要に応じて追記してください）',
    counterparty_type: currentDraft.counterparty_type || 'unknown',
  };
}

function historyIncludesAny(history: ChatMessage[], terms: string[]): boolean {
  return history.some((m) => terms.some((term) => m.content.includes(term)));
}

function firstNotAsked(candidates: Array<QuestionPriority>, history: ChatMessage[]): QuestionPriority {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!wasPriorityAlreadyAsked(candidate, history)) return candidate;
  }
  return null;
}

/* ========== classification dictionaries ========== */

const DEPARTMENT_COOPERATION_TERMS = [
  '他部門',
  '関連部門',
  '部門間',
  '協力',
  '依頼',
  'お願い',
  '頼んだ',
  '頼んでも',
  '連携',
  '調整',
  '支援',
  '巻き込み',
  '共有してくれない',
  '動いてくれない',
  '自分たちの仕事ではない',
];

const CHALLENGE_TERMS = [
  '挑戦',
  '新しい施策',
  '新しい取り組み',
  '失敗',
  '失敗が許されない',
  '責任を問われる',
  '思い切った行動',
  'リスク',
  'チャレンジ',
];

const EVALUATION_TERMS = [
  '評価',
  '人事評価',
  '評価制度',
  '処遇',
  '報酬',
  '査定',
  '成果しか',
  '既存業務',
  '評価されない',
  '反映されない',
  '公平',
  '不公平',
];

const EXECUTIVE_POLICY_TERMS = [
  '経営',
  '経営者',
  '経営層',
  '会社方針',
  '方針',
  '戦略',
  '現場',
  '実情',
  '実態',
  '指示',
  '判断',
  '本気',
  '見ていない',
  '理解していない',
  '無理な指示',
  'トップ',
];

const AUTHORITY_DECISION_TERMS = [
  '権限',
  '判断権限',
  '承認',
  '決裁',
  '稟議',
  '上司の承認',
  '確認ばかり',
  '意思決定',
  '決められない',
];

const ROLE_RESPONSIBILITY_TERMS = [
  '役割',
  '責任',
  '役割責任',
  '誰が責任',
  '責任範囲',
  '曖昧',
  '押し付け',
  '仕事が回ってくる',
];

const PRIORITY_CONFLICT_TERMS = [
  '優先順位',
  '優先度',
  '後回し',
  '大事と言う',
  '重要プロジェクト',
  '全社優先',
  '部門優先',
];

const TOOL_OR_PROCESS_TERMS = [
  'GROWTH SHIFT',
  'GROWTHSHIFT',
  'ツール',
  'システム',
  '仕組み',
  '入力しても',
  '意味があるのか',
  '意味がない',
  '会社は変わらない',
  '使っても',
  '導入',
  '効果がない',
];

const COMMUNICATION_TERMS = [
  '説明',
  '説明不足',
  '共有されない',
  '情報共有',
  '背景',
  '理由が分からない',
  '決まったことだけ',
  '伝わらない',
  '納得感がない',
];

const WORKLOAD_RESOURCE_TERMS = [
  '人が足りない',
  '人員',
  '時間がない',
  '忙しい',
  '負荷',
  'リソース',
  '余裕がない',
  '通常業務',
  '残業',
  '業務量',
];

const BUSINESS_PROCESS_EFFICIENCY_TERMS = [
  '業務プロセス',
  '業務フロー',
  '効率',
  '非効率',
  '無駄',
  '二重入力',
  '手作業',
  '属人化',
  '承認フロー',
  '申請',
  '稟議',
  '会議',
  '報告',
  '資料作成',
  '入力作業',
  '転記',
  '確認作業',
  '待ち時間',
  '処理に時間',
  'システムが分断',
  '情報がつながらない',
  '同じことを何度も',
  '改善提案',
  '自動化',
  '標準化',
  '簡素化',
];

const CULTURE_MOTIVATION_TERMS = [
  '風土',
  '雰囲気',
  '空気',
  'やる気',
  'モチベーション',
  '前向き',
  '主体的',
  '自律',
  '指示待ち',
  '諦め',
  'どうせ',
  '変わらない',
  '心理的安全性',
  '意見を言いにくい',
  '挑戦しにくい',
  '萎縮',
  '閉塞感',
];

const TALENT_DEVELOPMENT_TERMS = [
  '育成',
  '人材育成',
  '若手',
  '部下',
  '後輩',
  '教育',
  '研修',
  'OJT',
  '成長',
  '成長機会',
  '任せる',
  'フィードバック',
  '1on1',
  'マネジメント',
  '管理職育成',
  '育たない',
  '教える時間',
];

const SKILL_CAPABILITY_TERMS = [
  'スキル',
  '能力',
  '知識',
  '経験',
  '専門性',
  'ノウハウ',
  'リテラシー',
  'DX',
  'デジタル',
  'データ活用',
  '分析',
  '営業力',
  '提案力',
  'マネジメント力',
  '技術力',
  '企画力',
  '不足',
  'ついていけない',
  '分からない',
  'できない',
];

const CUSTOMER_MARKET_TERMS = [
  '顧客',
  'お客様',
  '市場',
  '市場変化',
  '顧客ニーズ',
  'ニーズ',
  '競合',
  '顧客価値',
  '顧客対応',
  '売ろうとしている',
  '求めていること',
  '社内ルールが優先',
];

const KPI_GOAL_TERMS = [
  'KPI',
  'OKR',
  '目標',
  '部門目標',
  '数値目標',
  '短期業績',
  '長期戦略',
  '長期的',
  '短期的',
  '指標',
  '目標設計',
  '売上件数',
];

const CHANGE_RESISTANCE_TERMS = [
  '前例',
  '今までのやり方',
  'これまでのやり方',
  '昔のやり方',
  '過去の成功体験',
  '変化',
  '変えようとしない',
  '変えられない',
  '抵抗',
  '新しいやり方',
  '前例がない',
];

const DEPARTMENT_DETAIL_HINTS = [
  '営業',
  '製造',
  '開発',
  '人事',
  '総務',
  '経理',
  '財務',
  'マーケ',
  '企画',
  '管理',
  '店舗',
  '現場',
  '部',
  '課',
  'チーム',
  '納期',
  '回答',
  '資料',
  'データ',
  '顧客',
  '案件',
  '見積',
  '会議',
  '確認',
  '承認',
  '調査',
  '分析',
  '説明',
  '準備',
];

const ACTION_CONCRETE_HINTS = [
  '顧客',
  '案件',
  '提案',
  '価格',
  '納期',
  '資料',
  '会議',
  'プロジェクト',
  '施策',
  '営業',
  '製造',
  '開発',
  '業務',
  '作業',
  'システム',
  'データ',
  'DX',
  '新規',
  '既存',
];

const RISK_DETAIL_HINTS = [
  '失注',
  '減点',
  '査定',
  '責任者',
  '判断ミス',
  '準備不足',
  '怒られる',
  '責任追及',
  '評価低下',
  '降格',
];

const IMPACT_HINTS = [
  '支障',
  '遅れ',
  '困った',
  '顧客',
  '納期',
  '対応できない',
  '進まない',
  '負担',
  '抱え込',
  'ミス',
  '時間',
  '手戻り',
  'クレーム',
];

const CONCRETE_SCENE_HINTS = [
  '会議',
  '面談',
  '朝礼',
  '上司',
  '顧客',
  '案件',
  'プロジェクト',
  '指示',
  '方針',
  '施策',
  '業務',
  '評価',
  '目標',
  'KPI',
  'OKR',
  '承認',
  '納期',
  '資料',
  '提案',
  '現場',
  '経営',
];

/* ========== classification ========== */

function classifyConcern(text: string): OrgMisalignmentType {
  if (!text) return 'unknown';

  // 経営×現場は、協力・仕組みよりも優先して executive_policy にする。
  if (
    containsAny(text, ['経営', '経営者', '経営層', 'トップ']) &&
    containsAny(text, ['現場', '実情', '実態', '見ていない', '理解していない', '本気', '方針', '指示'])
  ) {
    return 'executive_policy';
  }

  // 目標・KPIは戦略実行上のズレとして優先的に扱う。
  if (containsAny(text, KPI_GOAL_TERMS)) return 'kpi_goal_misalignment';
  if (containsAny(text, CUSTOMER_MARKET_TERMS)) return 'customer_market_gap';
  if (containsAny(text, CHANGE_RESISTANCE_TERMS)) return 'change_resistance';
  if (containsAny(text, BUSINESS_PROCESS_EFFICIENCY_TERMS)) return 'business_process_efficiency';
  if (containsAny(text, TALENT_DEVELOPMENT_TERMS)) return 'talent_development';
  if (containsAny(text, SKILL_CAPABILITY_TERMS)) return 'skill_capability_gap';
  if (containsAny(text, CULTURE_MOTIVATION_TERMS)) return 'culture_motivation';
  if (containsAny(text, TOOL_OR_PROCESS_TERMS)) return 'tool_or_process_distrust';
  if (containsAny(text, DEPARTMENT_COOPERATION_TERMS)) return 'department_cooperation';
  if (containsAny(text, CHALLENGE_TERMS)) return 'challenge_and_failure';
  if (containsAny(text, EVALUATION_TERMS)) return 'evaluation_system';
  if (containsAny(text, AUTHORITY_DECISION_TERMS)) return 'authority_decision';
  if (containsAny(text, ROLE_RESPONSIBILITY_TERMS)) return 'role_responsibility';
  if (containsAny(text, PRIORITY_CONFLICT_TERMS)) return 'priority_conflict';
  if (containsAny(text, COMMUNICATION_TERMS)) return 'communication_gap';
  if (containsAny(text, WORKLOAD_RESOURCE_TERMS)) return 'workload_resource';
  if (containsAny(text, EXECUTIVE_POLICY_TERMS)) return 'executive_policy';

  return 'unknown';
}

function resolveConcernType(latestUserMessage: string, contextText: string): OrgMisalignmentType {
  const latestType = classifyConcern(latestUserMessage);
  const contextType = classifyConcern(contextText);

  // 最新入力で分類できる場合は必ず最新入力を優先。
  // これにより、前回のdraftやhistoryに含まれる「協力」等に引っ張られる誤分類を防ぐ。
  if (latestType !== 'unknown') return latestType;
  return contextType;
}

/* ========== question history guards ========== */

function wasPriorityAlreadyAsked(priority: QuestionPriority, history: ChatMessage[]): boolean {
  switch (priority) {
    case 'department_cooperation_detail':
      return historyIncludesAny(history, ['その協力とは', 'どのような対応や作業をお願いした']);
    case 'department_cooperation_impact':
      return historyIncludesAny(history, ['協力が得られなかったことで', 'どのような支障']);
    case 'challenge_detail':
      return historyIncludesAny(history, ['その「挑戦」', 'どのような施策・提案・行動']);
    case 'challenge_risk_detail':
      return historyIncludesAny(history, ['失敗した場合', 'どのような評価低下や責任追及']);
    case 'evaluation_target':
      return historyIncludesAny(history, ['どのような新しい取り組みや行動', '評価に反映されていない']);
    case 'evaluation_ideal':
      return historyIncludesAny(history, ['結果以外にどのような行動やプロセス']);
    case 'executive_policy_gap':
      return historyIncludesAny(history, ['経営が現場の実情を見ていない', '経営が求めていることと、現場']);
    case 'executive_policy_conflict':
      return historyIncludesAny(history, ['短期的な成果や日々の業務とぶつかる']);
    case 'authority_decision_point':
      return historyIncludesAny(history, ['どのような判断や承認で止まりやすい']);
    case 'authority_expected_scope':
      return historyIncludesAny(history, ['どの範囲の判断権限']);
    case 'role_responsibility_target':
      return historyIncludesAny(history, ['どの業務や判断について', '役割・責任なのかが曖昧']);
    case 'role_responsibility_ideal':
      return historyIncludesAny(history, ['誰がどこまで責任を持つべき']);
    case 'priority_conflict_target':
      return historyIncludesAny(history, ['どのプロジェクトや業務について', '優先順位がズレ']);
    case 'priority_conflict_ideal':
      return historyIncludesAny(history, ['会社としてどのような優先順位']);
    case 'tool_reason':
      return historyIncludesAny(history, ['そう感じたのは、どのような理由や経験']);
    case 'tool_expectation':
      return historyIncludesAny(history, ['入力した内容がどのように扱われれば']);
    case 'communication_target':
      return historyIncludesAny(history, ['どの方針や決定について', '説明が不足']);
    case 'communication_expectation':
      return historyIncludesAny(history, ['どのような背景や判断理由']);
    case 'workload_gap':
      return historyIncludesAny(history, ['新しく求められていることと', '現在の業務負荷']);
    case 'workload_adjustment':
      return historyIncludesAny(history, ['何を減らす・調整する必要']);
    case 'business_process_target':
      return historyIncludesAny(history, ['どの作業・承認・情報共有・システム利用']);
    case 'business_process_impact':
      return historyIncludesAny(history, ['その非効率によって']);
    case 'culture_scene':
      return historyIncludesAny(history, ['どのような場面や周囲の反応']);
    case 'culture_ideal':
      return historyIncludesAny(history, ['どのような雰囲気や関わり方']);
    case 'talent_target':
      return historyIncludesAny(history, ['誰のどのような成長や育成']);
    case 'talent_constraint':
      return historyIncludesAny(history, ['育成が進まない原因']);
    case 'skill_target':
      return historyIncludesAny(history, ['どの業務や取り組みに対して', 'スキルや知識']);
    case 'skill_impact':
      return historyIncludesAny(history, ['スキル不足によって']);
    case 'customer_market_target':
      return historyIncludesAny(history, ['顧客や市場のどの変化']);
    case 'customer_market_impact':
      return historyIncludesAny(history, ['顧客対応や売上、競争力']);
    case 'kpi_goal_target':
      return historyIncludesAny(history, ['どの目標やKPIについて']);
    case 'kpi_goal_ideal':
      return historyIncludesAny(history, ['どのような指標や目標設計']);
    case 'change_resistance_target':
      return historyIncludesAny(history, ['どのような新しいやり方や変化']);
    case 'change_resistance_reason':
      return historyIncludesAny(history, ['前例やこれまでのやり方が優先']);
    case 'general_scene':
      return historyIncludesAny(history, ['具体的にはどのような場面']);
    case 'ideal':
      return historyIncludesAny(history, ['本来は、会社として', '本来どうあるべき']);
    case 'expectation':
      return historyIncludesAny(history, ['具体的にどのような対応を期待']);
    default:
      return false;
  }
}

/* ========== assessment ========== */

function assessCompletenessByType(params: {
  draft: IntakeDraft;
  history: ChatMessage[];
  latestUserMessage: string;
  isFirstInput: boolean;
  concernType: OrgMisalignmentType;
}): Assessment {
  const { draft, history, latestUserMessage, isFirstInput, concernType } = params;

  const draftText = joinDraftText(draft);
  const allText = [latestUserMessage, draftText, historyToText(history)].filter(Boolean).join(' ');

  const hasSituation = !!draft.situation_text?.trim();
  const hasRecognition = !!draft.my_recognition_text?.trim();
  const hasIdeal = !!draft.ideal_text?.trim();
  const hasExpectation = !!draft.expectation_text?.trim();
  const hasConcreteScene = containsAny(allText, CONCRETE_SCENE_HINTS);

  let nextQuestionPriority: QuestionPriority = null;

  switch (concernType) {
    case 'department_cooperation': {
      const hasDetail = containsAny(allText, DEPARTMENT_DETAIL_HINTS) && containsAny(allText, ['協力', '依頼', 'お願い', '回答', '調整', '対応', '共有', '確認']);
      const hasImpact = containsAny(allText, IMPACT_HINTS);
      nextQuestionPriority = firstNotAsked(
        [
          !hasDetail ? 'department_cooperation_detail' : null,
          !hasImpact ? 'department_cooperation_impact' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'challenge_and_failure': {
      const hasChallengeDetail = containsAny(allText, ACTION_CONCRETE_HINTS);
      const hasRiskConcern = containsAny(allText, ['評価', '責任', '失敗', '怒られる', '減点']);
      const hasRiskDetail = containsAny(allText, RISK_DETAIL_HINTS);
      nextQuestionPriority = firstNotAsked(
        [
          !hasChallengeDetail ? 'challenge_detail' : null,
          hasRiskConcern && !hasRiskDetail ? 'challenge_risk_detail' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'evaluation_system': {
      const hasEvaluationTarget = containsAny(allText, ACTION_CONCRETE_HINTS) || containsAny(allText, ['成果', '行動', 'プロセス', '既存業務', '新しい取り組み', '貢献', '負担']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasEvaluationTarget ? 'evaluation_target' : null,
          !hasIdeal ? 'evaluation_ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'executive_policy': {
      const hasPolicyGap =
        containsAny(allText, ['方針', '指示', '戦略', '目標', '現場', '実情', '実態', '見ていない', '理解していない', '本気']) &&
        containsAny(allText, ['具体', '短期', '長期', '業績', '無理', '足りない', 'できない', '難しい', '実際']);
      const hasConflict = containsAny(allText, ['短期', '長期', '日々の業務', '業績', '成果', '通常業務', '現場負荷']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasPolicyGap ? 'executive_policy_gap' : null,
          !hasConflict ? 'executive_policy_conflict' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'authority_decision': {
      const hasDecisionPoint = containsAny(allText, ['承認', '決裁', '稟議', '判断', '確認', '上司', '会議']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasDecisionPoint ? 'authority_decision_point' : null,
          !hasIdeal ? 'authority_expected_scope' : null,
        ],
        history
      );
      break;
    }

    case 'role_responsibility': {
      const hasRoleTarget = containsAny(allText, ['業務', '判断', '責任', '役割', '担当', '誰が']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasRoleTarget ? 'role_responsibility_target' : null,
          !hasIdeal ? 'role_responsibility_ideal' : null,
        ],
        history
      );
      break;
    }

    case 'priority_conflict': {
      const hasPriorityTarget = containsAny(allText, ['プロジェクト', '業務', '部門', '全社', '会社', '目標', 'KPI', 'OKR']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasPriorityTarget ? 'priority_conflict_target' : null,
          !hasIdeal ? 'priority_conflict_ideal' : null,
        ],
        history
      );
      break;
    }

    case 'tool_or_process_distrust': {
      const hasReason = containsAny(allText, ['理由', '経験', 'これまで', '過去', '導入', '成果', '効果', '変わらない', '変化がない', '意味がない']);
      const hasExpectationForTool = containsAny(allText, ['扱われれば', '反映', '活用', 'フィードバック', '対応', '改善', '見える', '共有']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasReason ? 'tool_reason' : null,
          !hasExpectationForTool ? 'tool_expectation' : null,
        ],
        history
      );
      break;
    }

    case 'communication_gap': {
      const hasCommunicationTarget = containsAny(allText, ['方針', '決定', '背景', '理由', '情報', '共有', '説明']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasCommunicationTarget ? 'communication_target' : null,
          !hasIdeal ? 'communication_expectation' : null,
        ],
        history
      );
      break;
    }

    case 'workload_resource': {
      const hasWorkloadGap = containsAny(allText, ['新しく', '求められている', '通常業務', '人', '時間', '負荷', '目標', '業務量']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasWorkloadGap ? 'workload_gap' : null,
          !hasIdeal ? 'workload_adjustment' : null,
        ],
        history
      );
      break;
    }

    case 'business_process_efficiency': {
      const hasProcessTarget = containsAny(allText, ['作業', '承認', '情報共有', 'システム', '入力', '転記', '会議', '報告', '資料', '業務フロー', 'プロセス']);
      const hasProcessImpact = containsAny(allText, ['時間', 'ミス', '顧客', '連携', '手戻り', '遅れ', '負担']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasProcessTarget ? 'business_process_target' : null,
          !hasProcessImpact ? 'business_process_impact' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'culture_motivation': {
      const hasCultureScene = containsAny(allText, ['場面', '会議', '発言', '反応', '空気', '雰囲気', '周囲', '上司', '職場']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasCultureScene ? 'culture_scene' : null,
          !hasIdeal ? 'culture_ideal' : null,
        ],
        history
      );
      break;
    }

    case 'talent_development': {
      const hasTalentTarget = containsAny(allText, ['若手', '部下', '後輩', '管理職', '誰', '育成', '成長', '研修', 'OJT']);
      const hasTalentConstraint = containsAny(allText, ['時間', '仕組み', '役割', '教え方', '評価', '現場任せ']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasTalentTarget ? 'talent_target' : null,
          !hasTalentConstraint ? 'talent_constraint' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'skill_capability_gap': {
      const hasSkillTarget = containsAny(allText, ['業務', '取り組み', 'DX', 'データ', '分析', '営業', '提案', '管理職', '技術', '企画']);
      const hasSkillImpact = containsAny(allText, ['支障', '不安', '進まない', '混乱', 'できない', '品質', '遅れ']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasSkillTarget ? 'skill_target' : null,
          !hasSkillImpact ? 'skill_impact' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'customer_market_gap': {
      const hasCustomerMarketTarget = containsAny(allText, ['顧客', '市場', 'ニーズ', '競合', '顧客価値', '変化']);
      const hasCustomerImpact = containsAny(allText, ['売上', '対応', '競争力', '失注', '満足', '選ばれない', '社内ルール']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasCustomerMarketTarget ? 'customer_market_target' : null,
          !hasCustomerImpact ? 'customer_market_impact' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'kpi_goal_misalignment': {
      const hasKpiTarget = containsAny(allText, ['KPI', 'OKR', '目標', '指標', '短期', '長期', '売上', '部門目標']);
      const hasKpiIdeal = containsAny(allText, ['本来', '反映', '評価', '優先', 'つながる', '整合']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasKpiTarget ? 'kpi_goal_target' : null,
          !hasKpiIdeal ? 'kpi_goal_ideal' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    case 'change_resistance': {
      const hasChangeTarget = containsAny(allText, ['新しいやり方', '変化', '改善', '提案', '前例', '今までのやり方', '過去']);
      const hasResistanceReason = containsAny(allText, ['優先', '止められる', '抵抗', '進まない', '理由', '前例がない']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasChangeTarget ? 'change_resistance_target' : null,
          !hasResistanceReason ? 'change_resistance_reason' : null,
          !hasIdeal ? 'ideal' : null,
        ],
        history
      );
      break;
    }

    default: {
      nextQuestionPriority = firstNotAsked(
        [
          !hasConcreteScene ? 'general_scene' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }
  }

  // 初回入力だけで整理カードに進ませない。ただし、かなり具体的な入力なら例外的に完了可。
  const hasBasicEnough = hasSituation && (hasRecognition || hasExpectation || hasIdeal);
  const isComplete = isFirstInput
    ? hasBasicEnough && hasConcreteScene && nextQuestionPriority === null
    : nextQuestionPriority === null;

  return {
    concernType,
    isComplete,
    nextQuestionPriority,
  };
}

/* ========== question generation ========== */

function generateQuestionByType(priority: QuestionPriority): string {
  switch (priority) {
    case 'department_cooperation_detail':
      return 'その協力とは、具体的にはどの部門に、どのような対応や作業をお願いしたものですか？';
    case 'department_cooperation_impact':
      return 'その協力が得られなかったことで、顧客対応や業務にどのような支障が出ましたか？';
    case 'challenge_detail':
      return 'その「挑戦」とは、具体的にはどのような施策・提案・行動のことですか？';
    case 'challenge_risk_detail':
      return '失敗した場合、どのような評価低下や責任追及が起きると感じましたか？';
    case 'evaluation_target':
      return 'どのような新しい取り組みや行動が、評価に反映されていないと感じましたか？';
    case 'evaluation_ideal':
      return '本来、結果以外にどのような行動やプロセスも評価されるべきだと思いますか？';
    case 'executive_policy_gap':
      return '経営が現場の実情を見ていないと感じたのは、具体的にどのような方針・指示・判断の場面ですか？';
    case 'executive_policy_conflict':
      return 'その方針を実行しようとすると、現場で求められる短期的な成果や日々の業務とぶつかる場面はありますか？';
    case 'authority_decision_point':
      return 'どのような判断や承認で止まりやすいと感じていますか？';
    case 'authority_expected_scope':
      return '本来、現場にどの範囲の判断権限があるべきだと思いますか？';
    case 'role_responsibility_target':
      return 'どの業務や判断について、誰の役割・責任なのかが曖昧だと感じましたか？';
    case 'role_responsibility_ideal':
      return '本来は、誰がどこまで責任を持つべきだと思いますか？';
    case 'priority_conflict_target':
      return 'どのプロジェクトや業務について、部門間で優先順位がズレていると感じましたか？';
    case 'priority_conflict_ideal':
      return '本来、会社としてどのような優先順位で扱うべきだと思いますか？';
    case 'tool_reason':
      return 'そう感じたのは、どのような理由や経験からですか？';
    case 'tool_expectation':
      return '入力した内容がどのように扱われれば、この仕組みに意味があると感じられそうですか？';
    case 'communication_target':
      return 'どの方針や決定について、説明が不足していると感じましたか？';
    case 'communication_expectation':
      return 'どのような背景や判断理由が共有されれば、納得しやすいと感じますか？';
    case 'workload_gap':
      return '新しく求められていることと、現在の業務負荷のどこに無理があると感じましたか？';
    case 'workload_adjustment':
      return '本来、何を減らす・調整する必要があると思いますか？';
    case 'business_process_target':
      return '具体的には、どの作業・承認・情報共有・システム利用のどこに非効率を感じていますか？';
    case 'business_process_impact':
      return 'その非効率によって、時間・ミス・顧客対応・部門間連携などにどのような影響が出ていますか？';
    case 'culture_scene':
      return 'そう感じたのは、具体的にどのような場面や周囲の反応からですか？';
    case 'culture_ideal':
      return '本来は、どのような雰囲気や関わり方があれば、前向きに動きやすいと感じますか？';
    case 'talent_target':
      return '誰のどのような成長や育成について、期待と実態がズレていると感じていますか？';
    case 'talent_constraint':
      return 'その育成が進まない原因は、時間・役割分担・教え方・評価・仕組みのどこにあると感じますか？';
    case 'skill_target':
      return 'どの業務や取り組みに対して、どのようなスキルや知識が不足していると感じますか？';
    case 'skill_impact':
      return 'そのスキル不足によって、実際にどのような支障や不安が出ていますか？';
    case 'customer_market_target':
      return '顧客や市場のどの変化に対して、会社の方針や対応がズレていると感じましたか？';
    case 'customer_market_impact':
      return 'そのズレによって、顧客対応や売上、競争力にどのような影響が出ていると感じますか？';
    case 'kpi_goal_target':
      return 'どの目標やKPIについて、会社の方針や現場の実態とズレていると感じましたか？';
    case 'kpi_goal_ideal':
      return '本来は、どのような指標や目標設計であれば、会社の方針と現場の行動がつながると思いますか？';
    case 'change_resistance_target':
      return 'どのような新しいやり方や変化が、これまでのやり方や前例によって進みにくくなっていると感じましたか？';
    case 'change_resistance_reason':
      return '前例やこれまでのやり方が優先される背景には、どのような不安や判断基準があると感じますか？';
    case 'general_scene':
      return '具体的には、どのような場面でその違和感を感じましたか？';
    case 'ideal':
      return '本来は、会社としてどのように判断・対応してほしいと感じましたか？';
    case 'expectation':
      return '関係する相手・部門・仕組みには、具体的にどのような対応を期待していましたか？';
    default:
      return '';
  }
}

async function generateFollowUpQuestion(params: {
  history: ChatMessage[];
  currentDraft: IntakeDraft;
  followUpCount: number;
  isFirstInput: boolean;
  latestUserMessage: string;
  concernType: OrgMisalignmentType;
}): Promise<{ question: string; draft: IntakeDraft; concernType: OrgMisalignmentType }> {
  const { history, currentDraft, followUpCount, isFirstInput, latestUserMessage, concernType } = params;

  const assessment = assessCompletenessByType({
    draft: currentDraft,
    history,
    latestUserMessage,
    isFirstInput,
    concernType,
  });

  if (followUpCount >= MAX_FOLLOW_UP_COUNT || assessment.isComplete || !assessment.nextQuestionPriority) {
    return { question: '', draft: buildFinalizedDraft(currentDraft), concernType: assessment.concernType };
  }

  return {
    question: generateQuestionByType(assessment.nextQuestionPriority),
    draft: currentDraft,
    concernType: assessment.concernType,
  };
}

/* ========== OpenAI extraction/finalization ========== */

async function extractDraftFromInput(
  openai: OpenAI,
  userInput: string,
  currentDraft: IntakeDraft,
  concernType: OrgMisalignmentType
): Promise<IntakeDraft> {
  const systemPrompt = `あなたは、社員の違和感を「認識のズレ」として整理するための入力補助AIです。
ユーザー入力から、整理カードに必要な情報を抽出してください。

重要：
- 既存draftは同じ対話内の文脈として扱います。
- 最新入力にない過去の別テーマを混ぜないでください。
- 個人や部門を責める表現ではなく、認識のズレとして扱えるように抽出してください。

分類：${concernType}

抽出対象：
{
  "situation_text": "具体的な場面・背景・状況",
  "my_recognition_text": "ユーザーがその状況をどう受け止めているか",
  "ideal_text": "ユーザーが理想と考えている状態・本来あるべき姿",
  "expectation_text": "相手方や会社・仕組みに対する期待・確認したいこと",
  "counterparty_type": "executive" | "manager" | "own_department" | "other_department" | "backoffice" | "field_member" | "customer" | "unknown" | "other",
  "counterparty_detail": "相手・部門・仕組み・制度・方針などの詳細"
}

出力はJSONのみ。抽出できない項目は省略してください。`;

  const userPrompt = `ユーザー入力：
${userInput}

現在のdraft：
${JSON.stringify(currentDraft, null, 2)}

上記の最新入力を反映したdraftを返してください。JSONのみを返してください。`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const extracted = JSON.parse(responseText);

    return {
      ...currentDraft,
      ...(typeof extracted.situation_text === 'string' && extracted.situation_text.trim()
        ? { situation_text: extracted.situation_text.trim() }
        : {}),
      ...(typeof extracted.my_recognition_text === 'string' && extracted.my_recognition_text.trim()
        ? { my_recognition_text: extracted.my_recognition_text.trim() }
        : {}),
      ...(typeof extracted.ideal_text === 'string' && extracted.ideal_text.trim()
        ? { ideal_text: extracted.ideal_text.trim() }
        : {}),
      ...(typeof extracted.expectation_text === 'string' && extracted.expectation_text.trim()
        ? { expectation_text: extracted.expectation_text.trim() }
        : {}),
      ...(isCounterpartyType(extracted.counterparty_type)
        ? { counterparty_type: extracted.counterparty_type }
        : {}),
      ...(typeof extracted.counterparty_detail === 'string' && extracted.counterparty_detail.trim()
        ? { counterparty_detail: extracted.counterparty_detail.trim() }
        : {}),
    };
  } catch {
    return currentDraft;
  }
}

async function finalizeDraftForReview(
  openai: OpenAI,
  conversationHistory: ChatMessage[],
  currentDraft: IntakeDraft,
  concernType: OrgMisalignmentType
): Promise<IntakeDraft> {
  const systemPrompt = `あなたは、社員の違和感を「認識のズレ」として整理するための入力補助AIです。
チャット履歴と現在のdraftをもとに、整理カードに表示する文面を自然な日本語で補完してください。

目的：
- ユーザーが整理カードで「自分が言いたかったことはこれだ」と確認・修正しやすくすること。
- 個人や部門を責める表現ではなく、認識のズレとして扱える文面にすること。

現在の分類：${concernType}

出力JSON：
{
  "situation_text": string,
  "my_recognition_text": string,
  "ideal_text": string,
  "expectation_text": string,
  "counterparty_type": "executive" | "manager" | "own_department" | "other_department" | "backoffice" | "field_member" | "customer" | "unknown" | "other",
  "counterparty_detail": string
}

補完ルール：
- draftに既に具体情報がある場合は、その情報を必ず活かす。
- 空欄がある場合でも、チャット履歴から自然に推測できる範囲で補完する。
- 事実を捏造しない。チャットにない会社方針、制度、人物名、固有名詞は追加しない。
- 断定しすぎず、「感じた」「と思う」「期待していた」など、ユーザーの認識として表現する。
- 人や組織風土そのものを問題視せず、方針・優先順位・役割責任・評価・意思決定・育成・支援・業務設計・仕組みとのズレとして整理する。
- tool_or_process_distrust の場合は、無理に個人や部門の相手を作らず、counterparty_type は 'other' または 'unknown'、counterparty_detail は「GROWTH SHIFT」「仕組み」「システム」などにする。
- executive_policy の場合は、counterparty_type は 'executive' を優先し、counterparty_detail は「経営」「経営層」「会社方針」などにする。
- JSONのみを返す。`;

  const userPrompt = `チャット履歴：
${conversationHistory
  .map((m) => `${m.role === 'assistant' ? 'AI' : 'ユーザー'}: ${m.content}`)
  .join('\n')}

現在のdraft：
${JSON.stringify(currentDraft, null, 2)}

上記をもとに、整理カード用のdraftを補完してください。JSONのみを返してください。`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const completed = JSON.parse(responseText);

    const merged: IntakeDraft = {
      ...currentDraft,
      ...(typeof completed.situation_text === 'string' && completed.situation_text.trim()
        ? { situation_text: completed.situation_text.trim() }
        : {}),
      ...(typeof completed.my_recognition_text === 'string' && completed.my_recognition_text.trim()
        ? { my_recognition_text: completed.my_recognition_text.trim() }
        : {}),
      ...(typeof completed.ideal_text === 'string' && completed.ideal_text.trim()
        ? { ideal_text: completed.ideal_text.trim() }
        : {}),
      ...(typeof completed.expectation_text === 'string' && completed.expectation_text.trim()
        ? { expectation_text: completed.expectation_text.trim() }
        : {}),
      ...(isCounterpartyType(completed.counterparty_type)
        ? { counterparty_type: completed.counterparty_type }
        : {}),
      ...(typeof completed.counterparty_detail === 'string' && completed.counterparty_detail.trim()
        ? { counterparty_detail: completed.counterparty_detail.trim() }
        : {}),
    };

    return buildFinalizedDraft(merged);
  } catch {
    return buildFinalizedDraft(currentDraft);
  }
}

/* ========== POST ========== */

export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }

    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const {
      userMessage,
      conversationHistory = [],
      currentDraft = {},
      conversationRound = 0,
    } = payload;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return json({ error: 'userMessage is required' }, 400);
    }

    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ error: 'OPENAI_API_KEY が未設定です。' }, 500);

    const openai = new OpenAI({ apiKey });

    const safeHistory: ChatMessage[] = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content),
          }))
      : [];

    const latestUserMessage = userMessage.trim();
    const isNewConversation = countUserMessages(safeHistory) === 0;

    // 新規ヒアリングでは、前回のdraftがフロントに残っていても混ぜない。
    const effectiveCurrentDraft: IntakeDraft = isNewConversation ? {} : currentDraft;

    const contextText = [
      joinDraftText(effectiveCurrentDraft),
      historyToText(safeHistory),
      latestUserMessage,
    ]
      .filter(Boolean)
      .join(' ');

    const concernType = resolveConcernType(latestUserMessage, contextText);

    const updatedDraft = await extractDraftFromInput(
      openai,
      latestUserMessage,
      effectiveCurrentDraft,
      concernType
    );

    const followUpCount = isNewConversation
      ? 0
      : Number.isFinite(Number(conversationRound))
        ? Number(conversationRound)
        : 0;

    const isFirstInput = followUpCount === 0 && isNewConversation;

    const newHistory: ChatMessage[] = [
      ...safeHistory,
      { role: 'user', content: latestUserMessage },
    ];

    const { question } = await generateFollowUpQuestion({
      history: newHistory,
      currentDraft: updatedDraft,
      followUpCount,
      isFirstInput,
      latestUserMessage,
      concernType,
    });

    let assistantMessage = '';
    let status: 'asking' | 'ready_for_review' = 'asking';
    let finalDraft = updatedDraft;
    let nextConversationRound = followUpCount;

    if (question) {
      status = 'asking';
      assistantMessage = question;
      nextConversationRound = followUpCount + 1;
    } else {
      status = 'ready_for_review';
      assistantMessage =
        '情報をありがとうございます。チャット内容をもとに整理カードを作成しました。内容をご確認いただき、必要に応じて編集してください。';
      finalDraft = await finalizeDraftForReview(openai, newHistory, updatedDraft, concernType);
    }

    const response: IntakeResponse = {
      assistantMessage,
      status,
      draft: finalDraft,
      conversationRound: nextConversationRound,
      concernType,
    };

    return json(response);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const msg = extractMessage(err);
    const status = err?.status || 500;
    return json({ error: msg }, status);
  }
}
