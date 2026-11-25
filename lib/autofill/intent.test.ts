import { isAttachmentRequest, isAutofillRequest } from './intent';

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

  it('登録状況を尋ねる質問は、会社情報の取得の依頼にしない', () => {
    expect(isAutofillRequest('財務実績は登録されていますか？')).toBe(false);
    expect(isAutofillRequest('日本製罐の財務データは登録されていますか？')).toBe(false);
  });

  it('添付資料からの入力の依頼は、会社名として「添付資料」を取らず、EDINETへ送らない', () => {
    expect(isAutofillRequest('添付資料から基本情報を入力して')).toBe(false);
    expect(isAutofillRequest('添付したPDFから財務を取り込んで')).toBe(false);
    expect(isAttachmentRequest('添付資料から基本情報を入力して')).toBe(true);
    expect(isAttachmentRequest('添付したPDFから財務を取り込んで')).toBe(true);
  });

  it('証券コードを付けた依頼は上場企業の取得として扱う', () => {
    expect(isAttachmentRequest('証券コード5905の有価証券報告書を資料から入力して')).toBe(false);
    expect(isAutofillRequest('証券コード5905の有価証券報告書を資料から入力して')).toBe(true);
  });

  it('添付資料について尋ねる文は、入力の依頼にしない', () => {
    expect(isAttachmentRequest('添付した資料の内容を教えて')).toBe(false);
    expect(isAttachmentRequest('資料の入力方法は？')).toBe(false);
  });
});
