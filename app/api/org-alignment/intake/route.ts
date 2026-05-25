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
  /** デバッグ・検証用。フロント側で使わなくてもよい。 */
  concernType?: OrgMisalignmentType;
};

type ChatMessage = { role: 'user' | 'assistant' | string; content: string };

type QuestionPriority =
  | 'department_cooperation_detail'
  | 'department_cooperation_impact'
  | 'challenge_detail'
  | 'challenge_risk_detail'
  | 'evaluation_target'
  | 'evaluation_ideal'
  | 'executive_policy_gap'
  | 'executive_policy_constraint'
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
  | 'counterparty'
  | 'ideal'
  | 'expectation'
  | 'general_scene'
  | null;

type Assessment = {
  concernType: OrgMisalignmentType;
  isComplete: boolean;
  nextQuestionPriority: QuestionPriority;
};

/* ========== generic helpers ========== */
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

function historyIncludesAny(conversationHistory: ChatMessage[], terms: string[]): boolean {
  return conversationHistory.some((m) => terms.some((term) => m.content.includes(term)));
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
  '相談',
  '共有',
  '動いてくれない',
  '対応してくれない',
  '自分たちの仕事ではない',
];

const CHALLENGE_TERMS = [
  '挑戦',
  '失敗',
  '失敗が許されない',
  '失敗すると',
  '新しい施策',
  '新しい取り組み',
  '新しいこと',
  'リスク',
  '思い切った',
];

const EVALUATION_TERMS = [
  '評価',
  '人事評価',
  '査定',
  '賞与',
  '昇格',
  '評価制度',
  '評価されない',
  '評価が変わらない',
  '評価に反映',
];

const EXECUTIVE_POLICY_TERMS = [
  '経営',
  '経営層',
  'トップ',
  '会社方針',
  '経営方針',
  '方針',
  '戦略',
  '指示',
  '無理な指示',
  '現場を理解',
  '現場に合っていない',
];

const AUTHORITY_DECISION_TERMS = [
  '権限',
  '判断権限',
  '承認',
  '決裁',
  '稟議',
  '確認ばかり',
  '判断しろ',
  '判断できない',
  '進まない',
];

const ROLE_RESPONSIBILITY_TERMS = [
  '役割',
  '責任',
  '役割責任',
  '誰が責任',
  '責任範囲',
  '自分たちに仕事が回ってくる',
  '仕事が回ってくる',
  '丸投げ',
  '担当が曖昧',
];

const PRIORITY_CONFLICT_TERMS = [
  '優先順位',
  '優先度',
  '後回し',
  '重要だと言われている',
  '重要プロジェクト',
  '大事と言う',
  '温度差',
];

const TOOL_OR_PROCESS_TERMS = [
  'GROWTH SHIFT',
  'GROWTHSHIFT',
  'Growth Shift',
  'ツール',
  'システム',
  'アプリ',
  '入力しても',
  '入力する意味',
  '反映されない',
  '意味があるのか',
  '意味がない',
  '意味ある',
  '会社は変わらない',
  '変わらない',
  '使っても',
  '仕組みが機能しない',
  '運用されない',
  '活用されない',
];

const COMMUNICATION_TERMS = [
  '説明がない',
  '説明不足',
  '共有されない',
  '情報共有',
  '理由が分からない',
  '背景が分からない',
  '納得感がない',
  '決まったことだけ',
  '伝わってこない',
];

const WORKLOAD_RESOURCE_TERMS = [
  '人が足りない',
  '人員が足りない',
  '時間がない',
  '忙しすぎる',
  '負荷',
  '業務量',
  '通常業務',
  '余裕がない',
  'リソース',
  '目標だけ高い',
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
  '業務改善',
  '効率化',
  '部門ごとに',
  'システムが分か',
  'システムがつながらない',
  'つながっていない',
  '分断されている',
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
  '活気がない',
  '士気',
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
  '育てる時間',
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
  'わからない',
  'できない',
  '使いこなせない',
];

const PROCESS_CONCRETE_HINTS = [
  '申請',
  '承認',
  '稟議',
  '会議',
  '報告',
  '資料',
  '入力',
  '転記',
  '確認',
  'システム',
  'Excel',
  'スプレッドシート',
  'メール',
  'チャット',
  '顧客対応',
  '受発注',
  '請求',
  '見積',
  '在庫',
  '納期',
  '案件管理',
  '日報',
];

const TALENT_TARGET_HINTS = [
  '若手',
  '部下',
  '後輩',
  '新人',
  '中堅',
  '管理職',
  'マネージャー',
  'リーダー',
  'メンバー',
  '営業',
  '製造',
  '開発',
];

const SKILL_TARGET_HINTS = [
  'DX',
  'デジタル',
  'データ',
  '分析',
  '営業',
  '提案',
  'マネジメント',
  '技術',
  '企画',
  '財務',
  '会計',
  'IT',
  'システム',
  'AI',
  '英語',
  '専門知識',
];

const ACTION_CONCRETE_HINTS = [
  '顧客', '既存顧客', '新規顧客', '案件', '会議', '資料', 'データ', '見積',
  '納期', '技術', '仕様', '設計', '開発', '製造', '営業', '人事', '採用',
  '承認', '作業', '調査', '分析', '説明', '準備', '価格', '商品', 'サービス',
  '業務フロー', '問い合わせ', 'クレーム', '契約', '受注', '失注', 'KPI',
  'OKR', '目標', 'レポート', '提案方法', '提案書',
];

const DEPARTMENT_NAMES_AND_HINTS = [
  '営業部', '製造部', '開発部', '管理部', '人事部', '経理部', '総務部',
  '情報システム', '情シス', '企画部', 'マーケティング', '顧客', '納期',
  '技術', '仕様', '資料', 'データ', '見積', '作業', '調査', '分析',
  '説明', '準備', '回答', '確認', '調整内容', '依頼内容',
];

const RISK_DETAIL_HINTS = [
  '失注', '準備不足', '判断ミス', '担当者', '査定', '人事評価', '賞与',
  '昇格', '降格', '減給', '叱責', '報告', '始末書', '責任者',
  '上司から', '会議で', '数字', '目標未達',
];

/* ========== router: classify -> assess -> question ========== */
function classifyConcern(text: string): OrgMisalignmentType {
  if (!text) return 'unknown';

  if (containsAny(text, BUSINESS_PROCESS_EFFICIENCY_TERMS)) return 'business_process_efficiency';
  if (containsAny(text, TOOL_OR_PROCESS_TERMS)) return 'tool_or_process_distrust';
  if (containsAny(text, TALENT_DEVELOPMENT_TERMS)) return 'talent_development';
  if (containsAny(text, SKILL_CAPABILITY_TERMS)) return 'skill_capability_gap';
  if (containsAny(text, CULTURE_MOTIVATION_TERMS)) return 'culture_motivation';
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
      return historyIncludesAny(history, ['経営から求められている方針や指示', 'どこにズレ']);
    case 'executive_policy_constraint':
      return historyIncludesAny(history, ['実行するうえで', '何が不足']);
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
      return historyIncludesAny(history, ['どの作業・承認・情報共有・システム利用', 'どこに非効率']);
    case 'business_process_impact':
      return historyIncludesAny(history, ['その非効率によって', 'どのような影響']);
    case 'culture_scene':
      return historyIncludesAny(history, ['どのような場面や周囲の反応', '前向きに動きにくい雰囲気']);
    case 'culture_ideal':
      return historyIncludesAny(history, ['どのような雰囲気や関わり方']);
    case 'talent_target':
      return historyIncludesAny(history, ['誰のどのような成長や育成']);
    case 'talent_constraint':
      return historyIncludesAny(history, ['育成が進まない原因']);
    case 'skill_target':
      return historyIncludesAny(history, ['どの業務や取り組みに対して', 'どのようなスキルや知識']);
    case 'skill_impact':
      return historyIncludesAny(history, ['そのスキル不足によって', 'どのような支障や不安']);
    case 'counterparty':
      return historyIncludesAny(history, ['主に誰・どの部門']);
    case 'ideal':
      return historyIncludesAny(history, ['本来は、会社としてどのように']);
    case 'expectation':
      return historyIncludesAny(history, ['具体的にどのような対応を期待']);
    case 'general_scene':
      return historyIncludesAny(history, ['具体的にはどのような場面']);
    default:
      return false;
  }
}

function firstNotAsked(candidates: QuestionPriority[], history: ChatMessage[]): QuestionPriority {
  return candidates.find((p) => p && !wasPriorityAlreadyAsked(p, history)) ?? null;
}

function hasCounterparty(draft: IntakeDraft): boolean {
  return !!draft.counterparty_type && draft.counterparty_type !== 'unknown';
}

function hasAnyDraftText(draft: IntakeDraft): boolean {
  return !!joinDraftText(draft).trim();
}

function assessCompletenessByType(
  draft: IntakeDraft,
  history: ChatMessage[],
  isFirstInput: boolean
): Assessment {
  const allText = joinDraftText(draft);
  const concernType = classifyConcern(allText);

  const hasSituation = !!draft.situation_text?.trim();
  const hasRecognition = !!draft.my_recognition_text?.trim();
  const hasIdeal = !!draft.ideal_text?.trim();
  const hasExpectation = !!draft.expectation_text?.trim();

  let nextQuestionPriority: QuestionPriority = null;

  switch (concernType) {
    case 'department_cooperation': {
      const hasCooperationDetail = containsAny(allText, DEPARTMENT_NAMES_AND_HINTS) && containsAny(allText, ['協力', '依頼', 'お願い', '回答', '調整', '対応', '共有', '確認']);
      const hasImpact = containsAny(allText, ['支障', '遅れ', '困った', '顧客', '納期', '対応できない', '進まない', '負担', '抱え込']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasCooperationDetail ? 'department_cooperation_detail' : null,
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
      const needsRisk = containsAny(allText, ['評価', '責任', '失敗', '怒られる', '減点']) && !containsAny(allText, RISK_DETAIL_HINTS);
      nextQuestionPriority = firstNotAsked(
        [
          !hasChallengeDetail ? 'challenge_detail' : null,
          needsRisk ? 'challenge_risk_detail' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'evaluation_system': {
      const hasEvaluationTarget = containsAny(allText, ACTION_CONCRETE_HINTS) || containsAny(allText, ['成果', '行動', 'プロセス', '既存業務', '新しい取り組み']);
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
      const hasPolicyGap = containsAny(allText, ['方針', '指示', '戦略', 'スピード', '挑戦', '目標']) && containsAny(allText, ['現場', '実際', '無理', '足りない', 'できない', '難しい']);
      const hasConstraint = containsAny(allText, ['人', '時間', '予算', '権限', '業務', '負荷', 'スキル', '情報']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasPolicyGap ? 'executive_policy_gap' : null,
          !hasConstraint ? 'executive_policy_constraint' : null,
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
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'role_responsibility': {
      const hasRoleTarget = containsAny(allText, ['業務', '判断', '責任', '担当', '仕事', '対応', 'プロジェクト', '案件']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasRoleTarget ? 'role_responsibility_target' : null,
          !hasIdeal ? 'role_responsibility_ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'priority_conflict': {
      const hasPriorityTarget = containsAny(allText, ['プロジェクト', '業務', '施策', '案件', '顧客', '目標', 'OKR', 'KPI']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasPriorityTarget ? 'priority_conflict_target' : null,
          !hasIdeal ? 'priority_conflict_ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'tool_or_process_distrust': {
      const hasReason = containsAny(allText, ['過去', '以前', 'これまで', '導入', '成果', '効果', '変化がない', '変わらない', '反映', 'フィードバック', '形だけ', '運用', '誰も見ない', '活用']);
      const hasToolExpectation = containsAny([draft.ideal_text, draft.expectation_text].filter(Boolean).join(' '), ['扱われ', '反映', 'フィードバック', '回答', '対応', '改善', '共有', '議論', 'すり合わせ', 'アクション', '見直し', '意思決定']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasReason ? 'tool_reason' : null,
          !hasToolExpectation ? 'tool_expectation' : null,
        ],
        history
      );
      break;
    }

    case 'communication_gap': {
      const hasTarget = containsAny(allText, ['方針', '決定', '会議', '戦略', '目標', 'プロジェクト', '施策', '指示']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasTarget ? 'communication_target' : null,
          !hasIdeal ? 'communication_expectation' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'workload_resource': {
      const hasGap = containsAny(allText, ['新しい', '通常業務', '人', '時間', '負荷', '目標', '業務量', 'リソース']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasGap ? 'workload_gap' : null,
          !hasIdeal ? 'workload_adjustment' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'business_process_efficiency': {
      const hasProcessTarget = containsAny(allText, PROCESS_CONCRETE_HINTS) || containsAny(allText, ['業務プロセス', '業務フロー', '二重入力', '手作業', '承認フロー']);
      const hasProcessImpact = containsAny(allText, ['時間', 'ミス', '遅れ', '負担', '顧客', '連携', '手戻り', '待ち', '残業', 'コスト', '品質']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasProcessTarget ? 'business_process_target' : null,
          !hasProcessImpact ? 'business_process_impact' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'culture_motivation': {
      const hasCultureScene = containsAny(allText, ['場面', '発言', '反応', '会議', '上司', '周囲', '誰も', 'みんな', '意見', '空気', '雰囲気']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasCultureScene ? 'culture_scene' : null,
          !hasIdeal ? 'culture_ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'talent_development': {
      const hasTalentTarget = containsAny(allText, TALENT_TARGET_HINTS) || containsAny(allText, ['誰', '育成対象', '成長', '育てる', '育てろ']);
      const hasTalentConstraint = containsAny(allText, ['時間', '仕組み', '役割', '評価', '教え方', '現場任せ', 'OJT', '研修', 'フィードバック']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasTalentTarget ? 'talent_target' : null,
          !hasTalentConstraint ? 'talent_constraint' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'skill_capability_gap': {
      const hasSkillTarget = containsAny(allText, SKILL_TARGET_HINTS) || containsAny(allText, ['スキル', '能力', '知識', '経験']);
      const hasSkillImpact = containsAny(allText, ['支障', '不安', '進まない', 'できない', '品質', 'ミス', '遅れ', '混乱', 'ついていけない']);
      nextQuestionPriority = firstNotAsked(
        [
          !hasSkillTarget ? 'skill_target' : null,
          !hasSkillImpact ? 'skill_impact' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }

    case 'unknown':
    default: {
      nextQuestionPriority = firstNotAsked(
        [
          !hasSituation ? 'general_scene' : null,
          !hasCounterparty(draft) ? 'counterparty' : null,
          !hasIdeal ? 'ideal' : null,
          !hasExpectation ? 'expectation' : null,
        ],
        history
      );
      break;
    }
  }

  const isComplete = isFirstInput
    ? false
    : nextQuestionPriority === null && hasAnyDraftText(draft) && (hasRecognition || hasIdeal || hasExpectation || concernType === 'tool_or_process_distrust');

  return { concernType, isComplete, nextQuestionPriority };
}

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
      return '経営から求められている方針や指示と、現場で実際に起きていることのどこにズレを感じましたか？';
    case 'executive_policy_constraint':
      return 'その方針を実行するうえで、現場では何が不足していると感じますか？';
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
    case 'counterparty':
      return 'その違和感は、主に誰・どの部門との関係で感じたものですか？';
    case 'ideal':
      return '本来は、会社としてどのように判断・対応してほしいと感じましたか？';
    case 'expectation':
      return '関係する相手・部門・仕組みには、具体的にどのような対応を期待していましたか？';
    case 'general_scene':
      return '具体的にはどのような場面で、その違和感を感じましたか？';
    default:
      return '';
  }
}

async function generateFollowUpQuestion(
  conversationHistory: ChatMessage[],
  currentDraft: IntakeDraft,
  followUpCount: number,
  isFirstInput: boolean
): Promise<{ question: string; draft: IntakeDraft; concernType: OrgMisalignmentType }> {
  const assessment = assessCompletenessByType(currentDraft, conversationHistory, isFirstInput);

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
  currentDraft: IntakeDraft
): Promise<IntakeDraft> {
  const systemPrompt = `あなたは、社員の違和感を「認識のズレ」として整理するための入力補助AIです。
ユーザー入力から、既存draftを保持・補強しながら、以下の情報をJSONで抽出してください。

抽出対象：
- situation_text：具体的な場面・背景・状況。追加回答で得られた具体的な施策・協力内容・依頼内容・対象業務があれば必ず反映する。
- my_recognition_text：ユーザーがその状況をどう受け止めているか。
- ideal_text：ユーザーが理想と考えている状態・本来あるべき姿。
- expectation_text：相手方・会社・仕組みに対する期待・確認したいこと。
- counterparty_type：'executive'|'manager'|'own_department'|'other_department'|'backoffice'|'field_member'|'customer'|'unknown'|'other'
- counterparty_detail：相手方や部門、または違和感の対象の詳細説明。

重要ルール：
- 既存draftの重要情報を削除・短縮しない。新しい入力は既存draftを補強する。
- 個人や部門を責める断定表現ではなく、ユーザーの認識として整理する。
- 「協力」「依頼」「連携」への回答がある場合は、何を依頼したのか、どのような対応を期待したのかを situation_text または expectation_text に具体的に反映する。
- 「挑戦」「施策」「取り組み」への回答がある場合は、その具体内容を situation_text に反映する。
- 「GROWTH SHIFT」「ツール」「システム」「入力しても意味があるのか」「会社は変わらない」などは、人や部門ではなく、仕組み・ツール・変革プロセスへの違和感として扱う。counterparty_type は 'other' または 'unknown'、counterparty_detail は違和感の対象名にする。
- 業務プロセス・効率化・二重入力・手作業・承認フロー・会議・報告などへの違和感は、業務の流れや仕組みへの認識のズレとして扱い、どの作業・承認・情報共有・システム利用に対する違和感かを situation_text に反映する。
- 組織風土・モチベーションへの違和感は、個人のやる気の問題と断定せず、会社が求める行動と、現場が前向きに動きやすい環境・評価・支援とのズレとして扱う。
- 人材育成への違和感は、誰のどのような成長期待と、育成時間・役割分担・教え方・評価・仕組みとのズレとして扱う。
- スキル不足への違和感は、個人の能力不足と断定せず、求められる業務水準・戦略実行能力と、教育機会・支援体制・経験とのズレとして扱う。
- チャットにない固有名詞・制度・会社方針を捏造しない。
- 抽出がないフィールドは省略してよい。
- JSONのみを返す。`;

  const userPrompt = `ユーザー入力：
${userInput}

現在のdraft：
${JSON.stringify(currentDraft, null, 2)}

上記の入力から新たに抽出できる情報を反映してください。JSONのみを返してください。`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  });

  const responseText = completion.choices[0]?.message?.content || '{}';

  try {
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
  } catch (err) {
    console.warn(`[WARN] ${ROUTE_TAG} extractDraftFromInput JSON parse failed:`, extractMessage(err));
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

出力JSON：
{
  "situation_text": string,
  "my_recognition_text": string,
  "ideal_text": string,
  "expectation_text": string,
  "counterparty_type": "executive" | "manager" | "own_department" | "other_department" | "backoffice" | "field_member" | "customer" | "unknown" | "other",
  "counterparty_detail": string
}

現在の分類：${concernType}

補完ルール：
- draftに既に具体情報がある場合は、その情報を必ず活かす。
- 空欄がある場合でも、チャット履歴から自然に推測できる範囲で補完する。
- 事実を捏造しない。チャットにない会社方針、制度、人物名、固有名詞は追加しない。
- 断定しすぎず、「感じた」「と思う」「期待していた」など、ユーザーの認識として表現する。
- situation_text は、何に対する違和感か／どの場面でそう感じたかが分かるようにする。
- my_recognition_text は、ユーザーがその出来事をどう受け止めたかを補う。
- ideal_text は、本来どうあるべきと感じているかを補う。
- expectation_text は、相手・関係部門・会社・仕組みに期待していた対応を補う。
- tool_or_process_distrust の場合は、無理に個人や部門の相手を作らず、counterparty_type は 'other' または 'unknown'、counterparty_detail は「GROWTH SHIFT」「仕組み」「システム」などにする。
- business_process_efficiency の場合は、業務の流れ・承認・情報連携・システム利用・手作業などのどこに非効率があるかを整理し、個人の怠慢ではなく業務設計や運用のズレとして表現する。
- culture_motivation の場合は、社員の意識が低いと断定せず、前向きに動きにくい背景にある評価・支援・心理的安全性・過去経験のズレとして表現する。
- talent_development の場合は、育成対象・育成責任・育成時間・方法・評価のズレとして表現する。
- skill_capability_gap の場合は、個人能力の問題と断定せず、求められるスキル水準と教育・支援・経験機会のズレとして表現する。
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
  } catch (err) {
    console.warn(`[WARN] ${ROUTE_TAG} finalizeDraftForReview failed:`, extractMessage(err));
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
          .map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      : [];

    const updatedDraft = await extractDraftFromInput(openai, userMessage.trim(), currentDraft);

    const followUpCount = Number.isFinite(Number(conversationRound)) ? Number(conversationRound) : 0;
    const isFirstInput = followUpCount === 0;

    const newHistory: ChatMessage[] = [
      ...safeHistory,
      { role: 'user', content: userMessage.trim() },
    ];

    const { question, concernType } = await generateFollowUpQuestion(
      newHistory,
      updatedDraft,
      followUpCount,
      isFirstInput
    );

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
      assistantMessage = '情報をありがとうございます。チャット内容をもとに整理カードを作成しました。内容をご確認いただき、必要に応じて編集してください。';
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
