import { INDIRECT_DEPARTMENT_GUIDANCE, departmentScopeFields, isIndirectDepartment } from './departmentScope';

describe('間接部門の判定（事業セグメントに対応しない部門）', () => {
  it('セグメントに対応しなかった部門は間接部門。対応した部門・対応結果が無い部門は事業部門', () => {
    expect(isIndirectDepartment({ segmentMatched: false })).toBe(true);
    expect(isIndirectDepartment({ segmentMatched: true })).toBe(false);
    expect(isIndirectDepartment(undefined)).toBe(false);
    expect(isIndirectDepartment({})).toBe(false);
  });

  it('間接部門の入力には区分と指示を付け、事業部門の入力には指示を付けない', () => {
    expect(departmentScopeFields(true)).toEqual({ departmentScope: 'indirect', departmentGuidance: INDIRECT_DEPARTMENT_GUIDANCE });
    expect(departmentScopeFields(false)).toEqual({ departmentScope: 'business' });
  });

  it('間接部門の指示は、支援・協働の成果を示し、既定の指標や創作を求めない', () => {
    expect(INDIRECT_DEPARTMENT_GUIDANCE).toContain('支援');
    expect(INDIRECT_DEPARTMENT_GUIDANCE).toContain('internal_process');
    expect(INDIRECT_DEPARTMENT_GUIDANCE).toContain('ARPUを既定にしない');
    expect(INDIRECT_DEPARTMENT_GUIDANCE).toContain('顧客や市場の数値を創作しない');
    expect(INDIRECT_DEPARTMENT_GUIDANCE).toContain('研修件数や制度整備を最終目的にしない');
  });
});
