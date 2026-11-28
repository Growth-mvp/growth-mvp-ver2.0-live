import { revealOf } from './revealTargets';

describe('入力された対象の表示先（タブ・折りたたみ欄・事業）', () => {
  it.each([
    ['stage1.profile.companyName', { tab: 'input', section: 'company' }],
    ['stage1.profile.employees', { tab: 'input', section: 'company' }],
    ['stage1.segment.2', { tab: 'input', section: 'company' }],
    ['stage1.finance.pl.operatingIncome.2025', { tab: 'input', section: 'finance' }],
    ['stage1.finance.bs.ar.2024', { tab: 'input', section: 'finance' }],
    ['stage1.assumption.wacc', { tab: 'input', section: 'wacc' }],
    ['stage1.issue.0', { tab: 'analysis', section: 'issues' }],
    ['stage1.handover', { tab: 'analysis', section: 'issues' }],
    ['stage1.valuation', { tab: 'analysis', section: 'metrics' }],
  ])('%s は対応する欄に出す', (target, expected) => {
    expect(revealOf(target)).toEqual(expected);
  });

  it('事業別の財務は、事業の id を付けて、全社の財務とは別の名前にする', () => {
    expect(revealOf('stage1.finance.segment.seg_123_abc.pl.revenue.2025')).toEqual({
      tab: 'input',
      section: 'finance',
      segmentId: 'seg_123_abc',
    });
    expect(revealOf('stage1.finance.pl.revenue.2025')).toEqual({ tab: 'input', section: 'finance' });
  });

  it('対応のない対象は、表示先を変えない', () => {
    expect(revealOf('unknown.target')).toBeNull();
  });
});
