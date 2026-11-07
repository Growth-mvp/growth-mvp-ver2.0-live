import type { Department } from '@/types/strategy';
import { buildInvestmentItems } from '@/utils/stage6/investmentDemand';
import { formatMillionYenText } from './bankFinancialFormat';

type TitleTotal = { sum: number; count: number; approved: boolean };

function totalsByTitle(departments: Department[] | null | undefined) {
  const items = buildInvestmentItems(departments);
  const byTitle = new Map<string, TitleTotal>();
  const titleCount = new Map<string, number>();
  for (const dept of departments ?? []) {
    for (const project of dept?.projects ?? []) {
      const title = project?.title ?? '（未名）';
      titleCount.set(title, (titleCount.get(title) ?? 0) + 1);
    }
  }
  for (const item of items) {
    if (item.duplicateStatus === 'CANDIDATE' || item.totalYen === null) continue;
    const current = byTitle.get(item.projectTitle) ?? { sum: 0, count: 0, approved: true };
    byTitle.set(item.projectTitle, {
      sum: current.sum + item.totalYen,
      count: current.count + 1,
      approved: current.approved && item.planStatus === 'approved',
    });
  }
  return { byTitle, titleCount };
}

/**
 * 施策ごとの投資額の表示。銀行向けの投資明細と同じ支出の登録から合計する。
 * 支出の登録がない施策は含めない（呼び出し側で「未定」とする）。
 * 同名の施策が複数ある場合は、どの施策か特定できないため含めない。
 */
export function projectInvestmentLabels(departments: Department[] | null | undefined): Map<string, string> {
  const { byTitle, titleCount } = totalsByTitle(departments);
  const labels = new Map<string, string>();
  for (const [title, entry] of byTitle) {
    if (entry.count === 0 || titleCount.get(title) !== 1) continue;
    labels.set(title, `${formatMillionYenText(entry.sum)}（${entry.approved ? '承認済み' : '承認未確認'}）`);
  }
  return labels;
}

export type InvestmentInputMismatch = {
  departmentName: string;
  title: string;
  spendYen: number;
  inputYen: number;
};

/**
 * 支出の登録の合計と、施策の入力欄（impactInvestmentMJPY）の両方があり、値が異なる施策。
 * 統合せず、どちらの値も変更しないために報告だけに使う。
 */
export function investmentInputMismatches(departments: Department[] | null | undefined): InvestmentInputMismatch[] {
  const { byTitle, titleCount } = totalsByTitle(departments);
  const mismatches: InvestmentInputMismatch[] = [];
  for (const dept of departments ?? []) {
    for (const project of dept?.projects ?? []) {
      const title = project?.title ?? '（未名）';
      const input = (project as { impactInvestmentMJPY?: unknown }).impactInvestmentMJPY;
      const entry = byTitle.get(title);
      if (typeof input !== 'number' || !Number.isFinite(input) || !entry || entry.count === 0) continue;
      if (titleCount.get(title) !== 1) continue;
      const inputYen = input * 1_000_000;
      if (Math.abs(inputYen - entry.sum) > 1) {
        mismatches.push({ departmentName: dept?.name ?? '（未名）', title, spendYen: entry.sum, inputYen });
      }
    }
  }
  return mismatches;
}
