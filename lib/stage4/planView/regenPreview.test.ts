import { draftOfBundle } from './regenPreview';

describe('保存された草案からAIの元の案を読む', () => {
  it('保存された案の生のAI出力を優先して読む。読めなければ空を返す', () => {
    expect(draftOfBundle({ rawOutput: '{"a":1}', plan: { a: 2 } })).toEqual({ a: 1 });
    expect(draftOfBundle({ rawOutput: 'not json', plan: null })).toBeNull();
  });
});
