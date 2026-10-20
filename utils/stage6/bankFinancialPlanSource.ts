/* eslint-disable @typescript-eslint/no-explicit-any -- DBから取得した未型付けの行を扱うため */
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { normalizeFiscalYearEnd } from './fiscalYear';

export type Stage6SourceInputs = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  departments: Department[];
  fiscalYearEnd: string | undefined;
  companyTargets: unknown[];
  storedFinancePlan: unknown;
};

type AnyRecord = Record<string, any>;

const ensureArray = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function unwrapCsvFinanceData(value: unknown): AnyRecord {
  let current: unknown = value;
  let guard = 100;
  while (guard-- > 0) {
    if (current === null || current === undefined) return {};
    if (typeof current !== 'object') return {};
    if (Array.isArray(current)) {
      if (current.length === 1) {
        current = current[0];
        continue;
      }
      return {};
    }
    const keys = Object.keys(current as AnyRecord);
    if (keys.length === 1 && /^\d+$/.test(keys[0])) {
      current = (current as AnyRecord)[keys[0]];
      continue;
    }
    break;
  }
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    return current as AnyRecord;
  }
  return {};
}

const normalizeTitle = (t: unknown) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function matchDepartment(raw: AnyRecord, normalized: AnyRecord): boolean {
  if (raw.id && normalized.id) return raw.id === normalized.id;
  return raw.name === normalized.name;
}

function matchProject(raw: AnyRecord, normalized: AnyRecord): boolean {
  if (raw.id && normalized.id) return String(raw.id) === String(normalized.id);
  return normalizeTitle(raw.title) === normalizeTitle(normalized.title);
}

function restoreOkrsV2(normalizedDepts: AnyRecord[], rawDepts: AnyRecord[]): AnyRecord[] {
  return normalizedDepts.map((dept) => {
    const rawDept = rawDepts.find((d) => matchDepartment(d, dept));
    if (!rawDept) return dept;
    const rawProjects = ensureArray<AnyRecord>(rawDept.projects);
    return {
      ...dept,
      projects: ensureArray<AnyRecord>(dept.projects).map((proj) => {
        const rawProj = rawProjects.find((p) => matchProject(p, proj));
        if (!rawProj) return proj;
        const rawOkrsV2 = ensureArray(rawProj.okrsV2);
        if (rawOkrsV2.length === 0) return proj;
        if (ensureArray(proj.okrsV2).length > 0) return proj;
        return { ...proj, okrsV2: rawOkrsV2 };
      }),
    };
  });
}

/**
 * DBの strategy_data 行から、ブラウザ（store）と同じ正規化済みの財務・投資入力を作る。
 */
export function stage6SourceInputsFromRow(row: AnyRecord): Stage6SourceInputs {
  const csvRaw = (row.csv_finance_data ?? {}) as AnyRecord;
  const csv = unwrapCsvFinanceData(csvRaw);

  const rawDepartments: AnyRecord[] = ensureArray<AnyRecord>(row.departments).map((d) => ({
    ...d,
    name: d?.name ?? '',
    mission: d?.mission ?? '',
    missionDescription: d?.missionDescription ?? '',
    projects: ensureArray<AnyRecord>(d?.projects).map((p) => ({
      ...p,
      title: p?.title ?? '',
      okrs: ensureArray(p?.okrs),
    })),
  }));

  const normalized = normalizeStrategyData({
    id: row.id,
    departments: rawDepartments,
    financePL: row.finance_pl,
    csvFinanceData: csvRaw,
    financeBS: ensureArray(csv.financeBS),
  }) as AnyRecord;

  return {
    financePL: ensureArray<FinancePLRow>(normalized.financePL),
    financeBS: ensureArray<FinanceBSRow>(normalized.financeBS),
    departments: restoreOkrsV2(ensureArray<AnyRecord>(normalized.departments), rawDepartments) as Department[],
    fiscalYearEnd: normalizeFiscalYearEnd(row.fiscal_year_end) || undefined,
    companyTargets: ensureArray(row.company_targets),
    storedFinancePlan: csvRaw.financePlanAssumptions,
  };
}
