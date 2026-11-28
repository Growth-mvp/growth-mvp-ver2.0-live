import { buildOperationGuidance, classifyQuestion, detectOperationIntent } from './guidance';

const CONSULT_QUESTIONS = [
  '当社の利益率を上げたいのですが、まず何から手を付けるべきでしょうか？',
  '組織を変革するには、何から始めればよいですか？',
  '売上を伸ばすためには、どこから改善すべきですか？',
  '今の経営戦略を実行するために、次は何をすべきでしょうか？',
  '社員の主体性を高めるには、何から取り組めばよいですか？',
];

const OPERATION_QUESTIONS = [
  'GROWTH SHIFTでは、何から入力すればよいですか？',
  'STAGE2の入力が終わりました。次は何をすればよいですか？',
  '経営戦略書はどこからPDF出力できますか？',
  '実行計画の保存ボタンはどこにありますか？',
  '次は何を入力すればよいですか？',
];

describe('経営相談と操作案内の区別：一般語（何から・次は・どこ）だけでは操作案内にしない', () => {
  it.each(CONSULT_QUESTIONS)('経営相談として扱う：%s', (q) => {
    expect(detectOperationIntent(q)).toBe(false);
    expect(classifyQuestion(q)).not.toBe('operation');
    expect(buildOperationGuidance({ screenId: null, query: q, role: 'admin' as any }).text).toBe('');
  });

  it.each(OPERATION_QUESTIONS)('操作案内として扱う：%s', (q) => {
    expect(detectOperationIntent(q)).toBe(true);
    expect(buildOperationGuidance({ screenId: null, query: q, role: 'admin' as any }).text).not.toBe('');
  });

  it('利益率の相談は、操作案内の経路に入らない（developer指示と経営相談用の指示を適用できる）', () => {
    const q = '当社の利益率を上げたいのですが、まず何から手を付けるべきでしょうか？';
    expect(classifyQuestion(q)).toBe('consult');
  });

  it('操作と相談の両方を求める質問は、複合として扱う', () => {
    expect(classifyQuestion('利益率を上げたいのですが、その計算は画面のどこから確認できますか？')).toBe('compound');
  });
});
