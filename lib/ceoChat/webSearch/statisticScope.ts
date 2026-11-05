/**
 * 外部統計の対象期間・製品区分・数値の照合。
 * 文字列から推定はしない。元資料に書かれた期間・区分だけを判定し、判定できない場合は unknown とする。
 */

export type PeriodKind = 'calendar_year' | 'fiscal_year' | 'partial' | 'monthly' | 'unknown';

const RANGE = /(\d{4})\s*年\s*(\d{1,2})\s*月?\s*[〜~～\-–—ー－]\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/;
const PART_OF_YEAR = /上半期|下半期|第?[1-4]\s*四半期|[Qq][1-4]\b|累計|累積|年初来/;
const SINGLE_MONTH = /(\d{4})\s*年\s*(\d{1,2})\s*月(?!\s*期)/;

export function classifyStatisticPeriod(period: string | null | undefined): PeriodKind {
  const text = (period ?? '').normalize('NFKC').trim();
  if (!text) return 'unknown';

  const range = RANGE.exec(text);
  if (range) {
    const y1 = Number(range[1]);
    const m1 = Number(range[2]);
    const y2 = range[3] ? Number(range[3]) : y1;
    const m2 = Number(range[4]);
    if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return 'unknown';
    if (y1 === y2 && m1 === 1 && m2 === 12) return 'calendar_year';
    if (y2 === y1 + 1 && m1 === 4 && m2 === 3) return 'fiscal_year';
    if (y1 === y2 && m1 === m2) return 'monthly';
    return 'partial';
  }
  if (PART_OF_YEAR.test(text)) return 'partial';
  if (SINGLE_MONTH.test(text)) return 'monthly';
  return 'unknown';
}

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  calendar_year: '暦年の通年',
  fiscal_year: '年度の通年',
  partial: '部分期間（通年実績ではない）',
  monthly: '月次（年間実績ではない）',
  unknown: '不明（通年と断定しない）',
};

/** 製品区分の名称だけを対象にする。「金属缶」などの広い区分は、区分の特定に使わない */
const PRODUCT_SCOPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['200L缶', /200\s*(?:L|リットル)/i],
  ['18L缶', /18\s*(?:L|リットル)|一斗缶/i],
  ['ペール缶', /ペール缶/],
  ['ドラム缶', /ドラム缶/],
  ['美術缶', /美術缶|装飾缶/],
];

/** 工業会・協会などの団体名は、製品区分の判定から外す（「ドラム缶工業会」の統計を200L缶と誤認しないため） */
const ORGANIZATION_NAME = /[ァ-ヶー一-龠々]{0,12}(?:工業会|協会|組合|連合会|連盟|協議会|学会|研究会|研究所|機構|センター|委員会)/g;

export function productScopesIn(text: string): string[] {
  const t = (text ?? '').normalize('NFKC').replace(ORGANIZATION_NAME, ' ');
  return PRODUCT_SCOPES.filter(([, re]) => re.test(t)).map(([label]) => label);
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]）】」。、，]+/g;
const DATE_LIKE = /\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{4}\s*年(?:\s*\d{1,2}\s*月)?(?:\s*\d{1,2}\s*日)?/g;

/** 本文中の数値（URL・日付・一桁の番号は除く）。照合用であり、表示には使わない */
export function numericTokens(text: string): Set<string> {
  const t = (text ?? '').normalize('NFKC').replace(URL_PATTERN, ' ').replace(DATE_LIKE, ' ');
  const out = new Set<string>();
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const token = m[0];
    const next = t.charAt((m.index ?? 0) + token.length);
    if (/[年月日時分]/.test(next)) continue;
    if (next === '.' && !/\d/.test(t.charAt((m.index ?? 0) + token.length + 1))) continue;
    const normalized = token.replace(/,/g, '');
    if (normalized.replace('.', '').length < 2) continue;
    out.add(normalized);
  }
  return out;
}

/** 回答の数値のうち、検索で得た事実のどこにも現れないものの件数（自社データ由来の数値も含む上限値） */
export function countUnmatchedNumbers(answer: string, basisTexts: readonly string[]): number {
  const basis = new Set<string>();
  for (const text of basisTexts) for (const n of numericTokens(text)) basis.add(n);
  let unmatched = 0;
  for (const n of numericTokens(answer)) if (!basis.has(n)) unmatched += 1;
  return unmatched;
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const CLAIM = /(\d[\d,]*(?:\.\d+)?)\s*(%|千トン|万トン|千本|千缶|トン)/g;
const INDICATORS = ['出荷', '生産', '売上', '販売', '受注', '在庫'];
const ANNUAL_WORD = /年間|通年|年度/;
const NOT_ANNUAL_CLAIM = /ではな|ではあり|とは直接|比較できな|区別|とは限らな|扱わな|とは言えな/;
const EXTERNAL_CONTEXT = /市場|業界|統計|出典|公開|外部|検索/;
const DIRECTION_WINDOW = 8;

const normalizeNumber = (token: string) => token.replace(/,/g, '');

const URL_TEXT = /https?:\/\/[^\s<>"'`)\]）】」]+/g;
const withoutUrls = (text: string): string => text.replace(URL_TEXT, ' ');

function allNumbers(text: string): Set<string> {
  return new Set([...withoutUrls((text ?? '').normalize('NFKC')).matchAll(NUMBER)].map((m) => normalizeNumber(m[0])));
}

/** 数値の直後の短い範囲から増減方向を読む。方向が読めなければ null */
function directionAfter(text: string, value: string): Array<'up' | 'down'> {
  const dirs: Array<'up' | 'down'> = [];
  for (const m of text.matchAll(NUMBER)) {
    if (normalizeNumber(m[0]) !== value) continue;
    const window = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + DIRECTION_WINDOW);
    if (/減|下回/.test(window)) dirs.push('down');
    else if (/増|上回/.test(window)) dirs.push('up');
  }
  return dirs;
}

function sentenceAround(text: string, index: number): string {
  const before = Math.max(text.lastIndexOf('。', index), text.lastIndexOf('\n', index));
  const afterDot = text.indexOf('。', index);
  const afterLine = text.indexOf('\n', index);
  const ends = [afterDot, afterLine].filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) : text.length;
  return text.slice(before + 1, end);
}

const yearsIn = (text: string): string[] => [...(text ?? '').matchAll(/(20\d{2})/g)].map((m) => m[1]);

export type StatClaimFinding = {
  kind: 'unsourced' | 'direction' | 'period' | 'product' | 'indicator' | 'internal';
  value: string;
};

export type StatClaimCheck = {
  checked: number;
  unverifiable: number;
  findings: StatClaimFinding[];
};

type CheckableFact = { text: string; period: string | null; sources?: ReadonlyArray<{ title: string }> };

/**
 * 回答の「数値＋単位」を、検索で得た事実と照合する。
 * 文字列の一致だけでなく、期間・製品区分・指標・増減方向が事実と矛盾しないかを見る。
 * 照合できない数値は根拠なしとして注記する。回答本文は変更しない。
 */
export function checkStatisticClaims(
  answer: string,
  facts: ReadonlyArray<CheckableFact>,
  internalTexts: ReadonlyArray<string> = []
): StatClaimCheck {
  const result: StatClaimCheck = { checked: 0, unverifiable: 0, findings: [] };
  if (facts.length === 0) return result;

  const text = withoutUrls((answer ?? '').normalize('NFKC'));
  const internal = new Set<string>();
  for (const t of internalTexts) for (const n of allNumbers(t)) internal.add(n);
  const basis = facts.map((f) =>
    withoutUrls(`${f.text} ${(f.sources ?? []).map((s) => s.title).join(' ')}`).normalize('NFKC')
  );
  const factNumbers = basis.map((b) => allNumbers(b));

  for (const m of text.matchAll(CLAIM)) {
    const value = normalizeNumber(m[1]);
    const label = `${m[1]}${m[2]}`;
    const index = m.index ?? 0;
    const sentence = sentenceAround(text, index);
    const answerDirs = directionAfter(text.slice(index), value).slice(0, 1);
    const answerDir = answerDirs[0] ?? null;
    result.checked += 1;

    const candidates = facts.flatMap((f, i) => (factNumbers[i].has(value) ? [i] : []));
    if (candidates.length === 0) {
      if (internal.has(value) && EXTERNAL_CONTEXT.test(sentence)) {
        result.findings.push({ kind: 'internal', value: label });
      } else if (!internal.has(value)) {
        result.findings.push({ kind: 'unsourced', value: label });
      }
      continue;
    }

    const failures: StatClaimFinding['kind'][] = [];
    let passed = false;
    let unknownDirection = false;
    for (const i of candidates) {
      const f = facts[i];
      const reasons: StatClaimFinding['kind'][] = [];
      const factDirs = directionAfter(basis[i], value);
      if (answerDir && factDirs.length > 0 && !factDirs.includes(answerDir)) reasons.push('direction');

      const sentenceYears = yearsIn(sentence);
      const periodYears = yearsIn(f.period ?? '');
      if (sentenceYears.length && periodYears.length && !sentenceYears.some((y) => periodYears.includes(y))) {
        reasons.push('period');
      }
      const periodKind = classifyStatisticPeriod(f.period);
      if (
        ANNUAL_WORD.test(sentence) &&
        !NOT_ANNUAL_CLAIM.test(sentence) &&
        (periodKind === 'partial' || periodKind === 'monthly')
      ) {
        reasons.push('period');
      }

      const sentenceScopes = productScopesIn(sentence);
      const factScopes = productScopesIn(basis[i]);
      if (sentenceScopes.length && !sentenceScopes.some((s) => factScopes.includes(s))) reasons.push('product');

      const sentenceIndicators = INDICATORS.filter((w) => sentence.includes(w));
      const factIndicators = INDICATORS.filter((w) => basis[i].includes(w));
      if (
        sentenceIndicators.length &&
        factIndicators.length &&
        !sentenceIndicators.some((w) => factIndicators.includes(w))
      ) {
        reasons.push('indicator');
      }

      if (reasons.length === 0) {
        passed = true;
        if (factDirs.length === 0) unknownDirection = true;
        break;
      }
      failures.push(...reasons);
    }

    if (passed) {
      if (unknownDirection) result.unverifiable += 1;
    } else {
      result.findings.push({ kind: failures[0] ?? 'unsourced', value: label });
    }
  }

  return result;
}

const FINDING_LABEL: Record<StatClaimFinding['kind'], string> = {
  unsourced: '出典にない数値',
  direction: '増減方向が出典と異なる',
  period: '対象期間が出典と異なる、または部分期間を年間として書いている',
  product: '製品区分が出典と異なる、または出典に区分がない',
  indicator: '統計指標が出典と異なる',
  internal: '今回の検索結果になく、社内データ・会話履歴にのみある数値',
};

/** 注記の本文。該当する数値と理由だけを示し、回答の本文は引用しない */
export function buildStatClaimNotice(findings: StatClaimFinding[]): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const f of findings) {
    const key = `${f.kind}:${f.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`${f.value}（${FINDING_LABEL[f.kind]}）`);
  }
  if (items.length === 0) return '';
  const shown = items.slice(0, 5).join('、');
  return `【数値の確認】次の数値は、今回の検索で得た出典の事実と一致することを確認できませんでした: ${shown}。断定せず、出典の原文で確認してから判断してください。`;
}

export type StatisticCounts = {
  annual: number;
  partial: number;
  monthly: number;
  unknownPeriod: number;
  productScopeKnown: number;
};

export function statisticCounts(facts: ReadonlyArray<{ text: string; period: string | null }>): StatisticCounts {
  const counts: StatisticCounts = { annual: 0, partial: 0, monthly: 0, unknownPeriod: 0, productScopeKnown: 0 };
  for (const f of facts) {
    const kind = classifyStatisticPeriod(f.period);
    if (kind === 'calendar_year' || kind === 'fiscal_year') counts.annual += 1;
    else if (kind === 'partial') counts.partial += 1;
    else if (kind === 'monthly') counts.monthly += 1;
    else counts.unknownPeriod += 1;
    if (productScopesIn(f.text).length > 0) counts.productScopeKnown += 1;
  }
  return counts;
}
