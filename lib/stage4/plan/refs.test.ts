import { canonicalizeRefs } from './refs';

const known = new Set(['S2-CORE', 'S3-ISSUE-1', 'S1-FIN']);

describe('canonicalizeRefs（参照IDの正規化）', () => {
  it('角括弧付きでも、既知の正規IDと完全一致すれば角括弧を外す', () => {
    const r = canonicalizeRefs({ a: { sourceRefs: ['[S2-CORE]', '[S3-ISSUE-1]'] } }, known);
    expect(r.value.a.sourceRefs).toEqual(['S2-CORE', 'S3-ISSUE-1']);
    expect(r.normalized).toBe(2);
  });

  it('既知でないIDは、角括弧付きでも変えない（エラーとして残す）', () => {
    const r = canonicalizeRefs({ sourceRefs: ['[S9-NOT-EXIST]'] }, known);
    expect(r.value.sourceRefs).toEqual(['[S9-NOT-EXIST]']);
    expect(r.normalized).toBe(0);
  });

  it('部分一致や、近い別IDへの読み替えはしない', () => {
    const r = canonicalizeRefs({ sourceRefs: ['[S2-CORE ]', '[S2-COR]', '[S3-ISSUE-10]'] }, known);
    expect(r.value.sourceRefs).toEqual(['[S2-CORE ]', '[S2-COR]', '[S3-ISSUE-10]']);
    expect(r.normalized).toBe(0);
  });

  it('角括弧の無いIDや、sourceRefs 以外の文字列は変えない', () => {
    const r = canonicalizeRefs({ text: '[S2-CORE]', sourceRefs: ['S2-CORE'], other: ['[S2-CORE]'] }, known);
    expect(r.value.text).toBe('[S2-CORE]');
    expect(r.value.sourceRefs).toEqual(['S2-CORE']);
    expect(r.value.other).toEqual(['[S2-CORE]']);
    expect(r.normalized).toBe(0);
  });

  it('入力のオブジェクトは変更せず、正規化の例を記録する', () => {
    const input = { sourceRefs: ['[S1-FIN]'] };
    const r = canonicalizeRefs(input, known);
    expect(input.sourceRefs).toEqual(['[S1-FIN]']);
    expect(r.samples).toEqual(['[S1-FIN] → S1-FIN']);
  });
});
