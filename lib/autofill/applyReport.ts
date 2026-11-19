/* 反映・保存が終わった後の結果（反映した項目・変えなかった項目・未取得の項目）を、利用者向けの文章にする。 */
import { FINANCE_KEYS, PROFILE_LABEL, type FilingApplyPlan, type FilingCandidate, type FinanceKey } from './filingCandidates';

export type ApplyReport = { applied: string[]; kept: string[]; unfetched: string[] };

export const FINANCE_SHORT_LABEL: Record<FinanceKey, string> = {
  revenue: '売上高',
  operatingIncome: '営業利益',
  netIncome: '純利益',
  totalAssets: '総資産',
  netAssets: '純資産',
};

const FILL_TARGETS: Array<{ label: string; missing: (c: FilingCandidate) => boolean }> = [
  { label: '業種（EDINETの業種を対応表で区分できず）', missing: (c) => !c.profileExtra.industry },
  { label: '所在地', missing: (c) => !c.profileExtra.location },
  { label: '従業員数', missing: (c) => !c.profileExtra.employees },
  { label: '事業内容', missing: (c) => !c.profileExtra.businessContent },
];

export function buildApplyReport(args: { plan: FilingApplyPlan; candidate: FilingCandidate; missingPeriods: string[] }): ApplyReport {
  const { plan, candidate } = args;
  const applied: string[] = [];
  const kept: string[] = [];
  const unfetched: string[] = [];

  if (plan.profileApplied.length > 0) applied.push(`企業情報：${plan.profileApplied.map((k) => PROFILE_LABEL[k]).join('、')}`);
  if (plan.financeApplied.length > 0) {
    const years = plan.financeApplied.map((a) => a.year).sort((a, b) => a - b);
    applied.push(`財務：${years.join('・')}年度`);
  }
  if (plan.segmentsPatch) applied.push(`事業セグメント：${plan.segmentsPatch.length}件`);

  const keptProfile = plan.profileSkipped.filter((s) => s.reason === 'already_filled').map((s) => PROFILE_LABEL[s.key]);
  if (keptProfile.length > 0) kept.push(`登録済みのため変えていない企業情報：${keptProfile.join('、')}`);
  const keptYears = [...new Set(plan.financeSkipped.filter((s) => s.reason === 'already_filled').map((s) => s.year))].sort((a, b) => a - b);
  if (keptYears.length > 0) kept.push(`登録済みと違う財務（上書きせず残した）：${keptYears.join('・')}年度`);

  for (const t of FILL_TARGETS) if (t.missing(candidate)) unfetched.push(t.label);
  if (!candidate.segments) unfetched.push('事業セグメント');
  const fy = candidate.fiscalYear;
  if (fy !== null) {
    const have = new Set(candidate.finance.map((y) => y.year));
    const missingYears: number[] = [];
    for (let y = fy - 4; y <= fy; y++) if (!have.has(y)) missingYears.push(y);
    if (missingYears.length > 0) unfetched.push(`財務（${missingYears.join('・')}年度の書類なし）`);
    for (const k of FINANCE_KEYS) {
      const years = candidate.finance.filter((y) => y[k] === undefined).map((y) => y.year);
      if (years.length > 0 && years.length < candidate.finance.length) unfetched.push(`${FINANCE_SHORT_LABEL[k]}（${years.join('・')}年度）`);
    }
  }
  for (const p of args.missingPeriods) unfetched.push(`${p}の有価証券報告書`);

  return { applied, kept, unfetched };
}

export function formatApplyReportText(args: { companyName: string; report: ApplyReport }): string {
  const { report } = args;
  const lines = [
    `「${args.companyName}」の情報を反映し、保存しました。`,
    report.applied.length > 0 ? `反映：${report.applied.join('／')}` : '反映：変更した項目はありません（すべて登録済みと同じ）',
    ...report.kept,
    report.unfetched.length > 0 ? `未取得（推測で補っていません）：${report.unfetched.join('、')}` : '',
    '次の作業：STAGE1の財務の数値と事業セグメントの名称を確認してください。内容に問題がなければ、STAGE2（戦略の問い）へ進めます。',
  ];
  return lines.filter(Boolean).join('\n');
}
