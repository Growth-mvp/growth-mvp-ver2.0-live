// PHASE 1: 重要な経営相談の推論方針。通常相談や操作案内には適用しない。
// 追加の LLM 呼び出しは行わない。判断は常に利用者に委ねる。
export type ConsultingFocus = 'diagnosis' | 'strategy' | 'investment' | 'organization' | 'execution' | 'finance';
export type ConsultingPlan = {
  focus: ConsultingFocus;
  effort: 'medium' | 'high';
  sources: { finance: boolean; rationale: boolean; alignment: boolean; progress: boolean; plan: boolean };
};
const DECISION = /べき|すべき|した方が|どちら|優先|判断|妥当|整合|選択|見直|どう思|どうする|どうすれ|どうか|成長できるか|達成できるか|評価|比較|是非|決め|検討|何を.*(?:変え|すれ|優先)|問題(?:は|が)?(?:ない|ある)か/;
const CAUSE = /原因|なぜ|真因|要因|伸びない|改善しない|動かない|未達|悪化|低迷|対立/;
const EXPLAIN_ONLY = /とは[？?。\s]*$|意味を教え|定義を教え|一般的な(意味|定義|手法)/;
const HIGH_STAKES = /撤退|事業売却|新規事業|参入|設備投資|資本配分|経営資源|資源配分|借入|資金繰り|資金不足|事業承継|M&A|買収|廃止/i;
const INVESTMENT = /撤退|事業売却|新規事業|参入|設備投資|資本配分|経営資源|資源配分|事業承継|M&A|買収|廃止|投資/i;
const FINANCE = /資金繰り|資金不足|借入|返済|現預金|キャッシュ|財務|利益率|収益性|採算/;
const ORGANIZATION = /部門|営業部|製造部|開発部|管理部|経営企画|組織|社員|幹部|管理職|人材|上司|現場/;
const STRATEGY = /戦略|競争優位|勝ち筋|顧客価値|事業モデル|経営方針|経営計画/;
const EXECUTION = /実行|進捗|施策|KPI|未達|成果|優先|業績(?:が)?改善/i;
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
  const capital = focus === 'investment' || focus === 'finance';
  return {
    focus,
    effort: HIGH_STAKES.test(question) && decision ? 'high' : 'medium',
    sources: { finance: capital, rationale: false, alignment: false, progress: false, plan: capital },
  };
}

const FOCUS_RULE: Record<ConsultingFocus, string> = {
  diagnosis: '症状と原因を分け、収益構造・顧客・業務・組織のどこに原因がありそうかを、支持する根拠と反する根拠で絞り込む。',
  strategy: '顧客価値・競争優位・収益構造・経営資源がつながっているかを見る。提示された選択肢以外の打ち手があれば、必要に応じて示す。',
  investment: '提示された選択肢（実行・見送りなど）以外に、段階的な検証や規模の縮小もありうるかを考える。採算・資金余力・機会費用・撤退条件を判断基準にする。',
  organization: '管理や制度を足す前に、共通目的の理解と当事者どうしの対話で認識のズレを埋められるかを考える。現場の経験や問題意識を経営に活かす道、管理職や経営者自身の関わり方が問題を生んでいないかも、事実に基づく範囲で確かめる。',
  execution: '計画と実績の差がどこで生じているかを見て、誰のどの行動を変えれば成果につながるかを考える。',
  finance: '損益とキャッシュを分け、資金不足の時期と原因、資金調達や施策変更の選択肢を判断基準として示す。未確認の数値は作らない。',
};

export function buildConsultingReasoningBlock(plan: ConsultingPlan): string {
  return [
    '【重要な経営相談の思考方針】',
    FOCUS_RULE[plan.focus],
    '深く考えた内容をすべて説明せず、相談者が最も理解すべき本質を一つ選んで伝える。数値は判断に必要なものだけを示す。',
    '相談者が示した問題を真因と決めつけず、登録事実に照らして支持する根拠と反する根拠を考える。事実がない組織課題や人物評価は断定せず、確認事項として示す。',
    '戦略・社員の行動・顧客価値・経営成果のつながりを考え、局所的な問題だけで結論づけない。相談と関係の薄い組織変革は勧めない。',
    '指示や施策の押し付けで解決しようとせず、当事者が目的を理解し、自ら判断・行動できる条件を考える。',
    '報告書調や説明調を避け、相手の立場と問題意識を踏まえて一緒に考える。問いは議論を深める必要がある場合に限る。回答の長さ・構成は通常の回答スタイルに従い、判断は利用者に委ねる。',
  ].join('\n');
}

// 現行モデルで medium/high が利用可能か実 API で確認するまでは low を維持。
// 確認後に明示的に有効化。追加呼び出しや自動リトライはしない。
export function consultingEffort(plan: ConsultingPlan | null, enabled: boolean): 'low' | 'medium' | 'high' {
  return enabled && plan ? plan.effort : 'low';
}
