import { classifyKpi } from './kpiClass';

describe('classifyKpi（活動と成果の分類）', () => {
  it.each([
    ['記録件数', '件', 'ACTIVITY'],
    ['会議の開催回数', '回', 'ACTIVITY'],
    ['研修の受講数', '人', 'ACTIVITY'],
    ['改装提案を出した商業施設数', '件', 'ACTIVITY'],
    ['提案件数', undefined, 'ACTIVITY'],
    ['商談数', '件', 'ACTIVITY'],
  ])('活動の指標：%s', (label, unit, cls) => {
    expect(classifyKpi(label, unit).class).toBe(cls);
  });

  it.each([
    ['計測・記録に必要な作業時間の削減率', '%', 'OUTCOME'],
    ['試験導入先で計測・記録の負担軽減を確認できた医療機関数', '件', 'OUTCOME'],
    ['改装の判断件数（受注）', '件', 'OUTCOME'],
    ['記録の誤記率', '%', 'OUTCOME'],
    ['粗利率', '%', 'OUTCOME'],
    ['導入後90日の定着率', '%', 'OUTCOME'],
  ])('成果の指標：%s', (label, unit, cls) => {
    expect(classifyKpi(label, unit).class).toBe(cls);
  });

  it('「記録」が含まれるだけでは活動と判定しない（削減率は成果）', () => {
    expect(classifyKpi('記録に必要な時間の削減率', '%').class).toBe('OUTCOME');
  });

  it('活動の語があっても件数で数えていなければ、活動とは判定しない', () => {
    expect(classifyKpi('記録の仕組みの整備状況', undefined).class).toBe('UNCERTAIN');
  });

  it('活動でも成果でもない表記は、判定できないとして示す（確認に回す）', () => {
    const r = classifyKpi('試験導入に合意した医療機関数', '件');
    expect(r.class).toBe('UNCERTAIN');
    expect(r.reason).toContain('判定できない');
  });

  it('判定の理由を必ず返す（なぜそう判定したかを示せる）', () => {
    expect(classifyKpi('記録件数', '件').reason).toContain('記録');
    expect(classifyKpi('削減率', '%').reason).toContain('削減');
  });
});
