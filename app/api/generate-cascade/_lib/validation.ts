/**
 * _lib/validation.ts
 * KR validation logic
 */

import { ProjectType, ValidationResult } from './types';

/**
 * ★ TASK 3: KRI validation（汎用3点セット排除 + 種別適合性）
 */
export function validateKRs(
  projectType: ProjectType,
  krs: Array<{ label: string; unit?: string | null }>,
  projectTitle: string
): ValidationResult {
  const reasons: string[] = [];

  // チェック1: projectTitle prefix が入っているか
  const hasPrefix = krs.every((kr) =>
    (kr.label ?? '').includes(projectTitle)
  );
  if (!hasPrefix) {
    reasons.push('missing_project_prefix');
  }

  // チェック2: KPI名が被ってないか
  const kpiNames = krs.map((kr) => {
    // label から projectTitle を削除して KPI名を抽出
    let name = (kr.label ?? '').replace(projectTitle, '').replace(/^：/, '').trim();
    return name;
  });
  const uniqueCount = new Set(kpiNames).size;
  if (uniqueCount < 3) {
    reasons.push('duplicate_kpi_names');
  }

  // チェック3: 種別別の禁止セット
  const allLabelsLower = krs.map((kr) => (kr.label ?? '').toLowerCase()).join(' ');

  if (projectType === 'customer_research') {
    if (allLabelsLower.match(/不良率|合格率|稼働率/)) {
      reasons.push('invalid_for_customer_research');
    }
  } else if (projectType === 'inventory_system') {
    if (allLabelsLower.match(/試験合格率|不良率/)) {
      reasons.push('invalid_for_inventory_system');
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
