import type { CompanyTarget, MidtermStrategy, StoryChapter } from '@/types/strategy';
import { pickFinancialTargets } from './finalDocument';

export type DocumentCheckIssue =
  | { kind: 'target_mismatch'; metric: '売上' | '営業利益'; targetText: string; mentions: string[] }
  | { kind: 'internal_term'; snippets: string[] }
  | { kind: 'midterm_missing' }
  | { kind: 'field_missing'; label: string };

const KEY_MIDTERM_FIELDS: Array<[keyof MidtermStrategy, string]> = [
  ['targetVisionForMidterm', '目指す姿'],
  ['priorityStrategicThemes', '重点戦略テーマ'],
  ['companyWideDecisionCriteria', '全社共通の判断基準'],
  ['deploymentPrinciplesForUnits', '部門・社員への展開方針'],
];

const UNIT_TO_OKU: Record<string, number> = {
  円: 1e-8,
  千円: 1e-5,
  万円: 1e-4,
  百万円: 1e-2,
  億円: 1,
};

const MONEY_MENTION = /(売上高|売上|営業利益)([^。\n、]{0,24}?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(億円|百万円|万円|千円)/g;
const INTERNAL_TERM = /STAGE\s*\d/gi;

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 12);
  return text.slice(start, Math.min(text.length, index + length + 12)).replace(/\s+/g, ' ');
}

function targetToOku(base: number, unit: string): number | null {
  const factor = UNIT_TO_OKU[unit.trim()];
  return factor == null ? null : base * factor;
}

function sameOku(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

/** 確定前の検査。内容は変更せず、利用者が確認すべき点だけを返す */
export function runDocumentChecks(input: {
  chapters: StoryChapter[];
  conclusion: string;
  midtermStrategy?: MidtermStrategy;
  companyTargets?: CompanyTarget[];
}): DocumentCheckIssue[] {
  const issues: DocumentCheckIssue[] = [];
  const texts = [input.conclusion, ...input.chapters.map((c) => c.body)].filter(Boolean);

  const targets = pickFinancialTargets(input.companyTargets);
  for (const [metric, row] of [
    ['売上', targets.revenue],
    ['営業利益', targets.operatingProfit],
  ] as const) {
    if (!row) continue;
    const targetOku = targetToOku(row.base, row.unit);
    if (targetOku == null) continue;
    const mentions: string[] = [];
    for (const text of texts) {
      for (const m of text.matchAll(MONEY_MENTION)) {
        if (m[1] === '売上高' ? metric !== '売上' : m[1] !== metric) continue;
        const value = Number(m[3].replace(/,/g, ''));
        const oku = targetToOku(value, m[4]);
        if (oku != null && !sameOku(oku, targetOku)) {
          mentions.push(snippetAround(text, m.index ?? 0, m[0].length));
        }
      }
    }
    if (mentions.length > 0) {
      const targetText = `${row.base.toLocaleString('ja-JP')} ${row.unit}`;
      issues.push({ kind: 'target_mismatch', metric, targetText, mentions });
    }
  }

  const internalSnippets: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(INTERNAL_TERM)) {
      internalSnippets.push(snippetAround(text, m.index ?? 0, m[0].length));
    }
  }
  if (internalSnippets.length > 0) issues.push({ kind: 'internal_term', snippets: internalSnippets });

  if (!input.midtermStrategy) {
    issues.push({ kind: 'midterm_missing' });
  } else {
    for (const [key, label] of KEY_MIDTERM_FIELDS) {
      const value = input.midtermStrategy[key];
      const filled = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
      if (!filled) issues.push({ kind: 'field_missing', label });
    }
  }

  return issues;
}
