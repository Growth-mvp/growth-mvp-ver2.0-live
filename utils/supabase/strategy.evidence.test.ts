/* eslint-disable @typescript-eslint/no-explicit-any -- テスト用のストア状態の型をゆるく扱う */
import { normalizeStrategyData } from './normalize';

describe('初回生成の根拠の保存（追加探索で使う）', () => {
  it('根拠（出典と根拠文）は保存の読み直しで残る', () => {
    const data = normalizeStrategyData({
      swotSuggestions: {
        opportunity: ['機会。'],
        evidence: {
          findings: [{ theme: '市場', statement: '出荷が増えた。', sourceIndex: 1, segment: '美術缶事業' }],
          sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-31T00:00:00.000Z', bodyCheck: 'matched' }],
        },
      },
    } as never);
    expect((data as any).swotSuggestions?.evidence).toEqual({
      findings: [{ theme: '市場', statement: '出荷が増えた。', sourceIndex: 1, segment: '美術缶事業' }],
      sources: [{ index: 1, url: 'https://example.com/a', title: 'A', retrievedAt: '2026-10-31T00:00:00.000Z', bodyCheck: 'matched' }],
    });
  });

  it('https 以外の出典や形式の不正な根拠は捨て、根拠が無ければ何も残さない', () => {
    const data = normalizeStrategyData({
      swotSuggestions: {
        opportunity: ['機会。'],
        evidence: {
          findings: [{ theme: 't', statement: 's', sourceIndex: 'x' }],
          sources: [{ index: 1, url: 'http://example.com/a', title: 'A', retrievedAt: 'x' }],
        },
      },
    } as never);
    expect((data as any).swotSuggestions?.evidence).toBeUndefined();
    expect((data as any).swotSuggestions?.opportunity).toEqual(['機会。']);
  });

  it('根拠の無い古い保存データも、そのまま読める', () => {
    const data = normalizeStrategyData({ swotSuggestions: { opportunity: ['古い機会。'], threat: [] } } as never);
    expect((data as any).swotSuggestions?.opportunity).toEqual(['古い機会。']);
    expect((data as any).swotSuggestions?.evidence).toBeUndefined();
  });
});
