/* EDINET の構造化データ（CSV）から、企業情報・5期の主要指標・連結財務諸表を取り出す。
 * 値は書類に書かれている値だけを使い、推測で補わない。主要指標（5期）と連結財務諸表（当期・前期）は
 * 同じ年度で照合し、一致した時だけ「連結」として扱う。単位は円のみ受け付ける。 */
import type { CsvRow } from './edinetZip';

export type FiscalYearPoint = { year: number; revenue?: number; operatingIncome?: number; netIncome?: number; totalAssets?: number; netAssets?: number };

export type CheckRecord = { metric: string; year: number; summary: number; statement: number; result: 'MATCH' | 'MISMATCH' };

export type ExtractedFacts = {
  periodEnd: string | null;
  fiscalYearEndMonth: number | null;
  fiscalYear: number | null;
  filerNameDei: string | null;
  companyName: string | null;
  address: string | null;
  exchange: string | null;
  employees: number | null;
  businessText: string | null;
  accountingStandard: string | null;
  pl: FiscalYearPoint[];
  bs: FiscalYearPoint[];
  checks: CheckRecord[];
  consolidationConfirmed: boolean;
  issues: string[];
};

const SUMMARY = {
  revenue: 'jpcrp_cor:NetSalesSummaryOfBusinessResults',
  netIncome: 'jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults',
  totalAssets: 'jpcrp_cor:TotalAssetsSummaryOfBusinessResults',
  netAssets: 'jpcrp_cor:NetAssetsSummaryOfBusinessResults',
} as const;

const STATEMENT = {
  revenue: 'jppfs_cor:NetSales',
  operatingIncome: 'jppfs_cor:OperatingIncome',
  netIncome: 'jppfs_cor:ProfitLossAttributableToOwnersOfParent',
  totalAssets: 'jppfs_cor:LiabilitiesAndNetAssets',
  netAssets: 'jppfs_cor:NetAssets',
} as const;

type Metric = keyof FiscalYearPoint & string;

/** 文脈名（CurrentYearDuration / Prior2YearInstant など）から、当期からの差（0が当期）を取り出す。会社別の部分（メンバー）付きは対象外 */
export function periodOffsetOf(contextId: string): number | null {
  const m = /^(CurrentYear|Prior(\d)Year)(Duration|Instant)$/.exec(contextId);
  if (!m) return null;
  return m[1] === 'CurrentYear' ? 0 : Number(m[2]);
}

function numberOf(value: string, unit: string): number | null {
  if (value === '' || value === '－' || value === '-') return null;
  if (unit !== '円' && unit !== '') return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function plainValue(rows: CsvRow[], elementId: string, contextId?: string): string | null {
  const hit = rows.find((r) => r.elementId === elementId && (contextId === undefined || r.contextId === contextId));
  return hit && hit.value !== '' ? hit.value : null;
}

function monthOf(periodEnd: string | null): number | null {
  const m = periodEnd ? /^\d{4}-(\d{2})-\d{2}$/.exec(periodEnd) : null;
  return m ? Number(m[1]) : null;
}

export function extractFacts(rows: CsvRow[]): ExtractedFacts {
  const issues: string[] = [];
  const periodEnd = plainValue(rows, 'jpdei_cor:CurrentFiscalYearEndDateDEI');
  const fiscalYearEndMonth = monthOf(periodEnd);
  const fiscalYear = periodEnd ? Number(periodEnd.slice(0, 4)) : null;
  if (fiscalYear === null) issues.push('当事業年度の終了日が取得できず、年度の対応は未確認');

  const byYear = new Map<number, FiscalYearPoint>();
  const point = (year: number): FiscalYearPoint => {
    let p = byYear.get(year);
    if (!p) {
      p = { year };
      byYear.set(year, p);
    }
    return p;
  };

  const summaryValues = new Map<string, number>();
  const statementValues = new Map<string, number>();
  for (const r of rows) {
    const offset = periodOffsetOf(r.contextId);
    if (offset === null || fiscalYear === null) continue;
    const year = fiscalYear - offset;
    const isSummary = Object.values(SUMMARY).includes(r.elementId as never) && r.scope === 'その他';
    const isStatement = Object.values(STATEMENT).includes(r.elementId as never) && r.scope === '連結';
    if (!isSummary && !isStatement) continue;
    const n = numberOf(r.value, r.unit);
    if (n === null) {
      if (r.value !== '' && r.value !== '－') issues.push(`単位が円ではない値を除外: ${r.elementId}`);
      continue;
    }
    const metric = (Object.keys(SUMMARY) as Metric[]).find((k) => SUMMARY[k as keyof typeof SUMMARY] === r.elementId)
      ?? (Object.keys(STATEMENT) as Metric[]).find((k) => STATEMENT[k as keyof typeof STATEMENT] === r.elementId);
    if (!metric) continue;
    if (isSummary) {
      summaryValues.set(`${metric}|${year}`, n);
    } else {
      statementValues.set(`${metric}|${year}`, n);
    }
  }

  const checks: CheckRecord[] = [];
  for (const [key, summary] of summaryValues) {
    const [metric, yearText] = key.split('|');
    const year = Number(yearText);
    const statement = statementValues.get(key);
    if (statement === undefined) continue;
    checks.push({ metric, year, summary, statement, result: summary === statement ? 'MATCH' : 'MISMATCH' });
  }
  // 連結財務諸表の値は、主要指標の表に無い期（営業利益など）を補うのに使う。照合で一致した期のみ連結として採用する。
  const consolidationConfirmed = checks.length > 0 && checks.every((c) => c.result === 'MATCH');
  if (!consolidationConfirmed) issues.push('主要指標と連結財務諸表の照合が取れず、連結としての確認はできていない');
  for (const c of checks.filter((x) => x.result === 'MISMATCH')) {
    issues.push(`照合不一致（${c.metric} ${c.year}年度）: 主要指標 ${c.summary} / 連結財務諸表 ${c.statement}`);
  }

  // 照合が取れた時だけ、主要指標（5期）と連結財務諸表（当期・前期）を採用する。取れなければ数値は出さない。
  if (consolidationConfirmed) {
    for (const [key, summary] of summaryValues) {
      const [metric, yearText] = key.split('|');
      (point(Number(yearText)) as Record<string, unknown>)[metric] = summary;
    }
    for (const [key, statement] of statementValues) {
      const [metric, yearText] = key.split('|');
      const p = point(Number(yearText)) as Record<string, unknown>;
      if (p[metric] === undefined) p[metric] = statement;
    }
  }

  const pl = [...byYear.values()]
    .filter((p) => p.revenue !== undefined || p.operatingIncome !== undefined || p.netIncome !== undefined)
    .map((p) => ({ year: p.year, revenue: p.revenue, operatingIncome: p.operatingIncome, netIncome: p.netIncome }))
    .sort((a, b) => a.year - b.year);
  const bs = [...byYear.values()]
    .filter((p) => p.totalAssets !== undefined || p.netAssets !== undefined)
    .map((p) => ({ year: p.year, totalAssets: p.totalAssets, netAssets: p.netAssets }))
    .sort((a, b) => a.year - b.year);

  const employeesRow = rows.find((r) => r.elementId === 'jpcrp_cor:NumberOfEmployees' && r.contextId === 'CurrentYearInstant');
  const employees = employeesRow ? numberOf(employeesRow.value, '') : null;
  if (employees !== null) issues.push('従業員数は、連結・単体の区分を書類の要素から確定できない（未確認として扱う）');
  const exchangeRow = rows.find((r) => r.elementId.startsWith('jpcrp_cor:NameOfFinancialInstrumentsExchangeOnWhichSecuritiesAreListed') && r.value !== '');

  return {
    periodEnd,
    fiscalYearEndMonth,
    fiscalYear,
    filerNameDei: plainValue(rows, 'jpdei_cor:FilerNameInJapaneseDEI'),
    companyName: plainValue(rows, 'jpcrp_cor:CompanyNameCoverPage'),
    address: plainValue(rows, 'jpcrp_cor:AddressOfRegisteredHeadquarterCoverPage'),
    exchange: exchangeRow?.value ?? null,
    employees,
    businessText: plainValue(rows, 'jpcrp_cor:DescriptionOfBusinessTextBlock'),
    accountingStandard: plainValue(rows, 'jpdei_cor:AccountingStandardsDEI'),
    pl,
    bs,
    checks,
    consolidationConfirmed,
    issues,
  };
}
