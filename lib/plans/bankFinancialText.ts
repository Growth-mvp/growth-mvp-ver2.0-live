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
const FIGURE_TOKEN = /(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(百万円|億円|円|%|％|倍)/g;
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

const isBoundary = (line: string) =>
  /^#{1,6}\s/.test(line) || /^第[0-9一二三四五六七八九十]+章/.test(line) || /^【/.test(line) || /^\d+[\.．]\s/.test(line);

function findFinanceRegion(lines: string[]): Region | null {
  const start = lines.findIndex((l) => isBoundary(l.trim()) && FINANCE_HEADING.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isBoundary(lines[i].trim())) {
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

export function financialProseIssues(prose: string, allowed: AllowedFigures): string[] {
  const issues: string[] = [];
  for (const term of FORBIDDEN_TERMS) {
    if (prose.includes(term)) issues.push(`使用してはいけない表現を含みます：${term}`);
  }
  for (const m of prose.matchAll(FIGURE_TOKEN)) {
    const raw = m[1].replace(/,/g, '');
    const value = Number(raw);
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    if (!figureMatches(value, m[2], decimals, allowed)) {
      issues.push(`計算結果にない数値があります：${m[0]}`);
    }
  }
  return issues;
}

export function fallbackFinancialProse(facts: BankFinancialFacts): string {
  if (!facts.usable) {
    return [...facts.statusLines, '第4章の財務数値は、財務計画の確認が済むまで記載していません。'].join('\n\n');
  }
  return [
    '本章の財務数値は、STAGE6で作成した財務計画（下表）に基づきます。',
    '売上高と営業利益は、表Aの実績と推計のとおりです。推計は利用者が設定した前提によるもので、STAGE2の登録目標との差額を併記しています。',
    '投資は表Bのとおりです。分類未確定・時期未設定・重複確認中の金額は合計に含めず、別に示しています。',
    '資金の流れと返済可能性は、表C・表Dのとおりです。前提が変わると、資金不足の発生時期や返済可能性の判定は変わります。',
    '未確認事項は表Eの確認事項に示しています。',
  ].join('\n\n');
}

export function bankFinancialPromptText(block: BankFinancialPlanBlock | undefined): string {
  const facts = buildBankFinancialFacts(block);
  if (!facts) return '';
  return [
    ...facts.promptLines,
    '',
    '【財務記述の規則】',
    '1. 第4章（財務計画と返済可能性）では、上記の計算済み数値だけを引用すること。金額・比率・年数（返済額・借入額・投資額・DSCRなど）を新しく作らないこと。',
    `2. 第4章の中に「${BANK_TABLE_PLACEHOLDER}」という行を1つだけ書くこと。その位置に財務表を自動挿入する。財務表そのものは書かないこと。`,
    '3. 施策→投資→収益→キャッシュフロー→返済の因果関係を文章で説明し、前提が変わった場合の影響と未確認事項を明記すること。',
    '4. 「十分可能」「順調」「確実」などの断定、取締役会・金融機関の承認に関する記述、「CFO室」などの組織体制の推測は書かないこと。',
    '5. 参考値・未確定の数値は、その旨を本文で明記すること。',
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
    const proseIssues = financialProseIssues(prose, facts.allowed);
    issues.push(...proseIssues);
    const replacedProse = !facts.usable || proseIssues.length > 0;
    proseReplaced = replacedProse;
    const finalProse = replacedProse ? fallbackFinancialProse(facts) : prose.trim();

    const placeholderIndex = body.findIndex((l) => PLACEHOLDER_LINE.test(l));
    const before = (placeholderIndex >= 0 ? body.slice(0, placeholderIndex) : body).filter((l) => !PLACEHOLDER_LINE.test(l));
    const after = (placeholderIndex >= 0 ? body.slice(placeholderIndex + 1) : []).filter((l) => !PLACEHOLDER_LINE.test(l));
    const rebuilt = replacedProse
      ? facts.usable
        ? [finalProse, '', facts.markdown]
        : [finalProse]
      : [...before, '', facts.markdown, ...after];
    const outLines = [
      ...lines.slice(0, region.start + 1),
      ...rebuilt,
      ...lines.slice(region.end),
    ].map((l) => l.replace(PLACEHOLDER_ANY, ''));
    return {
      text: outLines.join('\n'),
      check: { applied: true, usable: facts.usable, regionFound: true, placeholderFound, proseReplaced, issues },
    };
  }

  if (!facts.usable) {
    return {
      text: text.replace(PLACEHOLDER_ANY, ''),
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
  return {
    text: text.replace(PLACEHOLDER_ANY, '').trimEnd() + '\n' + appended,
    check: { applied: true, usable: facts.usable, regionFound: false, placeholderFound, proseReplaced, issues },
  };
}
