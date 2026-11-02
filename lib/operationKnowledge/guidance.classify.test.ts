import { buildOperationGuidance, classifyQuestion, detectOperationIntent } from './guidance';

describe('質問の分類（操作・経営・複合）', () => {
  it.each([
    ['初めて使うんだけど、何から始めたらいい？', 'operation'],
    ['この画面では何をすればいい？', 'operation'],
    ['SWOT分析って何？ どうすればいいの？', 'operation'],
    ['経営計画書を作りたい。', 'operation'],
    ['組織変革ルームは何のためにあるの？', 'operation'],
    ['そんなボタンが見当たらないけど？', 'operation'],
    ['保存するにはどうすればいい？', 'operation'],
    ['次は何をすればいい？', 'operation'],
  ])('操作の質問：%s', (q, kind) => {
    expect(classifyQuestion(q)).toBe(kind);
  });

  it.each([
    ['この戦略で本当に売上が伸びるの？'],
    ['社員が全然動いてくれない。どうすればいい？'],
    ['売上を伸ばすには？'],
    ['利益を増やすために、どう考えればいい？'],
    ['新規事業を作りたいけど、市場は大丈夫？'],
    ['営業を強化すれば売上は伸びる？'],
    ['社員のやる気を上げるにはどうすればいい？'],
    ['戦略の方向性を決めるには？'],
    ['STAGE2の戦略は本当に正しい？'],
  ])('経営相談（操作にならない）：%s', (q) => {
    expect(classifyQuestion(q)).toBe('consult');
    expect(detectOperationIntent(q)).toBe(false);
    expect(buildOperationGuidance({ screenId: 'stage2', query: q, role: 'admin' }).text).toBe('');
  });

  it.each([
    ['経営計画書を作りたい。この戦略で売上は伸びる？'],
    ['STAGE2のたたき台を生成して、売上が伸びるか判断したい'],
  ])('複合の質問（操作と経営相談を含む）：%s', (q) => {
    expect(classifyQuestion(q)).toBe('compound');
    expect(detectOperationIntent(q)).toBe(true);
  });

  it('対象のない、どうすれば は操作にしない（経営の悩みとして扱う）', () => {
    expect(classifyQuestion('どうすればいい？')).toBe('none');
  });
});

describe('対象が特定できない操作（推測しない）', () => {
  it('「そんなボタン」は、ボタン名か画面を一つだけ尋ねる', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: 'そんなボタンが見当たらないけど？', role: 'member' });
    expect(r.operationCount).toBe(0);
    expect(r.text).toContain('特定できません');
    expect(r.text).toContain('どちらか一つだけを尋ねてください');
  });

  it('画面が不明でも、ボタンを特定できないときは尋ねる（画面名の推測はしない）', () => {
    const r = buildOperationGuidance({ screenId: null, query: 'このボタンはどこ？', role: 'admin' });
    expect(r.operationCount).toBe(0);
    expect(r.text).toContain('特定できません');
  });

  it('登録された操作名を含む質問は、その操作の画面を案内する（推測ではなく登録の一致）', () => {
    const r = buildOperationGuidance({ screenId: 'stage2', query: '分析を更新するには？', role: 'admin' });
    expect(r.text).toContain('■ STAGE1 会社の現状はどうか（/stage1）');
    expect(r.text).toContain('「分析を更新」');
  });
});

describe('初心者向けの見せ方', () => {
  it('手順は、各操作で最大3つまで示し、残りは追加質問で説明する', () => {
    const r = buildOperationGuidance({
      screenId: 'stage2',
      query: 'STAGE2のAIともう一段掘り下げるにはどうすればいい？',
      role: 'admin',
    });
    expect(r.text).toContain('「AIともう一段掘り下げる」');
    expect(r.text).toContain('（残りの手順は、追加で尋ねられたら説明してください）');
    const line = r.text.split('\n').find((l) => l.startsWith('  手順:')) ?? '';
    expect((line.match(/\d\. /g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it('回答原則に、目的と1〜3手順、推測の例の明記を含む', () => {
    const r = buildOperationGuidance({ screenId: 'stage1', query: 'この画面では何をすればいい？', role: 'admin' });
    expect(r.text).toContain('目的を先に示し、次の1〜3手順だけ');
    expect(r.text).toContain('「例（推測）」と明記する');
  });
});
