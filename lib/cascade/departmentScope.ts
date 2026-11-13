/** 事業セグメントに対応しない部門（人事部など）へ渡す指示。顧客・市場の根拠を創作させず、支援・協働の成果で設計させる。 */
export const INDIRECT_DEPARTMENT_GUIDANCE =
  '間接部門（事業セグメントに対応しない部門）。直接の顧客・市場の根拠がなくても、全社戦略と部門の役割・6問回答から施策を設計する。成果は、全社戦略の実現に必要な人材・能力、事業部門（営業・開発・生産など）への支援、事業・部門間の協働と役割分担、それらの企業価値・業績への貢献として示す。研修件数や制度整備を最終目的にしない。顧客成果の指標は支援先部門の成果（measurementScope は internal_process）で書き、顧客や市場の数値を創作しない。mainLever は施策が効かせる指標に合わせて6コードから1つ選び、ARPUを既定にしない。';

/** FACTPACK の対応結果から、間接部門かを判定する。対応結果が無い場合は事業部門として扱う。 */
export function isIndirectDepartment(facts: { segmentMatched?: boolean } | null | undefined): boolean {
  return facts?.segmentMatched === false;
}

/** 生成入力へ加える部門の区分と、間接部門の指示 */
export function departmentScopeFields(indirect: boolean): { departmentScope: 'indirect' | 'business'; departmentGuidance?: string } {
  return indirect
    ? { departmentScope: 'indirect', departmentGuidance: INDIRECT_DEPARTMENT_GUIDANCE }
    : { departmentScope: 'business' };
}
