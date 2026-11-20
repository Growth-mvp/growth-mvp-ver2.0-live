import { publicProfileQuery } from './intent';

describe('公開情報から会社情報を調べる依頼の判定', () => {
  it('依頼文から会社名を取り出す', () => {
    expect(publicProfileQuery('株式会社サンプル製作所の会社情報を調べて')).toBe('株式会社サンプル製作所');
    expect(publicProfileQuery('サンプル工業について企業情報を検索してください')).toBe('サンプル工業');
    expect(publicProfileQuery('(株)サンプルの会社概要を調べて')).toBe('(株)サンプル');
  });

  it('自社を指す依頼・会社名が読めない依頼・調べる指示が無い依頼は対象にしない', () => {
    expect(publicProfileQuery('当社の会社情報を調べて')).toBeNull();
    expect(publicProfileQuery('会社情報を調べて')).toBeNull();
    expect(publicProfileQuery('株式会社サンプルの会社情報を教えて')).toBeNull();
    expect(publicProfileQuery('株式会社サンプルの売上を分析して')).toBeNull();
  });
});
