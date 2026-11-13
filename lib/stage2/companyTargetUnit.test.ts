import { COMPANY_TARGET_UNIT_PRESETS, editableUnitOf, isPresetUnit } from './companyTargetUnit';

describe('STAGE2の業績目標: 編集しても単位を置き換えない', () => {
  it('登録済みの単位（選択肢にある単位）は、そのまま編集フォームに入る', () => {
    for (const u of COMPANY_TARGET_UNIT_PRESETS) {
      expect(editableUnitOf(u)).toBe(u);
    }
  });

  it('選択肢にない単位（米ドルなど）は、百万円などへ置き換えず保持する', () => {
    expect(editableUnitOf('米ドル')).toBe('米ドル');
    expect(editableUnitOf('千件')).toBe('千件');
    expect(isPresetUnit('米ドル')).toBe(false);
  });

  it('単位が未設定のときは空のまま（別の金額単位にしない）', () => {
    expect(editableUnitOf(undefined)).toBe('');
    expect(editableUnitOf(null)).toBe('');
    expect(editableUnitOf(100)).toBe('');
  });

  it('万円と億円は選択肢にある', () => {
    expect(isPresetUnit('万円')).toBe(true);
    expect(isPresetUnit('億円')).toBe(true);
  });
});
