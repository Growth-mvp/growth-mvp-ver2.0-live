import type { ConfirmedStage2, PlanData, ProjectImpactRow } from '@/utils/export/buildPlanData';

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

export function bankStage2Block(stage2: PlanData['stage2']): string {
  const c = stage2.confirmed;
  if (!c) return '';
  return `【STAGE2: 全社戦略（入力された内容のみ）】
戦略ストーリーの版：${STORY_SOURCE_LABEL[c.storySource]}
全社戦略の結論：${orNotEntered(c.conclusion)}
顧客が当社を選ぶ理由・提供価値：${orNotEntered(c.customerValue)}
既存事業からの転換の方向：${orNotEntered(c.primaryShift)}
成長戦略：${orNotEntered(c.growthStrategy)}
利益戦略：${orNotEntered(c.profitStrategy)}
経営会議で確認すべき論点：
${listOrNotEntered(c.managementIssues)}
全社共通の判断基準：
${listOrNotEntered(c.decisionCriteria)}
最終ストーリー：
${storyText(c.chapters)}
※「未入力」の項目は未入力として記載し、内容を補わないこと。確定版でない場合は、確定した戦略として書かないこと。

`;
}

function revenueSortValue(text: string | undefined): number {
  if (!text) return Number.NEGATIVE_INFINITY;
  const n = parseFloat(text.replace(/[¥M,]/g, ''));
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function compareRevenueDesc(a: ProjectImpactRow, b: ProjectImpactRow): number {
  const av = revenueSortValue(a.impactRevenue);
  const bv = revenueSortValue(b.impactRevenue);
  if (av === bv) return 0;
  return bv > av ? 1 : -1;
}

function coverageNote(total: number, shown: number): string {
  if (total === 0) return '未入力';
  return total > shown ? `全${total}件のうち${shown}件を掲載` : `全${total}件を掲載`;
}

export function bankStage34Block(planData: PlanData): string {
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
              `- ${p.title || '（名称未入力）'}：売上寄与 ${p.impactRevenue ?? '未定'} ／ 営業利益寄与 ${p.impactOpIncome ?? '未定'} ／ 投資額 ${p.impactInvestment ?? '未定'}`,
          )
          .join('\n');

  return `【STAGE3: 部門別戦略】（部門：${coverageNote(totalDepartments, shownDepartments.length)}）
${departmentLines}

【STAGE4: 実行計画・期待効果】（施策：${coverageNote(totalProjects, shownProjects.length)}。売上寄与の大きい順）
${projectLines}
※掲載範囲外の部門・施策があります。計画書で全件が反映されたように書かず、掲載件数と全件数を明記すること。`;
}
