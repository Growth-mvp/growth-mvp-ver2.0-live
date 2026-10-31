import { basisOf, isHttpsUrl, toSafeSources } from './suggestionView';

const goodSource = {
  index: 1,
  url: 'https://example.com/report',
  title: 'Industry Report',
  retrievedAt: '2026-10-29T01:02:03.000Z',
};

describe('toSafeSources', () => {
  it('https の出典だけを表示対象にする', () => {
    const out = toSafeSources([
      goodSource,
      { ...goodSource, index: 2, url: 'http://insecure.example.com/x' },
      { ...goodSource, index: 3, url: 'javascript:alert(1)' },
      { ...goodSource, index: 4, url: 'not a url' },
    ]);
    expect(out.map((s) => s.index)).toEqual([1]);
  });

  it('index が整数でない・欠けている出典は捨てる', () => {
    const out = toSafeSources([
      { ...goodSource, index: 0 },
      { ...goodSource, index: 1.5 },
      { url: goodSource.url, title: 'no index' },
    ]);
    expect(out).toEqual([]);
  });

  it('タイトルが空なら URL を表示名にし、長すぎるタイトルは切り詰める', () => {
    const out = toSafeSources([
      { ...goodSource, title: '   ' },
      { ...goodSource, index: 2, title: 'x'.repeat(500) },
    ]);
    expect(out[0].title).toBe(goodSource.url);
    expect(out[1].title.length).toBe(200);
  });

  it('配列でない保存値は空として扱う（保存形式が壊れていても落ちない）', () => {
    expect(toSafeSources(undefined)).toEqual([]);
    expect(toSafeSources({ url: 'https://example.com' })).toEqual([]);
    expect(toSafeSources('https://example.com')).toEqual([]);
  });
});

describe('isHttpsUrl', () => {
  it('https 以外と解析できない文字列は false', () => {
    expect(isHttpsUrl('https://example.com/a')).toBe(true);
    expect(isHttpsUrl('http://example.com/a')).toBe(false);
    expect(isHttpsUrl('ftp://example.com')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
  });
});

describe('basisOf（事実と AI 推論の表示区分）', () => {
  const sources = toSafeSources([goodSource]);

  it('出典のある fact は出典番号で表示する', () => {
    expect(basisOf({ basis: 'fact', sourceIndex: 1, evidence: 'Web' }, sources)).toEqual({ kind: 'source', index: 1 });
  });

  it('存在しない出典を指す fact は事実として扱わず AI 推論にする', () => {
    expect(basisOf({ basis: 'fact', sourceIndex: 9, evidence: 'Web' }, sources)).toEqual({ kind: 'hypothesis' });
  });

  it('出典が無く、根拠の記載がある fact は入力情報に基づくと表示する', () => {
    expect(basisOf({ basis: 'fact', sourceIndex: null, evidence: '強み欄の記載' }, sources)).toEqual({ kind: 'input' });
  });

  it('根拠の無い fact は AI 推論にする', () => {
    expect(basisOf({ basis: 'fact', sourceIndex: null, evidence: '  ' }, sources)).toEqual({ kind: 'hypothesis' });
  });

  it('出典に紐づく hypothesis は「出典に基づく仮説」と表示する', () => {
    expect(basisOf({ basis: 'hypothesis', sourceIndex: 1, evidence: 'x' }, sources)).toEqual({
      kind: 'hypothesis_source',
      index: 1,
    });
  });

  it('出典が無くても根拠の記載がある hypothesis は根拠付き仮説、根拠も無いものは要追加調査', () => {
    expect(basisOf({ basis: 'hypothesis', sourceIndex: null, evidence: 'x' }, sources)).toEqual({ kind: 'hypothesis_rationale' });
    expect(basisOf({ basis: 'hypothesis', sourceIndex: 9, evidence: 'x' }, sources)).toEqual({ kind: 'hypothesis_rationale' });
    expect(basisOf({ basis: 'hypothesis', sourceIndex: null, evidence: '' }, sources)).toEqual({ kind: 'hypothesis' });
  });
  it('根拠情報が無い（旧データ）は null で、バッジを出さない', () => {
    expect(basisOf(undefined, sources)).toBeNull();
    expect(basisOf('text', sources)).toBeNull();
  });
});
