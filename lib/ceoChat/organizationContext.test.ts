import { buildSelectedContextBlock, selectContextSources, selectOrganizationSource } from './contextSelection';

const LONG_TITLE = 'あ'.repeat(40);

const STRATEGY = {
  departments: [
    { name: '宅配事業', projects: [{ title: LONG_TITLE }, { title: '' }] },
    { name: '新聞販売・配達事業', projects: [] },
  ],
};

describe('業務・担当の相談で部門とプロジェクト名を参照する', () => {
  it('担当・現場・部門などの語があれば対象にする。経営の一般的な質問は対象にしない', () => {
    expect(selectOrganizationSource('私は宅配の配達を担当している社員です。')).toBe(true);
    expect(selectOrganizationSource('現場で改善できそうなことはありますか')).toBe(true);
    expect(selectOrganizationSource('当社の売上はどう？')).toBe(false);
  });

  it('企業データを使う相談では、部門名を入れ、長いプロジェクト名は切り詰め、未登録を明示する', () => {
    const block = buildSelectedContextBlock({
      selection: selectContextSources('担当の業務を改善したい'),
      strategy: STRATEGY,
      companyDataIncluded: true,
      organization: true,
    });
    expect(block).toContain('【自社の部門・プロジェクト（名称）】');
    expect(block).toContain(`- 宅配事業：「${'あ'.repeat(30)}…」`);
    expect(block).not.toContain('あ'.repeat(31));
    expect(block).toContain('- 新聞販売・配達事業：プロジェクト未登録');
  });

  it('企業データを使わない相談、または業務・担当の語がない相談では、部門名を入れない', () => {
    const general = buildSelectedContextBlock({
      selection: selectContextSources('担当の業務を改善したい'),
      strategy: STRATEGY,
      companyDataIncluded: false,
      organization: true,
    });
    expect(general).not.toContain('自社の部門・プロジェクト');

    const notWork = buildSelectedContextBlock({
      selection: selectContextSources('当社の売上はどう？'),
      strategy: STRATEGY,
      companyDataIncluded: true,
      organization: false,
    });
    expect(notWork).not.toContain('自社の部門・プロジェクト');
  });
});
