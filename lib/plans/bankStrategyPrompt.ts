import type { ConfirmedStage2, PlanData, ProjectImpactRow } from '@/utils/export/buildPlanData';
import type { BankFinancialPlanBlock } from '@/utils/stage6/bankFinancialPlan';
import { formatMillionYenText } from './bankFinancialFormat';
import { selectMainProjects } from './projectSelection';

export const STAGE2_STORY_CHAR_LIMIT = 4000;
export const STAGE3_DEPARTMENT_DISPLAY_LIMIT = 10;
export const STAGE4_PROJECT_DISPLAY_LIMIT = 20;

const NOT_ENTERED = '未入力';
const STORY_SOURCE_LABEL: Record<ConfirmedStage2['storySource'], string> = {
  FINAL: '確定版',
  EDITED: '確定版なし（編集版を参照。確定とは扱わない）',
  DRAFT: '確定版なし（ドラフトを参照。確定とは扱わない）',
  LEGACY: '確定版なし（旧形式の最終ストーリーを参照。確定とは扱わない）',
  NONE: '未作成',
};

function orNotEntered(value: string | undefined): string {
  return value && value.trim() !== '' ? value : NOT_ENTERED;
}

function listOrNotEntered(values: string[] | undefined): string {
  return values && values.length > 0 ? values.map((v) => `- ${v}`).join('\n') : NOT_ENTERED;
}

function storyText(chapters: ConfirmedStage2['chapters']): string {
  if (chapters.length === 0) return NOT_ENTERED;
  const full = chapters.map((ch, i) => `第${i + 1}章 ${ch.title}\n${ch.body}`).join('\n\n');
  if (full.length <= STAGE2_STORY_CHAR_LIMIT) return full;
  return `${full.slice(0, STAGE2_STORY_CHAR_LIMIT)}\n（ここから先は省略しています）`;
}

const FIELD_NOT_ENTERED_WITH_STORY = '個別項目は未入力（確定ストーリー本文を参照）';
const FIELD_NOT_ENTERED_WITHOUT_STORY = '未入力（確定版の戦略ストーリーも未作成）';

export function bankStage2Block(stage2: PlanData['stage2']): string {
  const c = stage2.confirmed;
  if (!c) return '';
  const hasStory = c.storySource !== 'NONE';
  const field = (value: string | undefined) =>
    value && value.trim() !== '' ? value : hasStory ? FIELD_NOT_ENTERED_WITH_STORY : FIELD_NOT_ENTERED_WITHOUT_STORY;
  const list = (values: string[] | undefined) =>
    values && values.length > 0
      ? values.map((v) => `- ${v}`).join('\n')
      : hasStory
        ? FIELD_NOT_ENTERED_WITH_STORY
        : FIELD_NOT_ENTERED_WITHOUT_STORY;
  const guidance = hasStory
    ? '※個別項目が未入力のときは、確定ストーリー本文に該当する内容があればその本文に基づいて記載し、本文にも無い内容は記載しないこと。確定版でない場合は、確定した戦略として書かないこと。'
    : '※戦略ストーリーが未作成のため、戦略の内容は確認できません。戦略の内容を創作せず、確認が必要な事項として記載すること。';
  return `【全社戦略（入力された内容のみ）】
戦略ストーリーの版：${STORY_SOURCE_LABEL[c.storySource]}
全社戦略の結論：${field(c.conclusion)}
顧客が当社を選ぶ理由・提供価値：${field(c.customerValue)}
既存事業からの転換の方向：${field(c.primaryShift)}
成長戦略：${field(c.growthStrategy)}
利益戦略：${field(c.profitStrategy)}
経営会議で確認すべき論点：
${list(c.managementIssues)}
全社共通の判断基準：
${list(c.decisionCriteria)}
最終ストーリー：
${storyText(c.chapters)}
${guidance}

`;
}

function compareRevenueDesc(a: ProjectImpactRow, b: ProjectImpactRow): number {
  const av = a.confirmedRevenueYen ?? Number.NEGATIVE_INFINITY;
  const bv = b.confirmedRevenueYen ?? Number.NEGATIVE_INFINITY;
  if (av === bv) return 0;
  return bv > av ? 1 : -1;
}

function coverageNote(total: number, shown: number): string {
  if (total === 0) return '未入力';
  return total > shown ? `全${total}件のうち${shown}件を掲載` : `全${total}件を掲載`;
}

export function bankStage34Block(planData: PlanData & { bankFinancialPlan?: BankFinancialPlanBlock }): string {
  const departments = planData.stage3.departments;
  const totalDepartments = planData.stage3.totalDepartmentCount ?? departments.length;
  const shownDepartments = departments.slice(0, STAGE3_DEPARTMENT_DISPLAY_LIMIT);
  const departmentLines =
    shownDepartments.length === 0
      ? NOT_ENTERED
      : shownDepartments
          .map(
            (d) =>
              `- ${d.name}：役割 ${orNotEntered(d.strategicRole)} ／ 主な課題 ${d.keyIssues?.join('、') || NOT_ENTERED} ／ 施策 ${d.projectCount ?? 0}件`,
          )
          .join('\n');

  const bankProjects = planData.bankFinancialPlan?.sections?.investmentPlan.projects;
  if (bankProjects && bankProjects.rows.length > 0) {
    const main = selectMainProjects(bankProjects.rows);
    const mainLines = main
      .map(
        (p) =>
          `- ${p.title}（${p.departmentName}）：財務効果（売上） ${formatMillionYenText(p.revenueYen)} ／ 財務効果（営業利益） ${formatMillionYenText(p.operatingIncomeYen)} ／ 承認状態 ${p.planStatus === 'approved' ? '承認済み' : '承認未確認'}`,
      )
      .join('\n');
    return `【部門別戦略】（部門：${coverageNote(totalDepartments, shownDepartments.length)}）
${departmentLines}

【主要な実行施策・期待効果】（施策：${coverageNote(bankProjects.totalCount, main.length)}。主要施策は売上寄与と投資額の大きい施策から選定）
${mainLines}
※本文では主要な施策のみ取り上げ、全件を列挙しないこと。掲載外の施策があることを前提に、全件が反映されたように書かないこと。全件は参考資料に掲載される。`;
  }

  const allProjects = [...(planData.stage4.allProjectImpacts ?? planData.stage4.projectImpacts ?? [])];
  const totalProjects = planData.stage4.totalProjectCount ?? allProjects.length;
  const projectsSorted = allProjects.sort(compareRevenueDesc);
  const shownProjects = projectsSorted.slice(0, STAGE4_PROJECT_DISPLAY_LIMIT);
  const projectLines =
    shownProjects.length === 0
      ? NOT_ENTERED
      : shownProjects
          .map(
            (p) =>
              `- ${p.title || '（名称未入力）'}：財務効果（売上） ${p.impactRevenue ?? '未定'} ／ 財務効果（営業利益） ${p.impactOpIncome ?? '未定'} ／ 投資額 ${p.impactInvestment ?? '未定'}`,
          )
          .join('\n');

  return `【部門別戦略】（部門：${coverageNote(totalDepartments, shownDepartments.length)}）
${departmentLines}

【実行施策・期待効果】（施策：${coverageNote(totalProjects, shownProjects.length)}。財務効果（売上）の大きい順）
${projectLines}
※掲載範囲外の部門・施策があります。計画書で全件が反映されたように書かず、掲載件数と全件数を明記すること。`;
}
