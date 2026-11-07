import type { PlanData } from '@/utils/export/buildPlanData';
import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { formatMillionYenText } from './bankFinancialFormat';
import { toBusinessWording } from './businessWording';

const MAX_UNCONFIRMED_ITEMS = 4;

const hasText = (value: string | undefined | null): value is string => typeof value === 'string' && value.trim() !== '';

function unconfirmedItems(block: BankFinancialPlanBlock | undefined): string[] {
  if (!block) return ['財務計画の計算結果は作成されていないため、財務の確認事項は第4章で確認してください。'];
  const items: string[] = [];
  if (block.status !== 'CURRENT' || !block.numbersConfirmed) items.push(...block.statusReasons);
  items.push(...(block.sections?.basisAndConstraints.holds ?? []));
  const unapproved = block.sections?.investmentPlan.unapprovedReadyYen ?? 0;
  if (unapproved > 0) {
    items.push(`承認が確認できていない投資・費用（${formatMillionYenText(unapproved)}）を含めて計画しています`);
  }
  return [...new Set(items.filter((i) => i && i.trim() !== '').map(toBusinessWording))].slice(0, MAX_UNCONFIRMED_ITEMS);
}

/**
 * 銀行向け計画書の冒頭に置く要約。
 * 構造化された登録値だけを使い、値のない項目は省略する。確定ストーリー本文からの引用はしない。
 */
export function buildBankPlanSummary(planData: PlanData, block: BankFinancialPlanBlock | undefined): string {
  const confirmed = planData.stage2.confirmed;
  const lines: string[] = ['## 経営計画の要約', ''];

  const strategyItems: string[] = [];
  if (hasText(confirmed?.conclusion)) strategyItems.push(`- 全社戦略の結論：${confirmed.conclusion}`);
  if (hasText(planData.companyVision)) strategyItems.push(`- 目指す姿：${planData.companyVision}`);
  if (hasText(confirmed?.customerValue)) strategyItems.push(`- 顧客が当社を選ぶ理由：${confirmed.customerValue}`);
  if (hasText(confirmed?.growthStrategy)) strategyItems.push(`- 成長戦略：${confirmed.growthStrategy}`);
  if (hasText(confirmed?.profitStrategy)) strategyItems.push(`- 利益戦略：${confirmed.profitStrategy}`);
  if (strategyItems.length > 0) {
    lines.push('**全社戦略**');
    lines.push(...strategyItems, '');
  }

  const roles = planData.stage3.departments.filter((d) => hasText(d.strategicRole)).slice(0, 5);
  if (roles.length > 0) {
    lines.push('**事業・部門別の重点戦略**');
    for (const d of roles) lines.push(`- ${d.name}：${d.strategicRole}`);
    lines.push('');
  }

  const sections = block?.sections;
  const registered = sections?.financialTargets.stage2Registered;
  const years = sections?.basisAndConstraints.forecastWindow ?? [];
  const targetItems: string[] = [];
  if (years.length > 0) {
    targetItems.push(`- 計画期間：${years[0]}年〜${years[years.length - 1]}年`);
  }
  const registeredTargets = [
    registered?.revenue
      ? `売上高 ${formatMillionYenText(registered.revenue.valueYen)}${registered.revenue.dueYear ? `（${registered.revenue.dueYear}年度）` : ''}`
      : null,
    registered?.operatingIncome
      ? `営業利益 ${formatMillionYenText(registered.operatingIncome.valueYen)}${registered.operatingIncome.dueYear ? `（${registered.operatingIncome.dueYear}年度）` : ''}`
      : null,
  ].filter((t): t is string => t !== null);
  if (registeredTargets.length > 0) {
    targetItems.push(`- 登録目標：${registeredTargets.join('、')}（承認状態は未確認）`);
  } else if ((planData.stage2.companyTargets ?? []).length > 0) {
    targetItems.push(
      `- 登録目標：${(planData.stage2.companyTargets ?? []).map((t) => `${t.label} ${t.value}`).join('、')}（承認状態は未確認）`,
    );
  }
  if (sections) {
    targetItems.push('- 財務計画の売上・営業利益は登録目標に向けた計画経路であり、独立した業績予測ではありません。');
  }
  if (targetItems.length > 0) {
    lines.push('**主要な売上・営業利益目標**');
    lines.push(...targetItems, '');
  }

  const unconfirmed = unconfirmedItems(block);
  if (unconfirmed.length > 0) {
    lines.push('**重要な未確定事項**');
    for (const item of unconfirmed) lines.push(`- ${item}`);
    lines.push('');
  }

  return lines.join('\n');
}
