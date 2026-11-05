import { buildPublicSearchQuery, publicIndustryLabel } from './query';

const SAAS_SEGMENT = {
  id: 's1',
  name: '社内業務の効率化事業',
  summary: '中堅製造業向けに業務用ソフトウェア（SaaS）を提供',
  scope: '国内',
  mainProductsServices: ['SaaS'],
  keyCustomers: ['株式会社極秘顧客'],
  revenue: 500,
};

describe('業種ラベルの取得元', () => {
  it('業種コードは許可済みの表示名に変換する', () => {
    expect(publicIndustryLabel('it')).toBe('情報通信・IT');
  });

  it('その他・自由記述・未登録の値は検索に使わない', () => {
    expect(publicIndustryLabel('other')).toBe('');
    expect(publicIndustryLabel('自由記述の業種')).toBe('');
    expect(publicIndustryLabel(undefined)).toBe('');
  });
});

describe('検索クエリの生成（公開情報だけで組み立てる）', () => {
  it('業種と照合された公開市場分類のラベルを使う', () => {
    const r = buildPublicSearchQuery({ industry: 'it', businessContent: '', businessSegments: [SAAS_SEGMENT] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.query.input).toContain('業界: 情報通信・IT');
    expect(r.query.categoryLabels).toContain('業務用ソフトウェア・SaaS');
  });

  it('事業の文章・顧客名は検索入力に入らない（照合にだけ使う）', () => {
    const r = buildPublicSearchQuery({ industry: 'it', businessContent: '', businessSegments: [SAAS_SEGMENT] });
    if (!r.ok) throw new Error('query should be built');
    expect(r.query.input).not.toContain('極秘顧客');
    expect(r.query.input).not.toContain('中堅製造業向け');
    expect(r.query.input).not.toContain('社内業務の効率化事業');
  });

  it('事業概要の機密語も、照合に使うだけで検索入力には入らない', () => {
    const r = buildPublicSearchQuery({
      industry: '',
      businessContent: 'SaaSで極秘プロジェクトXの顧客データを管理',
      businessSegments: [],
    });
    if (!r.ok) throw new Error('query should be built');
    expect(r.query.categoryLabels).toContain('業務用ソフトウェア・SaaS');
    expect(r.query.input).not.toContain('極秘プロジェクト');
    expect(r.query.input).not.toContain('顧客データ');
  });

  it('分類に一致しないが業種がある場合は、業種レベルの一般的な観点に限定する', () => {
    const r = buildPublicSearchQuery({ industry: 'retail', businessContent: '', businessSegments: [] });
    if (!r.ok) throw new Error('query should be built');
    expect(r.query.categoryIds).toEqual([]);
    expect(r.query.input).toContain('業界: 小売業');
    expect(r.query.input).toContain('規制・制度の変化');
  });

  it('分類にも業種にも一致しない場合は、検索条件を作らない', () => {
    expect(buildPublicSearchQuery({ industry: 'other', businessContent: '', businessSegments: [] })).toEqual({
      ok: false,
      reason: 'no_public_scope',
    });
  });

  it('自由記述の業種名は検索入力に入れない', () => {
    const r = buildPublicSearchQuery({
      industry: '秘密の自由記述業種',
      businessContent: 'SaaSを提供',
      businessSegments: [],
    });
    if (!r.ok) throw new Error('query should be built');
    expect(r.query.input).not.toContain('秘密の自由記述業種');
  });
});
