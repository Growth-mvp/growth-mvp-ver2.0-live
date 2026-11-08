import type { AssumptionProvenance, ProjectDraftReasoning } from '@/types/strategy';

export type FollowUpKey = 'targetCustomers' | 'conversionRatePct' | 'averageDealMJPY';

export type FollowUpQuestion = {
  /** 質問の種類ごとに固定の識別子（再読込後も同じ質問として扱う） */
  id: string;
  text: string;
  /** 数値の回答を入れる前提（構造化項目）。無い場合は回答として保存だけする */
  assumptionKey?: FollowUpKey;
  answerType: 'number' | 'text';
  unit?: string;
  /** 小さいほど先に出す */
  priority: number;
  /** 優先理由（画面で短く示す） */
  reason: string;
  /** 元になったAIの確認事項 */
  source: string;
};

export type FollowUpRecord = { status: 'answered' | 'skipped'; value?: number | string; answeredAt?: string };
export type FollowUpRecords = Record<string, FollowUpRecord>;

type Rule = {
  id: string;
  match: RegExp;
  exclude?: RegExp;
  build: (item: string) => Omit<FollowUpQuestion, 'id' | 'source'>;
};

const RULES: Rule[] = [
  {
    id: 'candidates',
    match: /候補(企業|顧客|先)|営業(対象|候補)|提案可能な社数|顧客候補数|候補社数|対象(顧客|先)数/,
    build: () => ({
      text: '実際の営業候補（提案できる会社・顧客）は何社ありますか？',
      assumptionKey: 'targetCustomers',
      answerType: 'number',
      unit: '社',
      priority: 10,
      reason: '売上の見込みに直結',
    }),
  },
  {
    id: 'conversion',
    match: /受注率|転換率|成約率|入会率|受注への/,
    exclude: /入会率/,
    build: () => ({
      text: '過去の受注率（提案してから受注になった割合）は何％ですか？',
      assumptionKey: 'conversionRatePct',
      answerType: 'number',
      unit: '%',
      priority: 11,
      reason: '売上の見込みに直結',
    }),
  },
  {
    id: 'conversion_member',
    match: /入会率/,
    build: () => ({
      text: '体験から入会する割合はどれくらいですか？（％）',
      answerType: 'number',
      unit: '%',
      priority: 20,
      reason: '会員数の見込みに直結',
    }),
  },
  {
    id: 'deal_value',
    match: /平均(契約|受注|売上)|契約単価|受注額|1社当たり|単価/,
    exclude: /月額(単価|会費)|会員区分/,
    build: () => ({
      text: '1社（1件）当たりの契約単価・受注金額はいくらですか？',
      assumptionKey: 'averageDealMJPY',
      answerType: 'number',
      unit: '百万円',
      priority: 12,
      reason: '売上の見込みに直結',
    }),
  },
  {
    id: 'member_count',
    match: /会員数|在籍会員|期首・期末会員/,
    build: () => ({
      text: '現在の会員数は何名ですか？',
      answerType: 'number',
      unit: '名',
      priority: 15,
      reason: '会員型の売上の見込みに必要',
    }),
  },
  {
    id: 'churn',
    match: /退会率|退会者数|継続率/,
    exclude: /退会(理由|相談)/,
    build: () => ({
      text: '月間の退会率はどれくらいですか？（％）',
      answerType: 'number',
      unit: '%',
      priority: 16,
      reason: '会員型の売上の見込みに必要',
    }),
  },
  {
    id: 'monthly_fee',
    match: /月額(単価|会費)|会員区分別/,
    build: () => ({
      text: '月額会費はいくらですか？（会員区分が複数あれば主な区分）',
      answerType: 'number',
      unit: '円',
      priority: 17,
      reason: '会員型の売上の見込みに必要',
    }),
  },
  {
    id: 'selection_condition',
    match: /最低料金|採用(される|条件|に)|採用条件|条件/,
    exclude: /単価|受注率|転換率|社数|候補/,
    build: () => ({
      text: '相手に採用・契約してもらうための条件（最低料金など）は何ですか？',
      answerType: 'text',
      priority: 30,
      reason: '実行の可否に影響',
    }),
  },
  {
    id: 'capacity',
    match: /受け入れ|受け入れ可能|対応可能|試作を受け|設備|人員|トレーナー|シフト|枠/,
    exclude: /投資額|設備投資/,
    build: () => ({
      text: '実行に必要な受け入れ能力（人員・設備・枠）はどれくらいありますか？',
      answerType: 'text',
      priority: 31,
      reason: '実行の可否に影響',
    }),
  },
  {
    id: 'compliance',
    match: /認証|規制|適合|要求精度|加工適合|品質|規格/,
    build: () => ({
      text: 'この取引に必要な認証・規制・技術条件は何ですか？（分からなければ保留）',
      answerType: 'text',
      priority: 25,
      reason: '実行の可否に影響（断定せず確認）',
    }),
  },
  {
    id: 'extra_cost',
    match: /追加費用|追加配送費用|追加配送|運行|配車等の追加|限界利益|粗利|採算/,
    exclude: /投資額|投資/,
    build: () => ({
      text: 'この施策で増える費用（配送・運行・加工・追加対応など）はいくらですか？',
      answerType: 'number',
      unit: '百万円',
      priority: 35,
      reason: '利益の見込みに必要',
    }),
  },
  {
    id: 'cost_base',
    match: /原価|コスト/,
    exclude: /追加費用|投資/,
    build: () => ({
      text: '原価低減の対象（部品・工程）と、現在の基準値はどれくらいですか？',
      answerType: 'text',
      priority: 36,
      reason: '利益の見込みに必要',
    }),
  },
  {
    id: 'surcharge_base',
    match: /有料化率/,
    build: () => ({
      text: '追加配送の対象件数（有料化率の分母）は何件ですか？',
      answerType: 'number',
      unit: '件',
      priority: 40,
      reason: '有料化率の目標の根拠',
    }),
  },
  {
    id: 'reason_for_us',
    match: /選ばれる|選択|競合/,
    build: () => ({
      text: '顧客が他社ではなく自社を選ぶ根拠（実績や顧客の声など）は何ですか？',
      answerType: 'text',
      priority: 28,
      reason: '選ばれる理由を根拠で確認',
    }),
  },
  {
    id: 'churn_reason',
    match: /退会理由|未入会理由|面談|フォロー|連絡実施率|経過日数/,
    build: () => ({
      text: '退会や未入会の主な理由は何ですか？',
      answerType: 'text',
      priority: 45,
      reason: '施策の打ち手の確認',
    }),
  },
];

/** 投資額は投資計画で扱うため、ここでは質問にしない */
const SKIP_ITEM = /投資額|設備投資|必要投資|外部費用|仮目標/;

/** 施策の文言に新用途・医療・認証などが含まれ、AIが確認事項に入れていない場合の補い */
const COMPLIANCE_HINT = /新用途|医療|認証|規制|試作|精密|規格/;

function rulesFor(item: string): Rule[] {
  return RULES.filter((r) => r.match.test(item) && !(r.exclude && r.exclude.test(item)));
}

/** AIの確認事項から、施策に応じた質問を優先順に作る（同じ種類は1問にまとめる） */
export function followUpQuestionsOf(args: {
  reasoning: ProjectDraftReasoning | undefined;
  projectText?: string;
  hasCausalWhyUs?: boolean;
}): FollowUpQuestion[] {
  const items = args.reasoning?.verificationItems ?? [];
  const seen = new Set<string>();
  const out: FollowUpQuestion[] = [];
  for (const item of items) {
    if (SKIP_ITEM.test(item)) continue;
    const matched = rulesFor(item);
    if (matched.length === 0) {
      // 対応する質問パターンが無い確認事項も、回答できる形で残す
      const id = `other:${item.slice(0, 40)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, text: `「${item}」を確認できますか？`, answerType: 'text', priority: 90, reason: '確認事項', source: item });
      continue;
    }
    for (const rule of matched) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      out.push({ id: rule.id, ...rule.build(item), source: item });
    }
  }
  if (args.projectText && COMPLIANCE_HINT.test(args.projectText) && !seen.has('compliance')) {
    const r = RULES.find((x) => x.id === 'compliance')!;
    out.push({ id: 'compliance', ...r.build(''), source: '（施策の内容から補完）' });
  }
  if (args.hasCausalWhyUs && !seen.has('reason_for_us')) {
    const r = RULES.find((x) => x.id === 'reason_for_us')!;
    out.push({ id: 'reason_for_us', ...r.build(''), source: '（因果関係の「選ばれる理由」から補完）' });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** 利用者が入力・確認・登録した値は既存情報。AIが仮に入れた値は、まだ確認されていないので質問する */
function isKnownValue(
  assumptions: Record<string, number | undefined> | undefined,
  provenance: Record<string, AssumptionProvenance> | undefined,
  key: string,
): boolean {
  const v = assumptions?.[key];
  if (v === undefined || v === null) return false;
  const p = provenance?.[key];
  if (p && p.source === 'AI_DRAFT' && !p.userEdited && !p.userConfirmed) return false;
  return true;
}

/** 既存情報（利用者の入力・確認済みの値）・回答済み・保留の質問を除き、今出す質問（先頭1問）を返す */
export function nextFollowUp(
  questions: FollowUpQuestion[],
  records: FollowUpRecords | undefined,
  assumptions: Record<string, number | undefined> | undefined,
  provenance?: Record<string, AssumptionProvenance>,
): { current: FollowUpQuestion | null; answered: FollowUpQuestion[]; skipped: FollowUpQuestion[]; known: FollowUpQuestion[]; pending: number } {
  const answered: FollowUpQuestion[] = [];
  const skipped: FollowUpQuestion[] = [];
  const known: FollowUpQuestion[] = [];
  let current: FollowUpQuestion | null = null;
  let pending = 0;
  for (const q of questions) {
    const rec = records?.[q.id];
    if (rec?.status === 'answered') {
      answered.push(q);
      continue;
    }
    if (rec?.status === 'skipped') {
      skipped.push(q);
      continue;
    }
    if (q.assumptionKey && isKnownValue(assumptions, provenance, q.assumptionKey)) {
      known.push(q);
      continue;
    }
    pending++;
    if (!current) current = q;
  }
  return { current, answered, skipped, known, pending };
}
