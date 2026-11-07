import type { PlanData } from '@/utils/export/buildPlanData';
import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';

const NOT_ENTERED = '未入力';

const orNotEntered = (value: string | undefined | null) => (value && value.trim() !== '' ? value : NOT_ENTERED);

/** 銀行向け計画書の冒頭に置く要約。入力された内容だけを使い、補完しない */
export function buildBankPlanSummary(planData: PlanData, block: BankFinancialPlanBlock | undefined): string {
  const confirmed = planData.stage2.confirmed;
  const issues = (planData.stage1.keyIssues ?? []).filter((i) => i && i.trim() !== '').slice(0, 3);
  const roles = planData.stage3.departments
    .filter((d) => d.strategicRole && d.strategicRole.trim() !== '')
    .slice(0, 5)
    .map((d) => `${d.name}（${d.strategicRole}）`);
  const years = block?.sections?.basisAndConstraints.forecastWindow ?? [];
  const period =
    years.length > 0 ? `${years[0]}年〜${years[years.length - 1]}年` : '未確定（財務計画の期間を確認できないため）';
  const targets = (planData.stage2.companyTargets ?? [])
    .slice(0, 3)
    .map((t) => `${t.label}：${t.value}（登録値・承認未確認）`);

  return [
    '## 経営計画の要約',
    '',
    `- 目指す企業像：${orNotEntered(planData.companyVision)}`,
    `- 最も重要な経営課題：${issues.length > 0 ? `登録された経営課題のうち先頭${issues.length}件は、${issues.join('、')}` : NOT_ENTERED}`,
    `- 選択した成長・利益戦略：成長戦略は${orNotEntered(confirmed?.growthStrategy)}。利益戦略は${orNotEntered(confirmed?.profitStrategy)}`,
    `- 事業・部門が担う主要な役割：${roles.length > 0 ? roles.join('、') : NOT_ENTERED}`,
    `- 計画期間と主要な業績目標：計画期間は${period}。${targets.length > 0 ? targets.join('、') : '業績目標は未登録'}`,
    '',
  ].join('\n');
}
