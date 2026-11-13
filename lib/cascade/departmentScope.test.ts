import { INDIRECT_DEPARTMENT_GUIDANCE, customerOutcomeTemplate, departmentScopeFields, isIndirectDepartment, leverForTemplate } from './departmentScope';

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

describe('応答テンプレートの指定（間接部門）', () => {
  it('間接部門の mainLever は説明文を入れず、事業部門の既定値は変えない', () => {
    expect(leverForTemplate(true, 2)).toBeNull();
    expect(leverForTemplate(true, 3)).toBeNull();
    expect(leverForTemplate(false, 2)).toBe('ARPU');
    expect(leverForTemplate(false, 3)).toBe('FUTURE');
  });

  it('間接部門の顧客成果は支援先部門の成果で指定し、事業部門の指定は従来どおり', () => {
    expect(customerOutcomeTemplate(true).measurementScope).toBe('internal_process');
    expect(customerOutcomeTemplate(true).population).not.toContain('顧客');
    expect(customerOutcomeTemplate(false)).toEqual({ measurementScope: 'client_business', population: '対象施設・利用者の範囲' });
  });
});
