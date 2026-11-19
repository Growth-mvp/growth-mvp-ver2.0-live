import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { buildBankFinancialFacts, type BankFinancialFacts } from './bankFinancialDocument';
import type { AllowedFigures } from './bankFinancialFormat';

export const BANK_TABLE_PLACEHOLDER = '[[BANK_FINANCIAL_TABLES]]';
const PLACEHOLDER_LINE = /^\s*\[\[BANK_FINANCIAL_TABLES\]\]\s*$/;
const PLACEHOLDER_ANY = /\[\[BANK_FINANCIAL_TABLES\]\]/g;
const FINANCE_HEADING = /財務計画|返済可能性|資金計画/;
const FORBIDDEN_TERMS = [
  'CFO室',
  '十分可能',
  '順調',
  '確実に',
  '取締役会で承認',
  '取締役会の承認',
  '金融機関が承認',
  '金融機関の承認を得',
  'partial',
  'STALE',
  'CURRENT',
  'numbersConfirmed',
  'NOT_SAVED',
  'INVALID',
  'DIFFERENT_COMPANY',
  'UNAVAILABLE',
  'incomplete',
];
const FIGURE_TOKEN = /([¥￥]\s*)?((?<![\d.])[-−▲△])?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(百万円|億円|円|%|％|倍|M)?/g;
const MONETARY_UNITS = new Set(['百万円', '億円', '円', 'M']);
const NUMBERED_HEADING = /^(?:#{1,6}\s*)?(\d+)[\.．]\s/;
const MILLION_YEN = 1_000_000;
const OKU_YEN = 100_000_000;

export type BankFinanceCheck = {
  applied: boolean;
  usable: boolean;
  regionFound: boolean;
  placeholderFound: boolean;
  proseReplaced: boolean;
  issues: string[];
};

type Region = { start: number; end: number };
type FigureToken = RegExpMatchArray;

const isHeadingLine = (line: string) =>
  /^#{1,6}\s/.test(line) || /^第[0-9一二三四五六七八九十]+章/.test(line) || /^【/.test(line);

/* 章の終わり：章の見出し（# ・第N章）と、次の章の番号の見出しだけ。小見出しでは区切らない */
function endsChapter(t: string, chapterNumber: number | null): boolean {
  if (/^#\s/.test(t) || /^第[0-9一二三四五六七八九十]+章/.test(t)) return true;
  const number = t.match(NUMBERED_HEADING)?.[1];
  return number !== undefined && chapterNumber !== null && Number(number) === chapterNumber + 1;
}

function findFinanceRegion(lines: string[]): Region | null {
  const start = lines.findIndex((l) => {
    const t = l.trim();
    return (isHeadingLine(t) || NUMBERED_HEADING.test(t)) && FINANCE_HEADING.test(l);
  });
  if (start < 0) return null;
  const startNumber = lines[start].trim().match(NUMBERED_HEADING)?.[1];
  const chapterNumber = startNumber === undefined ? null : Number(startNumber);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (endsChapter(lines[i].trim(), chapterNumber)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function figureMatches(value: number, unit: string, decimals: number, allowed: AllowedFigures): boolean {
  if (value === 0) return true;
  const half = 0.5 * Math.pow(10, -decimals);
  if (unit === '%' || unit === '％') {
    return allowed.fractions.some((f) => Math.abs(f - value / 100) <= half / 100 + 1e-9);
  }
  if (unit === '倍') {
    return [...allowed.fractions, ...allowed.yen].some((f) => Math.abs(f - value) <= half + 1e-9);
  }
  const factor = unit === '百万円' ? MILLION_YEN : unit === '億円' ? OKU_YEN : 1;
  const tolerance = half * factor;
  return allowed.yen.some((y) => Math.abs(y - value * factor) <= tolerance + 1e-6);
}

function tokenMatchesAllowed(m: FigureToken, allowed: AllowedFigures): boolean {
  const [, , sign, numberText, unitText] = m;
  const raw = numberText.replace(/,/g, '');
  const value = (sign ? -1 : 1) * Number(raw);
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  const unit = unitText === 'M' ? '百万円' : (unitText ?? '円');
  return figureMatches(value, unit, decimals, allowed);
}

/* 金額の数字（¥・円・百万円・億円）。年数・回数・％などは対象にしない */
function monetaryTokens(text: string): FigureToken[] {
  return [...text.matchAll(FIGURE_TOKEN)].filter((m) => {
    const [, yenPrefix, , , unitText] = m;
    if (!yenPrefix && !unitText) return false;
    return yenPrefix !== undefined || MONETARY_UNITS.has(unitText ?? '');
  });
}

/* 文の中に、条件に合わない金額があれば、その文を取り除く（行の残りは保つ） */
function dropSentencesWithFigures(text: string, keep: (m: FigureToken) => boolean): { text: string; removed: number } {
  let removed = 0;
  const lines = text.split('\n').map((line) => {
    if (monetaryTokens(line).length === 0) return line;
    const parts = line.split(/(?<=。)/);
    const kept = parts.filter((part) => {
      const ok = monetaryTokens(part).every(keep);
      if (!ok) removed += 1;
      return ok;
    });
    return kept.join('');
  });
  return { text: lines.join('\n'), removed };
}

/* 禁止する表現（断定・承認・組織の推測など）。数値とは別に、文章全体で確かめる */
export function forbiddenTermIssues(prose: string): string[] {
  return FORBIDDEN_TERMS.filter((term) => prose.includes(term)).map((term) => `使用してはいけない表現を含みます：${term}`);
}

export function financialProseIssues(prose: string, allowed: AllowedFigures): string[] {
  const issues = forbiddenTermIssues(prose);
  for (const m of monetaryTokens(prose)) {
    if (!tokenMatchesAllowed(m, allowed)) issues.push(`計算結果にない数値があります：${m[0].trim()}`);
  }
  return issues;
}

const BASIS_SENTENCE: Record<NonNullable<BankFinancialFacts['calculationBasis']> | 'NONE', string> = {
  BASE_SCENARIO:
    '既存事業の売上高・営業利益は、利用者が年度ごとに入力した直近実績からの増減を反映しています。空欄の年度は直近実績のまま横ばいとし、片方だけ入力した場合は空欄の側を未算定としています。',
  FLAT: '既存事業の売上高・営業利益は、増減の入力がないため直近実績の横ばいとしています。',
  TARGET_PATH: '既存事業の売上高・営業利益は、保存された財務計画の前提に基づきます。',
  FINANCE_OUTLOOK: '既存事業の売上高・営業利益は、保存された財務計画の前提に基づきます。',
  NONE: '既存事業の売上高・営業利益は、保存された財務計画の前提に基づきます。',
};

/* 計画書の数値は、計算済みの年度・指標・金額を1行ずつ並べた文と、下表から示す（本文の数値はこの文だけ） */
function keyNumbersBlock(facts: BankFinancialFacts): string {
  if (facts.keyLines.length === 0) return '';
  return ['計算結果（百万円）：', ...facts.keyLines.map((l) => `- ${l}`)].join('\n');
}

export function fallbackFinancialProse(facts: BankFinancialFacts): string {
  if (!facts.usable) {
    return [...facts.statusLines, '第4章の財務数値は、財務計画の確認が済むまで記載していません。'].join('\n\n');
  }
  return [
    '本章の財務数値は、作成した財務計画から計算した結果です。',
    keyNumbersBlock(facts),
    BASIS_SENTENCE[facts.calculationBasis ?? 'NONE'],
    '登録済みの施策の財務効果は、既存事業の数値に加算しています。経営目標への直線補間は参考経路であり、本章の数値には使っていません。',
    '投資は表Bのとおりです。分類未確定・時期未設定・重複確認中の金額は合計に含めず、別に示しています。',
    '資金の流れと返済可能性は、表C・表Dのとおりです。前提が変わると、資金不足の発生時期や返済可能性の判定は変わります。',
    '未確認事項は表Eの確認事項に示しています。',
  ]
    .filter((p) => p !== '')
    .join('\n\n');
}

export function bankFinancialPromptText(block: BankFinancialPlanBlock | undefined): string {
  const facts = buildBankFinancialFacts(block);
  if (!facts) return '';
  return [
    ...facts.promptLines,
    '',
    '【財務記述の規則】',
    `1. 第4章（財務計画と返済可能性）では、金額・比率・年数を書かないこと。数値は計算結果の文と財務表で自動的に示される。第4章では、施策の背景・意義・因果関係（施策→投資→収益→キャッシュフロー→返済）と前提が変わった場合の影響を説明すること。`,
    `2. 第4章の中に「${BANK_TABLE_PLACEHOLDER}」という行を1つだけ書くこと。その位置に財務表を自動挿入する。財務表そのものは書かないこと。`,
    '3. 施策→投資→収益→キャッシュフロー→返済の因果関係を文章で説明し、前提が変わった場合の影響と未確認事項を明記すること。',
    '4. 「十分可能」「順調」「確実」などの断定、取締役会・金融機関の承認に関する記述、「CFO室」などの組織体制の推測は書かないこと。',
    '5. 参考値・未確定の数値は、その旨を本文で明記すること。',
    '6. 承認状態・参考値・単位などの注意事項は、本文中で一度だけ明記し、同じ内容を繰り返さないこと。',
    '7. 施策は主要な施策のみ本文で取り上げ、全件を列挙しないこと。全件は参考資料に掲載される。',
  ].join('\n');
}

export function finalizeBankPlanText(
  text: string,
  block: BankFinancialPlanBlock | undefined,
): { text: string; check: BankFinanceCheck } {
  const facts = buildBankFinancialFacts(block);
  if (!facts) {
    return {
      text,
      check: { applied: false, usable: false, regionFound: false, placeholderFound: false, proseReplaced: false, issues: [] },
    };
  }

  const lines = text.split('\n');
  const region = findFinanceRegion(lines);
  const placeholderFound = PLACEHOLDER_ANY.test(text);
  PLACEHOLDER_ANY.lastIndex = 0;
  const issues: string[] = [...facts.issues];
  let proseReplaced = false;

  if (region) {
    const body = lines.slice(region.start + 1, region.end);
    const prose = body.filter((l) => !PLACEHOLDER_LINE.test(l)).join('\n');
    const forbidden = forbiddenTermIssues(prose);
    issues.push(...forbidden);
    const replacedProse = !facts.usable || forbidden.length > 0;
    proseReplaced = replacedProse;

    // 表の挿入位置（プレースホルダーの前後）は保ち、その間の文章も金額を含む文を除いて使う
    const placeholderIndex = body.findIndex((l) => PLACEHOLDER_LINE.test(l));
    const beforeRaw = (placeholderIndex >= 0 ? body.slice(0, placeholderIndex) : body).filter((l) => !PLACEHOLDER_LINE.test(l)).join('\n');
    const afterRaw = (placeholderIndex >= 0 ? body.slice(placeholderIndex + 1) : []).filter((l) => !PLACEHOLDER_LINE.test(l)).join('\n');
    const beforeClean = dropSentencesWithFigures(beforeRaw, () => false);
    const afterClean = dropSentencesWithFigures(afterRaw, () => false);
    const removedInRegion = beforeClean.removed + afterClean.removed;
    if (removedInRegion > 0) {
      issues.push(`第4章の金額を含む文を${removedInRegion}件取り除きました（金額は計算結果の文と表で示します）`);
    }

    const rebuilt = replacedProse
      ? [fallbackFinancialProse(facts), ...(facts.usable ? ['', facts.markdown] : [])]
      : [keyNumbersBlock(facts), beforeClean.text.trim(), '', facts.markdown, afterClean.text.trim()].filter((p) => p !== '');
    const head = sanitizeOutsideRegion(lines.slice(0, region.start + 1), facts, issues);
    const tail = sanitizeOutsideRegion(lines.slice(region.end), facts, issues);
    const outLines = [...head, ...rebuilt, ...tail].map((l) => l.replace(PLACEHOLDER_ANY, ''));
    return {
      text: outLines.join('\n'),
      check: { applied: true, usable: facts.usable, regionFound: true, placeholderFound, proseReplaced, issues },
    };
  }

  if (!facts.usable) {
    const sanitized = sanitizeOutsideRegion(text.replace(PLACEHOLDER_ANY, '').split('\n'), facts, issues);
    return {
      text: sanitized.join('\n'),
      check: { applied: false, usable: false, regionFound: false, placeholderFound, proseReplaced: false, issues },
    };
  }

  const appended = [
    '',
    '【財務計画・返済可能性（財務表）】',
    '',
    fallbackFinancialProse(facts),
    '',
    facts.markdown,
  ].join('\n');
  proseReplaced = true;
  const sanitized = sanitizeOutsideRegion(text.replace(PLACEHOLDER_ANY, '').trimEnd().split('\n'), facts, issues);
  return {
    text: sanitized.join('\n') + '\n' + appended,
    check: { applied: true, usable: facts.usable, regionFound: false, placeholderFound, proseReplaced, issues },
  };
}

/* 第4章以外の本文：計算結果に無い金額（計算できない場合は、すべての金額）を含む文は取り除く */
function sanitizeOutsideRegion(lines: string[], facts: BankFinancialFacts, issues: string[]): string[] {
  const keep = (m: FigureToken) => facts.usable && tokenMatchesAllowed(m, facts.allowed);
  let removed = 0;
  const sanitized = lines.map((line) => {
    const cleaned = dropSentencesWithFigures(line, keep);
    removed += cleaned.removed;
    return cleaned.text;
  });
  if (removed > 0) issues.push(`第4章以外の本文で、計算結果にない金額を含む文を${removed}件取り除きました`);
  return sanitized;
}
