// PHASE 1: 重要な経営相談の推論方針。通常相談や操作案内には適用しない。
// 追加の LLM 呼び出しは行わない。判断は常に利用者に委ねる。
export type ConsultingFocus = 'diagnosis' | 'strategy' | 'investment' | 'organization' | 'execution' | 'finance';
export type ConsultingPlan = {
  focus: ConsultingFocus;
  effort: 'medium' | 'high';
  sources: { finance: boolean; rationale: boolean; alignment: boolean; progress: boolean; plan: boolean };
};
const DECISION = /べき|すべき|した方が|どちら|優先|判断|妥当|選択|見直|どう思|どうする|どうすれ|どうか|成長できるか|達成できるか|評価|比較|是非|決め|検討/;
const CAUSE = /原因|なぜ|真因|要因|伸びない|改善しない|動かない|未達|悪化|低迷|対立/;
const EXPLAIN_ONLY = /とは[？?。\s]*$|意味を教え|定義を教え|一般的な(意味|定義|手法)/;
const HIGH_STAKES = /撤退|事業売却|新規事業|参入|設備投資|資本配分|経営資源|資源配分|借入|資金繰り|資金不足|事業承継|M&A|買収|廃止/i;
const INVESTMENT = /撤退|事業売却|新規事業|参入|設備投資|資本配分|経営資源|資源配分|事業承継|M&A|買収|廃止|投資/i;
const FINANCE = /資金繰り|資金不足|借入|返済|現預金|キャッシュ|財務|利益率|収益性|採算/;
const ORGANIZATION = /部門|営業部|製造部|開発部|管理部|経営企画|組織|社員|幹部|管理職|人材|上司|現場/;
const STRATEGY = /戦略|競争優位|勝ち筋|顧客価値|事業モデル|経営方針|経営計画/;
const EXECUTION = /実行|進捗|施策|KPI|未達|成果|優先|業績改善/i;
const COMPANY_DIAGNOSIS = /売上|利益|業績|収益|経営課題|経営|顧客|営業|事業|原価|費用/;

export function selectConsultingPlan(question: string, eligible: boolean): ConsultingPlan | null {
  if (!eligible || EXPLAIN_ONLY.test(question)) return null;
  const decision = DECISION.test(question);
  const cause = CAUSE.test(question);
  if (!decision && !cause) return null;
  let focus: ConsultingFocus;
  if (HIGH_STAKES.test(question) && INVESTMENT.test(question) && decision) focus = 'investment';
  else if (FINANCE.test(question) && decision) focus = 'finance';
  else if (ORGANIZATION.test(question) && (cause || decision)) focus = 'organization';
  else if ((STRATEGY.test(question) || /(?:社長|経営者).*(?:優先|判断)/.test(question)) && decision) focus = 'strategy';
  else if (cause && COMPANY_DIAGNOSIS.test(question)) focus = 'diagnosis';
  else if (EXECUTION.test(question) && (decision || cause)) focus = 'execution';
  else if (INVESTMENT.test(question) && decision) focus = 'investment';
  else return null;
  const financial = focus !== 'organization' || /利益|売上|投資|費用|予算|人件費/.test(question);
  return {
    focus,
    effort: HIGH_STAKES.test(question) && decision ? 'high' : 'medium',
    sources: { finance: financial, rationale: true, alignment: true, progress: true, plan: financial },
  };
}

const FOCUS_RULE: Record<ConsultingFocus, string> = {
  diagnosis: '症状と原因を分け、収益構造・顧客・業務・組織など関連する複数の原因仮説を比較する。',
  strategy: '顧客価値、競争優位、収益構造、経営資源を結びつけ、現行戦略を続ける場合と変更する場合を比較する。',
  investment: '現状維持・段階的な検証・実行・見送りなど該当する選択肢を比較する。採算、資金余力、機会費用、撤退条件を確認する。',
  organization: '個人の意欲や能力だけに帰さず、目的・認識のズレ、利害、権限、仕事の構造を確かめる。対話によるすり合わせと社員の主体性を重視する。',
  execution: '計画と実績の差、阻害要因、担当者の制約を確かめ、成果につながる行動と見直しの優先順位を考える。',
  finance: '損益とキャッシュを区別し、資金不足の時期・原因・資金調達や施策変更の選択肢を確認する。未算定の数値を作らない。',
};

export function buildConsultingReasoningBlock(plan: ConsultingPlan): string {
  return [
    '【重要な経営相談の思考方針】',
    FOCUS_RULE[plan.focus],
    '相談者が示した問題を真因と決めつけず、何を判断するための相談かを捉える。',
    '関連する原因仮説・選択肢を複数検討し、登録事実に照らして支持する根拠と反する根拠を考える。情報不足を事実と混同しない。',
    '現時点の見解、判断を変える条件、確認すべき重要な事実を必要な範囲で示す。根拠のない数値や確信度は作らない。',
    '実行を提案するときは、誰のどの行動がどの成果につながるか、全社への影響と人・時間・資金の制約を考える。',
    'これらは回答を深めるための観点であり、毎回すべてを列挙しない。通常の回答スタイルと相談者の立場を守り、必要なら問いを一つだけ添える。判断は利用者に委ねる。',
  ].join('\n');
}

// 現行モデルで medium/high が利用可能か実 API で確認するまでは low を維持。
// 確認後に明示的に有効化。追加呼び出しや自動リトライはしない。
export function consultingEffort(plan: ConsultingPlan | null, enabled: boolean): 'low' | 'medium' | 'high' {
  return enabled && plan ? plan.effort : 'low';
}
