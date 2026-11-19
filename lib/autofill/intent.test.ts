import { isAutofillRequest } from './intent';

describe('公開資料からの入力の依頼の判定', () => {
  it('会社名（または証券コード）と、入力・取得の依頼がそろえば、依頼として扱う', () => {
    expect(isAutofillRequest('日本製罐の基本情報を入力して')).toBe(true);
    expect(isAutofillRequest('丹青社の財務データを取り込んで')).toBe(true);
    expect(isAutofillRequest('証券コード5905の有価証券報告書を反映して')).toBe(true);
  });

  it('会社が読み取れない、または依頼の言い回しが無い文は、AIへの相談として扱う', () => {
    expect(isAutofillRequest('自社の強みを教えて')).toBe(false);
    expect(isAutofillRequest('日本製罐の売上の推移を教えて')).toBe(false);
    expect(isAutofillRequest('基本情報を入力して')).toBe(false);
  });
});
