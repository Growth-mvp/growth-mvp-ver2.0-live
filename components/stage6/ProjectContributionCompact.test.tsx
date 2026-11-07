import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectContributionCompact, type ContributionRow } from './ProjectContributionCompact';

const row = (n: number, overrides: Partial<ContributionRow> = {}): ContributionRow => ({
  key: `p${n}`,
  dept: '営業部',
  proj: `P${n}`,
  investTotal: 0,
  krCount: 1,
  deltaRevenueTotal: n * 10,
  deltaOpTotal: n,
  targetRevenueMJPY: 100,
  targetOpIncomeMJPY: 10,
  ...overrides,
});

describe('ProjectContributionCompact', () => {
  it('初期表示は上位5件までで、残りは全件表示の導線から開く', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => row(n));
    const html = renderToStaticMarkup(<ProjectContributionCompact projectContrib={rows} />);
    expect(html).toContain('全6件を表示');
    expect(html).toContain('P6');
    expect(html).not.toContain('>P1<');
    expect(html).toContain('>P6<');
  });

  it('5件以下なら全件表示の導線を出さない', () => {
    const html = renderToStaticMarkup(<ProjectContributionCompact projectContrib={[row(1), row(2)]} />);
    expect(html).not.toContain('件を表示');
  });

  it('目標の未設定と寄与の0を区別して表示する', () => {
    const html = renderToStaticMarkup(
      <ProjectContributionCompact
        projectContrib={[row(1, { targetRevenueMJPY: undefined, targetOpIncomeMJPY: 0, deltaRevenueTotal: 0, deltaOpTotal: 0 })]}
      />,
    );
    expect(html).toContain('目標 未設定');
    expect(html).toContain('目標 0 百万円');
    expect(html).toContain('0 百万円');
  });

  it('寄与の算定対象KRがすべて除外されていれば未算定と表示する', () => {
    const html = renderToStaticMarkup(
      <ProjectContributionCompact projectContrib={[row(1, { krCount: 2, financeExcludedKrCount: 2 })]} />,
    );
    expect(html).toContain('未算定');
  });

  it('プロジェクトが無いときは空の案内を表示する', () => {
    const html = renderToStaticMarkup(<ProjectContributionCompact projectContrib={[]} />);
    expect(html).toContain('表示するプロジェクトがありません。');
  });

  it('寄与0の項目を「効果なし」と断定しない注記を表示する', () => {
    const html = renderToStaticMarkup(<ProjectContributionCompact projectContrib={[row(1)]} />);
    expect(html).toContain('「効果なし」を意味せず');
  });
});
