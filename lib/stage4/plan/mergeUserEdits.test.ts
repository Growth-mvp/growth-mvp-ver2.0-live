import { mergeUserEdits, resolveUserEdits } from './mergeUserEdits';

describe('mergeUserEdits（同時編集の突き合わせ）', () => {
  it('片方だけが変えた項目は、変えた方を採る', () => {
    const r = mergeUserEdits({ a: '1', b: '1' }, { a: '2', b: '1' }, { a: '1', b: '3' });
    expect(r).toEqual({ merged: { a: '2', b: '3' }, conflicts: [] });
  });

  it('両方が同じ値に変えた項目は、競合にしない', () => {
    expect(mergeUserEdits({ a: '1' }, { a: '2' }, { a: '2' })).toEqual({ merged: { a: '2' }, conflicts: [] });
  });

  it('両方が違う値に変えた項目は、自動では選ばず競合として返す', () => {
    const r = mergeUserEdits({ a: '1' }, { a: '2' }, { a: '3' });
    expect(r.conflicts).toEqual(['a']);
    expect(r.merged).toEqual({});
  });

  it('片方が項目を消した場合も、変えた方として扱う', () => {
    expect(mergeUserEdits({ a: '1' }, {}, { a: '1' })).toEqual({ merged: {}, conflicts: [] });
  });

  it('利用者が選んだ側で競合を確定できる（選ばなかった方の値は残らない）', () => {
    const out = resolveUserEdits({ base: { a: '1', b: '1' }, local: { a: '2', b: '1' }, remote: { a: '3', b: '4' }, picks: { a: 'local' } });
    expect(out).toEqual({ a: '2', b: '4' });
    const remote = resolveUserEdits({ base: { a: '1' }, local: { a: '2' }, remote: { a: '3' }, picks: { a: 'remote' } });
    expect(remote).toEqual({ a: '3' });
  });
});
