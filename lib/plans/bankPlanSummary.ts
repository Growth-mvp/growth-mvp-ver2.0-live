import type { ConfirmedStage2, PlanData } from '@/utils/export/buildPlanData';
import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { formatMillionYenText } from './bankFinancialFormat';
import { toBusinessWording } from './businessWording';

const NOT_ENTERED = '未入力';
const MAX_EXCERPTS = 1;
const MAX_UNCONFIRMED_ITEMS = 4;

const orNotEntered = (value: string | undefined | null) => (value && value.trim() !== '' ? value : NOT_ENTERED);

/** 確定ストーリーの本文から、指定の語を含む文を原文のまま抜き出す（言い換え・補完はしない） */
function storyExcerpt(chapters: ConfirmedStage2['chapters'], keywords: string[]): string | undefined {
  const sentences = chapters
    .flatMap((ch) => (ch.body ?? '').split(/(?<=。)/))
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return sentences.filter((s) => keywords.some((k) => s.includes(k))).slice(0, MAX_EXCERPTS)[0];
}

function strategyLine(
  label: string,
  field: string | undefined,
  confirmed: ConfirmedStage2 | undefined,
  keywords: string[],
): string {
  if (field && field.trim() !== '') return `${label}：${field}`;
  const hasStory = confirmed !== undefined && confirmed.storySource !== 'NONE';
  if (!hasStory) return `${label}：${NOT_ENTERED}（確定版の戦略ストーリーも未作成）`;
  const excerpt = storyExcerpt(confirmed.chapters, keywords);
  return excerpt
    ? `${label}：確定版の戦略ストーリーには次のように記載されています。「${excerpt}」`
    : `${label}は、確定版の戦略ストーリー本文を参照してください（個別項目は未入力）。`;
}

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

/** 銀行向け計画書の冒頭に置く要約。確定済みの内容を優先し、入力のない内容は補完しない */
export function buildBankPlanSummary(planData: PlanData, block: BankFinancialPlanBlock | undefined): string {
  const confirmed = planData.stage2.confirmed;
  const lines: string[] = ['## 経営計画の要約', ''];

  lines.push('**全社戦略の結論**');
  if (planData.companyVision && planData.companyVision.trim() !== '') {
    lines.push(`- 目指す姿：${planData.companyVision}`);
  }
  if (confirmed?.conclusion) {
    lines.push(`- 結論：${confirmed.conclusion}`);
  } else if (confirmed && confirmed.storySource !== 'NONE') {
    lines.push('- 結論：確定版の戦略ストーリーの結論部分を参照してください（結論の個別項目は未入力）。');
  } else {
    lines.push(`- 結論：${NOT_ENTERED}（確定版の戦略ストーリーも未作成）`);
  }
  lines.push(`- ${strategyLine('顧客が当社を選ぶ理由', confirmed?.customerValue, confirmed, ['選ばれ', '選ぶ', '提供価値', '顧客価値'])}`);
  lines.push(`- ${strategyLine('成長戦略', confirmed?.growthStrategy, confirmed, ['成長', '拡大', '新規'])}`);
  lines.push(`- ${strategyLine('利益戦略', confirmed?.profitStrategy, confirmed, ['利益', '収益', 'コスト'])}`);
  lines.push('');

  const roles = planData.stage3.departments
    .filter((d) => d.strategicRole && d.strategicRole.trim() !== '')
    .slice(0, 5);
  lines.push('**事業・部門別の重点戦略**');
  if (roles.length > 0) {
    for (const d of roles) lines.push(`- ${d.name}：${d.strategicRole}`);
  } else {
    lines.push(`- ${NOT_ENTERED}`);
  }
  lines.push('');

  const sections = block?.sections;
  const registered = sections?.financialTargets.stage2Registered;
  const years = sections?.basisAndConstraints.forecastWindow ?? [];
  lines.push('**主要な売上・営業利益目標**');
  if (years.length > 0) {
    lines.push(`- 計画期間：${years[0]}年〜${years[years.length - 1]}年`);
  } else {
    lines.push('- 計画期間：未確定（財務計画の期間を確認できないため）');
  }
  const registeredTargets = [
    registered?.revenue ? `売上高 ${formatMillionYenText(registered.revenue.valueYen)}${registered.revenue.dueYear ? `（${registered.revenue.dueYear}年度）` : ''}` : null,
    registered?.operatingIncome
      ? `営業利益 ${formatMillionYenText(registered.operatingIncome.valueYen)}${registered.operatingIncome.dueYear ? `（${registered.operatingIncome.dueYear}年度）` : ''}`
      : null,
  ].filter((t): t is string => t !== null);
  if (registeredTargets.length > 0) {
    lines.push(`- 登録目標：${registeredTargets.join('、')}（承認状態は未確認）`);
  } else if ((planData.stage2.companyTargets ?? []).length > 0) {
    lines.push(
      `- 登録目標：${(planData.stage2.companyTargets ?? []).map((t) => `${t.label} ${t.value}`).join('、')}（承認状態は未確認）`,
    );
  } else {
    lines.push(`- 登録目標：${NOT_ENTERED}`);
  }
  if (sections) {
    lines.push('- 財務計画の売上・営業利益は登録目標に向けた計画経路であり、独立した業績予測ではありません。');
  }
  lines.push('');

  lines.push('**重要な未確定事項**');
  for (const item of unconfirmedItems(block)) lines.push(`- ${item}`);
  lines.push('');

  return lines.join('\n');
}
