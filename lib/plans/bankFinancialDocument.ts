import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import type { CfValue } from '@/utils/stage6/cashflow';
import {
  UNCONFIRMED_TEXT,
  collectAllowedFigures,
  formatMillionYen,
  formatMillionYenText,
  formatPercent,
  formatRatio,
  type AllowedFigures,
} from './bankFinancialFormat';

export type BankFinancialFacts = {
  statusLines: string[];
  markdown: string;
  promptLines: string[];
  allowed: AllowedFigures;
  issues: string[];
  usable: boolean;
};

const CASH_TOLERANCE_YEN = 1;
const SOURCE_ROW_LIMIT = 40;

const val = (cf: CfValue | undefined): number | null => cf?.value ?? null;

function escapeCell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\r?\n/g, ' ');
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.map(escapeCell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(escapeCell).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function signedMillion(yen: number | null): string {
  if (yen === null) return UNCONFIRMED_TEXT;
  const text = formatMillionYen(Math.abs(yen));
  if (yen === 0) return text;
  return yen > 0 ? `+${text}` : `-${text}`;
}

function statusLinesFor(block: BankFinancialPlanBlock): string[] {
  switch (block.status) {
    case 'CURRENT':
      if (block.numbersConfirmed) {
        return [
          'STAGE6の財務計画による計算結果です。会社の取締役会等の承認や、金融機関の承認を得たものではありません。',
        ];
      }
      return [
        `以下は参考値です（確定ではありません）。理由：${block.statusReasons.join('、') || '確認事項があります'}`,
      ];
    case 'STALE':
      return [
        `元データが保存時点から変わったため、以下は参考値です。再計算と再確認が必要です（${block.statusReasons.join('、')}）。`,
      ];
    case 'NOT_SAVED':
      return ['STAGE6で財務計画が保存されていないため、財務数値は記載していません。'];
    case 'INVALID':
      return ['保存された財務計画を確認できないため、財務数値は記載していません。'];
    case 'DIFFERENT_COMPANY':
      return ['保存された財務計画は、この会社のものとして確認できないため、財務数値は記載していません。'];
    case 'UNAVAILABLE':
      return ['財務計画の計算ができなかったため、財務数値は記載していません。'];
    default:
      return ['財務計画の状態を確認できないため、財務数値は記載していません。'];
  }
}

export function buildBankFinancialFacts(block: BankFinancialPlanBlock | undefined): BankFinancialFacts | null {
  if (!block) return null;
  const statusLines = statusLinesFor(block);
  const sections = block.sections;
  if (!sections) {
    return {
      statusLines,
      markdown: statusLines.map((l) => `> ${l}`).join('\n'),
      promptLines: [
        '【財務計画】',
        ...statusLines,
        '第4章には財務数値（金額・比率・年数を含む）を書かず、財務計画が未確認であることと、今後必要な確認事項を記載してください。',
      ],
      allowed: { yen: [], fractions: [] },
      issues: [],
      usable: false,
    };
  }

  const issues: string[] = [];
  const derived: AllowedFigures = { yen: [], fractions: [] };
  const parts: string[] = [];
  const caption = block.status === 'CURRENT' && block.numbersConfirmed ? '' : '（参考値）';

  parts.push(statusLines.map((l) => `> ${l}`).join('\n'));
  parts.push(`> 金額の単位：百万円（小数第1位まで）。年度は決算期の終了年で表記しています（例：2027年3月期）。`);

  // A. 財務目標と収益計画
  const rev = sections.revenuePlan.years;
  const revRows = rev.map((y, i) => {
    const rv = val(y.revenue);
    const oi = val(y.operatingIncome);
    const prev = i > 0 ? rev[i - 1] : undefined;
    const pv = prev ? val(prev.revenue) : null;
    let growth = UNCONFIRMED_TEXT;
    if (rv !== null && pv !== null && pv !== 0) {
      const delta = rv - pv;
      derived.yen.push(delta);
      const g = delta / Math.abs(pv);
      derived.fractions.push(g);
      growth = `${signedMillion(delta)}（${formatPercent(g)}）`;
    }
    const margin = rv !== null && oi !== null && rv !== 0 ? oi / rv : null;
    if (margin !== null) derived.fractions.push(margin);
    return [
      `${y.year}年`,
      y.kind === 'ACTUAL' ? '実績' : '推計',
      formatMillionYen(rv),
      formatMillionYen(oi),
      formatPercent(margin),
      growth,
    ];
  });
  parts.push(`**A. 財務目標と収益計画${caption}**`);
  parts.push(mdTable(['年度', '区分', '売上高', '営業利益', '営業利益率', '前年度比（売上高）'], revRows));

  const t = sections.financialTargets;
  const gapRows = [
    ['売上高', t.stage2Registered.revenue?.valueYen ?? null, t.gaps.revenue],
    ['営業利益', t.stage2Registered.operatingIncome?.valueYen ?? null, t.gaps.operatingIncome],
  ] as const;
  const targetRows = gapRows.map(([label, target, gap]) => {
    if (gap.differenceYen !== null) derived.yen.push(gap.differenceYen);
    return [
      label,
      target === null ? UNCONFIRMED_TEXT : formatMillionYen(target),
      gap.projectedYen === null ? UNCONFIRMED_TEXT : formatMillionYen(gap.projectedYen),
      gap.differenceYen === null ? UNCONFIRMED_TEXT : signedMillion(gap.differenceYen),
      gap.reason ?? '登録目標との差額（承認状態は未確認）',
    ];
  });
  parts.push('**STAGE2の登録目標とSTAGE6推計の比較**');
  parts.push(mdTable(['項目', '登録目標（STAGE2）', '推計（STAGE6）', '差額', '備考'], targetRows));
  const sc = t.stage6Scenario;
  parts.push(
    `推計シナリオ（利用者が設定した前提であり、正式な目標ではありません）：目標年度 ${sc.targetYear ?? UNCONFIRMED_TEXT}、売上高 ${formatMillionYenText(sc.revenueYen)}、営業利益 ${formatMillionYenText(sc.operatingIncomeYen)}。`,
  );
  const s4 = t.stage4Contributions;
  if (s4.revenueYen !== null) derived.yen.push(s4.revenueYen);
  if (s4.operatingIncomeYen !== null) derived.yen.push(s4.operatingIncomeYen);
  parts.push(
    `施策別の期待効果（STAGE4）の単純合計：売上高 ${formatMillionYenText(s4.revenueYen)}、営業利益 ${formatMillionYenText(s4.operatingIncomeYen)}（対象 ${s4.projectCount}件、金額未入力 ${s4.missingValueCount}件）。${s4.note}`,
  );

  // B. 投資・資金需要
  const inv = sections.investmentPlan;
  const invRows = inv.byFiscalYear.map((b) => {
    derived.yen.push(b.capexYen, b.opexReferenceYen, b.otherYen);
    return [`${b.fiscalYear}年`, formatMillionYen(b.capexYen), formatMillionYen(b.opexReferenceYen), formatMillionYen(b.otherYen)];
  });
  parts.push(`**B. 投資・資金需要${caption}**（決算月：${inv.fiscalYearEndMonth ? `${inv.fiscalYearEndMonth}月` : '未設定'}${inv.fiscalYearBucketing === 'CONFIRMED' ? '' : '、暦年仮定のため年度別の額は確定値ではありません'}）`);
  if (invRows.length > 0) {
    parts.push(mdTable(['年度', 'CAPEX（投資CFに計上）', 'OPEX（参考・営業CFに含む）', 'その他支出（参考）'], invRows));
  } else {
    parts.push('年度別の投資・費用はSTAGE4に登録されていません。');
  }
  const u = inv.unresolved;
  derived.yen.push(u.unclassifiedYen, u.unscheduledYen, u.candidateYen, u.basisPendingYen);
  parts.push(
    mdTable(
      ['未確定の区分', '金額', '件数', '扱い'],
      [
        ['分類未確定', formatMillionYen(u.unclassifiedYen), String(u.unclassifiedCount), '資金計画に含めていません'],
        ['時期未設定', formatMillionYen(u.unscheduledYen), '-', '資金計画に含めていません'],
        ['重複確認中（候補）', formatMillionYen(u.candidateYen), String(u.candidateCount), '合計に含めていません'],
        ['金額基準未確認', formatMillionYen(u.basisPendingYen), String(u.basisPendingCount), '合計に含めていません'],
      ],
    ),
  );
  const sourceRows = inv.sources.slice(0, SOURCE_ROW_LIMIT).map((s) => {
    for (const v of [s.amountYen, s.totalYen]) if (v !== null) derived.yen.push(v);
    const handling =
      s.duplicateStatus === 'CANDIDATE' ? '重複確認中（合計に含めていません）' : s.ready ? '算入' : '未確定（合計に含めていません）';
    return [s.projectTitle, s.label, s.category === 'UNCLASSIFIED' ? '分類未確定' : s.category, formatMillionYen(s.totalYen ?? s.amountYen), handling];
  });
  if (sourceRows.length > 0) {
    parts.push('**投資・費用の内訳（STAGE4）**');
    parts.push(mdTable(['施策', '項目', '区分', '金額', '扱い'], sourceRows));
    if (inv.sources.length > SOURCE_ROW_LIMIT) {
      parts.push(`ほか${inv.sources.length - SOURCE_ROW_LIMIT}件は省略しています。`);
    }
  }
  parts.push(inv.note);

  // C. キャッシュフロー
  const cfRows: string[][] = [];
  for (const y of sections.cashFlow.years.filter((r) => r.kind === 'FORECAST')) {
    const opening = val(y.openingCash);
    const ocf = val(y.operatingCf);
    const icf = val(y.investingCf);
    const pre = val(y.closingCashBeforeFinancing);
    const fin = val(y.financingCf);
    const post = val(y.closingCashAfterFinancing);
    const consistent =
      (opening === null || ocf === null || icf === null || pre === null || Math.abs(opening + ocf + icf - pre) <= CASH_TOLERANCE_YEN) &&
      (pre === null || fin === null || post === null || Math.abs(pre + fin - post) <= CASH_TOLERANCE_YEN);
    if (!consistent) issues.push(`${y.year}年：営業CF・投資CF・財務CFと現預金増減が一致しません`);
    const hide = !consistent;
    const cell = (v: number | null) => (hide ? '不整合のため未掲載' : formatMillionYen(v));
    if (!hide) {
      for (const v of [ocf, icf, val(y.fcf), fin, opening, post, val(y.minCash), val(y.postShortfall)]) {
        if (v !== null) derived.yen.push(v);
      }
    }
    cfRows.push([
      `${y.year}年`,
      cell(ocf),
      cell(icf),
      cell(val(y.fcf)),
      cell(fin),
      cell(opening),
      cell(post ?? pre),
      cell(val(y.minCash)),
      cell(val(y.postShortfall)),
    ]);
  }
  parts.push(`**C. キャッシュフロー${caption}**`);
  parts.push(
    mdTable(
      ['年度', '営業CF', '投資CF', 'フリーCF', '財務CF', '期首現預金', '期末現預金', '最低必要現預金', '資金不足額（借入反映後）'],
      cfRows,
    ),
  );

  // D. 借入・返済
  const debt = sections.debtRepayment;
  if (debt.entered) {
    const debtRows: string[][] = [];
    for (const d of debt.years) {
      const open = val(d.openingBalance);
      const draw = val(d.draw);
      const princ = val(d.principal);
      const close = val(d.closingBalance);
      const consistent = open === null || draw === null || princ === null || close === null
        ? true
        : Math.abs(open + draw - princ - close) <= CASH_TOLERANCE_YEN;
      if (!consistent) issues.push(`${d.year}年：借入残高と返済額が一致しません`);
      const cell = (v: number | null) => (!consistent ? '不整合のため未掲載' : formatMillionYen(v));
      if (consistent) {
        for (const v of [close, draw, princ, val(d.interest), val(d.debtService), val(d.dividends)]) {
          if (v !== null) derived.yen.push(v);
        }
      }
      const dscr = val(d.dscr);
      if (dscr !== null) derived.fractions.push(dscr);
      debtRows.push([
        `${d.year}年`,
        cell(close),
        cell(draw),
        cell(princ),
        cell(val(d.interest)),
        cell(val(d.debtService)),
        cell(val(d.dividends)),
        dscr === null ? UNCONFIRMED_TEXT : formatRatio(dscr),
        d.verdict,
      ]);
    }
    parts.push(`**D. 借入・返済計画${caption}**`);
    parts.push(
      mdTable(
        ['年度', '期末借入残高', '新規借入（想定額）', '元本返済', '支払利息', '元利返済', '配当', 'DSCR（参考指標）', '返済可能性の判定'],
        debtRows,
      ),
    );
    const stage1Debt = debt.reconciliation.stage1InterestBearingDebtYen;
    if (!debt.existingLoansEntered) {
      if (stage1Debt !== null) {
        derived.yen.push(stage1Debt);
        parts.push(
          `既存借入の明細は未入力です。STAGE1に登録された${sections.basisAndConstraints.bsBaseYear ?? UNCONFIRMED_TEXT}年末の有利子負債の合計は${formatMillionYenText(stage1Debt)}ですが、年度別の内訳と返済条件が未確認のため、既存借入の残高・利息・元利返済は未確定です。`,
        );
      } else {
        parts.push('既存借入の明細は未入力です。件数0として扱っていないため、既存借入の残高・利息・元利返済は未確定です。');
      }
    }
    if (debt.newLoansEntered) {
      const newRows = debt.years.map((d) => {
        const close = val(d.newClosingBalance);
        const princ = val(d.newPrincipal);
        const intr = val(d.newInterest);
        const service = princ !== null && intr !== null ? princ + intr : null;
        for (const v of [close, princ, intr, service]) if (v !== null) derived.yen.push(v);
        return [`${d.year}年`, formatMillionYen(close), formatMillionYen(princ), formatMillionYen(intr), formatMillionYen(service)];
      });
      parts.push('**新規借入の返済計画（計算可能な部分）**');
      parts.push(mdTable(['年度', '期末残高', '元本返済', '支払利息', '元利返済'], newRows));
      parts.push(
        '新規借入の返済計画は、入力された金額・金利・期間・据置・返済方式から計算しています。融資の承認を得た金額ではありません。',
      );
    }
    parts.push(
      'DSCRは「（営業CF＋支払利息）÷（元本返済＋支払利息）」の簡易指標であり、金融機関の審査指標とは異なります。新規借入の額は利用者が想定した額であり、融資の承認を得た金額ではありません。',
    );
  } else {
    parts.push('**D. 借入・返済計画**');
    parts.push('借入・返済計画は未入力のため、返済可能性の年度別評価は記載していません。');
  }

  // E. 前提
  const a = sections.basisAndConstraints;
  const minCash = a.assumptions.minCashYen;
  const baseRevenue = sections.financialTargets.baseYearRevenueYen;
  const minCashLooksMisscaled = minCash !== null && baseRevenue !== null && baseRevenue > 0 && minCash / baseRevenue >= 100;
  if (minCashLooksMisscaled) {
    issues.push('最低必要現預金が基準年度の売上高の100倍以上です（入力単位の確認が必要）');
  }
  const assumptionLines = [
    `基準年度：PL ${a.baseYear ?? UNCONFIRMED_TEXT}年、BS ${a.bsBaseYear ?? UNCONFIRMED_TEXT}年`,
    `決算月：${a.fiscalYearEndMonth ? `${a.fiscalYearEndMonth}月` : '未設定'}`,
    `税率：${formatPercent(sections.cashFlow.taxRate.value)}`,
    `減価償却費（年額）：${formatMillionYenText(val(sections.cashFlow.depreciation))}`,
    `最低必要現預金：${formatMillionYenText(minCash)}`,
    debt.existingLoansEntered
      ? `既存借入：${a.existingLoanCount}件`
      : '既存借入：明細未入力（0件とはしていません）',
    `新規借入（想定）：${a.newLoanCount}件`,
    'STAGE1の財務実績の単位：未確認。STAGE6の計算では、STAGE1の金額を円単位として扱っています。単位の確認が必要です。',
  ];
  if (minCashLooksMisscaled) {
    assumptionLines.push(
      '確認事項：最低必要現預金が基準年度の売上高の100倍以上です。入力単位（百万円）を確認してください。',
    );
  }
  parts.push('**E. 計算の前提**');
  parts.push(assumptionLines.map((l) => `- ${l}`).join('\n'));
  const holds = a.holds.slice(0, 10);
  if (holds.length > 0) parts.push(`確認事項：\n${holds.map((h) => `- ${h}`).join('\n')}`);

  // 参照値の集合（表示・引用されうる数値）
  collectAllowedFigures(sections, derived);

  const promptLines = [
    '【財務計画（計算済み・変更禁止）】',
    ...statusLines,
    '金額単位：百万円（小数第1位）。年度はSTAGE6の年度（決算期の終了年）。',
    ...revRows.map((r) => `${r[0]}（${r[1]}）：売上高 ${r[2]}、営業利益 ${r[3]}、営業利益率 ${r[4]}`),
    ...(s4.revenueYen !== null
      ? [`施策別期待効果（STAGE4・単純合計・重複未検証）：売上高 ${formatMillionYen(s4.revenueYen)}、営業利益 ${formatMillionYen(s4.operatingIncomeYen)}`]
      : []),
    ...invRows.map((r) => `${r[0]}の投資（CAPEX）：${r[1]}、OPEX参考：${r[2]}`),
    `未確定の投資・費用（合計に含めず）：分類未確定 ${formatMillionYen(u.unclassifiedYen)}、時期未設定 ${formatMillionYen(u.unscheduledYen)}、重複確認中 ${formatMillionYen(u.candidateYen)}`,
    ...cfRows.map((r) => `${r[0]}のキャッシュフロー：営業CF ${r[1]}、投資CF ${r[2]}、財務CF ${r[4]}、期末現預金 ${r[6]}、資金不足額 ${r[8]}`),
    ...(debt.entered
      ? debt.years.map(
          (d) =>
            `${d.year}年の借入：期末残高 ${formatMillionYen(val(d.closingBalance))}、元本返済 ${formatMillionYen(val(d.principal))}、支払利息 ${formatMillionYen(val(d.interest))}、DSCR ${formatRatio(val(d.dscr))}（参考指標）、判定：${d.verdict}`,
        )
      : ['借入・返済計画：未入力']),
  ];

  return {
    statusLines,
    markdown: parts.join('\n\n'),
    promptLines,
    allowed: derived,
    issues,
    usable: true,
  };
}
