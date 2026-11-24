/* 音声・文字の指示から、既存の入力欄への「入力案」を作る（AIは呼ばない。保存もしない）。
 * 対象は STAGE2「経営者の思い」への追加、STAGE1 財務表の全社売上高、STAGE3 6つの問いの回答。
 * STAGE3 の戦略書の再生成は入力案ではなく、既存の生成処理を呼ぶ指示として扱う。 */

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
    }
  | {
      kind: 'stage3.question';
      pathname: '/cascade';
      companyId: string;
      strategyId: string;
      departmentName: string;
      stepNumber: number;
      question: string;
      before: string;
      answer: string;
    };

export type OperationContext = {
  companyId: string;
  strategyId: string;
  ceoIntent: string;
  revenueYenByYear: Record<number, number | null | undefined>;
  departments?: ReadonlyArray<{
    name: string;
    steps: ReadonlyArray<{ stepNumber: number; question?: string; answer?: string }>;
  }>;
};

export type OperationInstruction =
  | { kind: 'proposal'; proposal: OperationProposal }
  | { kind: 'clarify'; message: string }
  | { kind: 'command'; departmentName: string };

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
const STEP_NUMBER_WORDS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const STAGE3_QUESTION_CUE = /6つの問い|6問|六問|問い/;
const STAGE3_ANSWER_PATTERN = /(?:番目|問目|つ目|番|問)に(.+?)(?:と|を)?\s*(?:入力|記入|書い|追加|入れ|答え)(?:て|ておいて|してください|して)?\s*$/;
const STAGE3_STEP_PATTERN = /(?:6つの問い|6問|問い)の?\s*([1-6一二三四五六])\s*(?:番目|問目|つ目|番|問)/;
const STAGE3_UNNUMBERED_PATTERN = /(?:6つの問い|6問|問い)に(.+?)(?:と|を)?\s*(?:入力|記入|書い|追加|入れ|答え)(?:て|ておいて|してください|して)?\s*$/;
const REGENERATE_CUE = /再生成/;
const STRATEGY_BOOK_CUE = /戦略書|部門戦略/;

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

function mentionedDepartments(text: string, departments: NonNullable<OperationContext['departments']>) {
  const squashed = text.replace(/[\s　]+/g, '');
  return departments.filter((d) => d.name && squashed.includes(d.name.replace(/[\s　]+/g, '')));
}

function stepNumberOf(token: string): number {
  return /^[1-6]$/.test(token) ? Number(token) : STEP_NUMBER_WORDS[token];
}

function bigrams(text: string): Set<string> {
  const s = text.replace(/[\s、。,.?？]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function resolveStage3(text: string, ctx: OperationContext): OperationInstruction | null {
  const departments = ctx.departments ?? [];
  if (QUESTION_CUE.test(text) || !STAGE3_QUESTION_CUE.test(text)) return null;
  if (REGENERATE_CUE.test(text)) return null;

  const numbered = text.match(STAGE3_ANSWER_PATTERN);
  const unnumbered = numbered ? null : text.match(STAGE3_UNNUMBERED_PATTERN);
  const content = (numbered?.[1] ?? unnumbered?.[1] ?? '').replace(/^[、,，\s]+/, '').trim();
  if (!content) return null;

  const named = mentionedDepartments(text, departments);
  if (named.length > 1) {
    return { kind: 'clarify', message: `対象の部門が複数あります。どの部門の6問か指定してください：${named.map((d) => `「${d.name}」`).join('、')}` };
  }
  const dept = named[0] ?? (departments.length === 1 ? departments[0] : undefined);
  if (!dept) {
    return { kind: 'clarify', message: 'どの部門の6問か教えてください（例：宅配事業の6問の1番目に〇〇と入力して）。' };
  }

  const stepToken = text.match(STAGE3_STEP_PATTERN)?.[1];
  const withQuestion = dept.steps.filter((s) => (s.question ?? '').trim() !== '');
  let stepNumber: number | undefined = stepToken ? stepNumberOf(stepToken) : undefined;
  if (stepNumber === undefined) {
    const scored = withQuestion
      .map((s) => {
        const a = bigrams(content);
        const b = bigrams(s.question ?? '');
        let shared = 0;
        for (const g of a) if (b.has(g)) shared++;
        return { step: s, score: shared };
      })
      .sort((x, y) => y.score - x.score);
    const best = scored[0];
    const tie = scored[1] && scored[1].score === best?.score;
    if (!best || best.score < 2 || tie) {
      return { kind: 'clarify', message: '何番目の問いへの回答か教えてください（例：6つの問いの1番目に〇〇と入力して）。' };
    }
    stepNumber = best.step.stepNumber;
  }

  const step = dept.steps.find((s) => s.stepNumber === stepNumber);
  if (!step || (step.question ?? '').trim() === '') {
    return {
      kind: 'clarify',
      message: `${stepNumber}番目の問いがまだ表示されていません。STAGE3の6つの問いで${stepNumber}番目を開いてから、もう一度指示してください。`,
    };
  }
  const before = (step.answer ?? '').trim();
  if (before === content) {
    return { kind: 'clarify', message: `${dept.name}の${stepNumber}番目の回答は、すでに同じ内容です。` };
  }
  return {
    kind: 'proposal',
    proposal: {
      kind: 'stage3.question',
      pathname: '/cascade',
      companyId: ctx.companyId,
      strategyId: ctx.strategyId,
      departmentName: dept.name,
      stepNumber,
      question: step.question ?? '',
      before,
      answer: content,
    },
  };
}

function resolveRegenerate(text: string, ctx: OperationContext): OperationInstruction | null {
  if (!REGENERATE_CUE.test(text) || !STRATEGY_BOOK_CUE.test(text)) return null;
  const departments = ctx.departments ?? [];
  const named = mentionedDepartments(text, departments);
  if (named.length > 1) {
    return { kind: 'clarify', message: `対象の部門が複数あります。どの部門の戦略書を再生成するか指定してください：${named.map((d) => `「${d.name}」`).join('、')}` };
  }
  const dept = named[0] ?? (departments.length === 1 ? departments[0] : undefined);
  if (!dept) {
    return { kind: 'clarify', message: 'どの部門の戦略書を再生成するか教えてください（例：宅配事業の戦略書を再生成して）。' };
  }
  return { kind: 'command', departmentName: dept.name };
}

/** 指示が対象の操作でなければ null（通常のAI相談として扱う） */
export function resolveOperationInstruction(text: string, ctx: OperationContext): OperationInstruction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (CEO_INTENT_CUE.test(trimmed)) return resolveCeoIntent(trimmed, ctx);
  if (REGENERATE_CUE.test(trimmed)) return resolveRegenerate(trimmed, ctx);
  if (STAGE3_QUESTION_CUE.test(trimmed) && (ctx.departments?.length ?? 0) > 0) {
    const stage3 = resolveStage3(trimmed, ctx);
    if (stage3) return stage3;
  }
  return resolveRevenue(trimmed, ctx);
}

/** 経営者の思いの入力案を、既存の文章を消さずに末尾へ追記した結果にする */
export function appendCeoIntent(before: string, addition: string): string {
  const base = before.trimEnd();
  return base ? `${base}\n${addition}` : addition;
}

/** 部門の6問の回答（保存済みの値）を取り出す。未保存なら空文字 */
export function stage3AnswerOf(
  departments: NonNullable<OperationContext['departments']>,
  departmentName: string,
  stepNumber: number,
): string {
  const dept = departments.find((d) => d.name === departmentName);
  return (dept?.steps.find((s) => s.stepNumber === stepNumber)?.answer ?? '').trim();
}

type StoreDepartmentLike = {
  name?: string;
  answers2?: ReadonlyArray<{ steps?: ReadonlyArray<{ stepNumber: number; question?: string; answer?: string }> }>;
};

/** 画面の部門データを、指示の解析に使う形にする（6問の回答は先頭の章の steps） */
export function contextDepartments(departments: ReadonlyArray<StoreDepartmentLike> | undefined): NonNullable<OperationContext['departments']> {
  return (departments ?? []).map((d) => ({
    name: d.name ?? '',
    steps: (d.answers2?.[0]?.steps ?? []).map((s) => ({ stepNumber: s.stepNumber, question: s.question, answer: s.answer })),
  }));
}
