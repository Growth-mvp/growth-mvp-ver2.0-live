import { checkRevisionAfterUpdate } from './revisionCheck';

describe('既存の行の保存の後の revision の確認', () => {
  it('正常: 1 増えていれば ok', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 5, after: 6 })).toEqual({ ok: true });
  });

  it('既存の行で revision が 0 のままの更新は、トリガーの無い環境の異常（0 は初期値とは扱わない）', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 0, after: 0 })).toEqual({ ok: false, reason: 'not_advanced' });
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 0, after: 1 })).toEqual({ ok: true });
  });

  it('増えていない・戻った場合は異常', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 5, after: 5 })).toEqual({ ok: false, reason: 'not_advanced' });
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 5, after: 4 })).toEqual({ ok: false, reason: 'not_advanced' });
  });

  it('2 以上増えた場合は異常（二重に加算された可能性）', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 5, after: 7 })).toEqual({ ok: false, reason: 'skipped' });
  });

  it('返された revision が不明、または基準が不明なら異常', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: 5, after: undefined })).toEqual({ ok: false, reason: 'unknown_after' });
    expect(checkRevisionAfterUpdate({ isExistingRow: true, before: undefined, after: 6 })).toEqual({ ok: false, reason: 'unknown_before' });
  });

  it('新規行（既存の行ではない）は、revision が 0 でも確認の対象外（正常な初期値）', () => {
    expect(checkRevisionAfterUpdate({ isExistingRow: false, before: undefined, after: 0 })).toEqual({ ok: true });
  });
});
