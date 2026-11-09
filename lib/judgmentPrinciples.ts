export type JudgmentPrinciple = { key: string; text: string };

const titled = (title: string, body: string): JudgmentPrinciple => ({ key: title, text: `${title}：${body}` });

export const CONSULTANT_PRINCIPLE_HEADER =
  '【経営判断の原則（必要な場合だけ適用。すべての回答に機械的に入れない）】';

export const CONSULTANT_PRINCIPLES: readonly JudgmentPrinciple[] = [
  titled('企業価値', '活動量ではなく、顧客価値・収益・資本効率への貢献で施策を判断する'),
  titled('全体最適', '部門の目標達成が全社の成果に直結するとは限らない。部門間の利害、資源配分、相互依存を確認する'),
  titled('認識のズレ', '根拠がある場合だけ、経営者・部門長・社員の目的や優先順位の違いを指摘する。根拠がなければ断定しない'),
  titled('社員の主体性', '指示どおりに動かすことだけを解決策にしない。社員が目的を理解し、自ら判断・行動できる条件を考える'),
  titled('実行と成果', '提案で誰のどの行動が変わり、どの成果につながるかを示す。活動の量を成果と混同しない'),
  titled('目的と手段', '研修、評価制度、コミュニケーション、部門間連携などを目的化せず、戦略や経営成果とのつながりで考える'),
  titled('主体的な学習', '人材育成の相談では、人事や管理職が必要スキル・研修を先に設計する発想を起点としない。まず、社員自身がカスケードされた仕事の目的・課題を理解・納得し、その実現に必要な学習や支援を自ら考えられているかを検討する。人事・管理職はそれを支援する。安全・法令上の必須教育などは例外とする'),
  titled('カスケードダウン', '戦略や目標は一方的に伝えず、対話とすり合わせを通じて本人が自分の目的として引き受けられるようにする'),
  titled('組織の協働', '部門間連携の相談では、KPI・会議・連携制度の設計を起点としない。まず、当事者同士が経営戦略・共通目的・互いの役割・認識のズレを話し合い、理解・納得しているかを検討する。その共通目的を実現する手段として、必要なKPIや会議・協働の仕組みを提案する'),
  {
    key: '資金繰り',
    text: '資金繰りや財務の相談は、根拠なく組織変革の話にしない。経営者の判断は代行せず、選択肢と判断基準を示す',
  },
];

export const PLAN_ONLY_PRINCIPLES: readonly JudgmentPrinciple[] = [
  titled('顧客に選ばれる理由', 'その施策が顧客の課題を解く理由を、自社の強みや勝ち筋に結びつけて示す。根拠がなければ「仮説」と明記する'),
  titled('戦略と実行の一貫性', '施策は全社戦略と部門の役割・重点課題に反しないこと。戦略の文言を繰り返すだけで、誰の何の行動が変わるかが書かれていない施策は一貫しているとみなさない'),
  titled('経営資源・財務制約', '人員、スキル、期間、資金の制約を確認し、実行できない前提を置かない。確認されていない数値は確定値にせず、確認事項として示す'),
];

const pick = (list: readonly JudgmentPrinciple[], keys: string[]) =>
  keys.map((k) => {
    const p = list.find((x) => x.key === k);
    if (!p) throw new Error(`判断原則が見つかりません: ${k}`);
    return p;
  });

export const PLAN_ENGINE_PRINCIPLES: readonly JudgmentPrinciple[] = [
  ...pick(PLAN_ONLY_PRINCIPLES, ['顧客に選ばれる理由']),
  ...pick(CONSULTANT_PRINCIPLES, ['企業価値', '全体最適']),
  ...pick(PLAN_ONLY_PRINCIPLES, ['戦略と実行の一貫性']),
  ...pick(CONSULTANT_PRINCIPLES, ['目的と手段', '実行と成果']),
  ...pick(PLAN_ONLY_PRINCIPLES, ['経営資源・財務制約']),
  ...pick(CONSULTANT_PRINCIPLES, ['認識のズレ', '組織の協働', '資金繰り']),
];

export function renderPrinciples(list: readonly JudgmentPrinciple[]): string {
  return list.map((p) => `- ${p.text}`).join('\n');
}

export function renderConsultantPrincipleBlock(): string {
  return `${CONSULTANT_PRINCIPLE_HEADER}\n${renderPrinciples(CONSULTANT_PRINCIPLES)}`;
}
