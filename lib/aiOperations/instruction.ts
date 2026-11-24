/* 音声・文字の指示から、既存の入力欄への「入力案」を作る（AIは呼ばない。保存もしない）。
 * 対象は STAGE2「経営者の思い」への追加と、STAGE1 財務表の全社売上高。 */

export type OperationProposal =
  | {
      kind: 'stage2.ceoIntent';
      pathname: '/stage2';
      companyId: string;
      strategyId: string;
      before: string;
      addition: string;
    }
  | {
      kind: 'stage1.revenue';
      pathname: '/stage1';
      companyId: string;
      strategyId: string;
      year: number;
      beforeYen: number | null;
      afterYen: number;
    };

export type OperationContext = {
  companyId: string;
  strategyId: string;
  ceoIntent: string;
  revenueYenByYear: Record<number, number | null | undefined>;
};

export type OperationInstruction =
  | { kind: 'proposal'; proposal: OperationProposal }
  | { kind: 'clarify'; message: string };

const QUESTION_CUE = /[?？]|ですか|でしょうか|か？/;
const CEO_INTENT_CUE = /経営者の思い/;
const ADD_CUE = /追加|加え|入れ|足し/;
const CEO_INTENT_PATTERN = /経営者の思い[にへの][、,]?\s*(.+?)\s*(?:と|を)?\s*(?:追加|加え|入れ|足し)(?:て|ておいて|してください|して)?\s*$/;
const REVENUE_CUE = /売上/;
const COMPANY_SCOPE_CUE = /全社|会社全体/;
const YEAR_PATTERN = /(19|20)\d{2}\s*年(?:度)?/g;
const AMOUNT_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(億|百万円|百万|万円|万|千円|千|円)/g;
const UNIT_YEN: Record<string, number> = {
  億: 1e8,
  百万円: 1e6,
  百万: 1e6,
  万円: 1e4,
  万: 1e4,
  千円: 1e3,
  千: 1e3,
  円: 1,
};

function normalizeDigits(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',');
}

/** 文中の金額を円に換算する。「1億6,000万円」のように続けて書かれた金額は1つにまとめる。別々の金額は別の要素になる */
export function parseYenAmounts(text: string): number[] {
  const source = normalizeDigits(text).replace(YEAR_PATTERN, ' ');
  const groups: Array<{ value: number; end: number }> = [];
  for (const m of source.matchAll(AMOUNT_PATTERN)) {
    const start = m.index ?? 0;
    const value = Number(m[1].replace(/,/g, '')) * UNIT_YEN[m[2]];
    if (!Number.isFinite(value)) continue;
    const last = groups[groups.length - 1];
    if (last && /^\s*$/.test(source.slice(last.end, start))) {
      last.value += value;
      last.end = start + m[0].length;
    } else {
      groups.push({ value, end: start + m[0].length });
    }
  }
  return groups.map((g) => Math.round(g.value));
}

function parseRevenueYear(text: string): number | null {
  const m = normalizeDigits(text).match(/((?:19|20)\d{2})\s*年/);
  return m ? Number(m[1]) : null;
}

function resolveCeoIntent(text: string, ctx: OperationContext): OperationInstruction | null {
  if (QUESTION_CUE.test(text) || !ADD_CUE.test(text)) return null;
  const m = text.trim().replace(/[。.]$/, '').match(CEO_INTENT_PATTERN);
  const addition = m?.[1]?.trim() ?? '';
  if (!addition) {
    return { kind: 'clarify', message: '追加する内容を、「〜と追加して」の形で教えてください。' };
  }
  if (ctx.ceoIntent.includes(addition)) {
    return { kind: 'clarify', message: '同じ内容がすでに「経営者の思い」にあるため、入力案は作りませんでした。' };
  }
  return {
    kind: 'proposal',
    proposal: {
      kind: 'stage2.ceoIntent',
      pathname: '/stage2',
      companyId: ctx.companyId,
      strategyId: ctx.strategyId,
      before: ctx.ceoIntent,
      addition,
    },
  };
}

function resolveRevenue(text: string, ctx: OperationContext): OperationInstruction | null {
  if (QUESTION_CUE.test(text) || !REVENUE_CUE.test(text)) return null;
  const amounts = parseYenAmounts(text);
  if (amounts.length === 0) return null;
  if (amounts.length > 1) {
    return { kind: 'clarify', message: '金額が複数あるため、入力案は作りませんでした。売上高は1つの金額で指示してください。' };
  }
  const year = parseRevenueYear(text);
  if (year === null) {
    return { kind: 'clarify', message: '対象の年度を教えてください（例：2025年度の全社売上高は1億6,000万円です）。' };
  }
  if (!COMPANY_SCOPE_CUE.test(text)) {
    return { kind: 'clarify', message: '全社の売上高ですか、事業別の売上高ですか。全社の場合は「全社売上高」と言ってください。' };
  }
  const afterYen = amounts[0];
  const beforeYen = ctx.revenueYenByYear[year] ?? null;
  if (beforeYen === afterYen) {
    return { kind: 'clarify', message: `${year}年度の全社売上高は、すでに同じ金額で登録されています。` };
  }
  return {
    kind: 'proposal',
    proposal: {
      kind: 'stage1.revenue',
      pathname: '/stage1',
      companyId: ctx.companyId,
      strategyId: ctx.strategyId,
      year,
      beforeYen,
      afterYen,
    },
  };
}

/** 指示が対象の操作でなければ null（通常のAI相談として扱う） */
export function resolveOperationInstruction(text: string, ctx: OperationContext): OperationInstruction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (CEO_INTENT_CUE.test(trimmed)) return resolveCeoIntent(trimmed, ctx);
  return resolveRevenue(trimmed, ctx);
}

/** 経営者の思いの入力案を、既存の文章を消さずに末尾へ追記した結果にする */
export function appendCeoIntent(before: string, addition: string): string {
  const base = before.trimEnd();
  return base ? `${base}\n${addition}` : addition;
}
