import { runDocumentChecks } from './documentChecks';
import type { CompanyTarget, StoryChapter } from '@/types/strategy';

const targets = (revenueBase: number, revenueUnit: string) =>
  [{ id: 'rev', label: '売上', unit: revenueUnit, base: revenueBase, dueYear: 2030 } as CompanyTarget];

const mismatchCount = (text: string, revenueBase: number, revenueUnit: string) => {
  const chapters: StoryChapter[] = [{ title: '本文', body: text } as StoryChapter];
  const issues = runDocumentChecks({ chapters, conclusion: '', companyTargets: targets(revenueBase, revenueUnit) });
  const issue = issues.find((i) => i.kind === 'target_mismatch');
  return issue && issue.kind === 'target_mismatch' ? issue.mentions.length : 0;
};

describe('金額の一致判定は、書かれた桁数の丸めを許し、本当の不一致は検出する', () => {
  it('1.8億円は175百万円（1.75億円）の丸めとして一致する', () => {
    expect(mismatchCount('2030年度の売上1.8億円（175百万円）を目指す。', 175, '百万円')).toBe(0);
  });

  it('同じ目標を百万円で書けば一致する', () => {
    expect(mismatchCount('2030年度の売上175百万円を目指す。', 175, '百万円')).toBe(0);
  });

  it('1.6億円は175百万円と一致しないため検出する', () => {
    expect(mismatchCount('2030年度の売上1.6億円を目指す。', 175, '百万円')).toBe(1);
  });

  it('2億円は1.75億円の整数への丸めとして一致する（丸めの幅を超える差は検出する）', () => {
    expect(mismatchCount('2030年度の売上2億円を目指す。', 175, '百万円')).toBe(0);
    expect(mismatchCount('2030年度の売上3億円を目指す。', 175, '百万円')).toBe(1);
  });

  it('億円の目標に対する整数の一致は従来どおり一致する', () => {
    expect(mismatchCount('2030年度の売上120億円を目指す。', 120, '億円')).toBe(0);
    expect(mismatchCount('2030年度の売上130億円を目指す。', 120, '億円')).toBe(1);
  });
});
