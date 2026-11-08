import type { Department, FinancePLRow } from '@/types/strategy';

const MILLION = 1_000_000;

export type ExecutionCompanyContext = {
  department?: {
    name: string;
    strategicRole?: string;
    keyIssues: string[];
    interDeptCollab: string[];
    alignmentRisks: string[];
  };
  priorityThemes: string[];
  strategyExcerpt?: string;
  latestFinance?: {
    year: number;
    revenueMJPY: number | null;
    operatingIncomeMJPY: number | null;
    operatingMarginPct: number | null;
  };
};

const text = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

const list = (v: unknown, n: number, max = 120): string[] =>
  Array.isArray(v)
    ? v.map((x) => text(x, max)).filter((x): x is string => x !== undefined).slice(0, n)
    : [];

const round1 = (v: number) => Math.round(v * 10) / 10;

/** AI生成に渡す会社情報。記録済みの構造化データだけを使い、無い値は作らない（個人の感情メモ等は含めない） */
export function buildExecutionCompanyContext(args: {
  department?: Department | string | null;
  priorityThemes?: unknown;
  finalStory?: unknown;
  financePL?: FinancePLRow[] | null;
}): ExecutionCompanyContext {
  const out: ExecutionCompanyContext = { priorityThemes: list(args.priorityThemes, 5) };

  if (args.department && typeof args.department === 'object') {
    const d = args.department as Department;
    out.department = {
      name: text(d.name, 80) ?? '',
      strategicRole: text(d.strategicRole, 300),
      keyIssues: list(d.keyIssues, 5),
      interDeptCollab: list(d.interDeptCollab, 3),
      alignmentRisks: list(d.alignmentRiskPoints, 3),
    };
  }

  if (Array.isArray(args.finalStory)) {
    const excerpt = args.finalStory
      .map((ch: any) => {
        const title = text(ch?.title, 60);
        const body = text(ch?.body, 400);
        return [title, body].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
    if (excerpt) out.strategyExcerpt = excerpt.slice(0, 600);
  }

  if (Array.isArray(args.financePL)) {
    const rows = args.financePL
      .filter((r) => r && typeof r.year === 'number' && typeof r.revenue === 'number' && Number.isFinite(r.revenue) && r.revenue > 0)
      .sort((a, b) => b.year - a.year);
    const latest = rows[0];
    if (latest) {
      const op = typeof latest.operatingIncome === 'number' && Number.isFinite(latest.operatingIncome) ? latest.operatingIncome : null;
      out.latestFinance = {
        year: latest.year,
        revenueMJPY: round1(latest.revenue! / MILLION),
        operatingIncomeMJPY: op === null ? null : round1(op / MILLION),
        operatingMarginPct: op === null ? null : round1((op / latest.revenue!) * 100),
      };
    }
  }

  return out;
}
