import { resolveStage1Input, type Stage1InputContext } from './stage1Input';

const ctx: Stage1InputContext = {
  segmentNames: ['製造事業', 'カフェ'],
  issueTitles: ['新規顧客の獲得が鈍い'],
  financeYen: () => null,
};

describe('取り消し・削除の依頼の読み取り', () => {
  it.each(['取り消して', '直前の入力を取り消して', '元に戻して'])('「%s」は直前の入力の取り消し', (text) => {
    expect(resolveStage1Input(text, ctx)).toEqual({ kind: 'action', action: { kind: 'undo' } });
  });

  it('登録済みの事業の削除は、影響を確かめる対象として返す', () => {
    expect(resolveStage1Input('事業「カフェ」を削除して', ctx)).toEqual({
      kind: 'remove',
      target: { type: 'segment', name: 'カフェ' },
    });
  });

  it('登録済みの経営課題の削除は、題名で特定する', () => {
    expect(resolveStage1Input('経営課題「新規顧客の獲得が鈍い」を削除してください', ctx)).toEqual({
      kind: 'remove',
      target: { type: 'issue', name: '新規顧客の獲得が鈍い' },
    });
  });

  it('登録されていない事業の削除は、確認を求める', () => {
    expect(resolveStage1Input('事業「ヨガ」を削除して', ctx)).toMatchObject({ kind: 'clarify' });
  });

  it('対象が特定できない経営課題の削除は、題名を尋ねる', () => {
    expect(resolveStage1Input('先ほどの経営課題を削除して', ctx)).toMatchObject({ kind: 'clarify' });
  });

  it('全データの初期化は、対象外として断る', () => {
    expect(resolveStage1Input('全データを初期化して', ctx)).toEqual({
      kind: 'clarify',
      message: '全データの初期化は、この画面からは行えません。',
    });
  });

  it('削除しないでという発言は、操作にしない', () => {
    expect(resolveStage1Input('事業「カフェ」は削除しないで', ctx)).toBeNull();
  });
});
