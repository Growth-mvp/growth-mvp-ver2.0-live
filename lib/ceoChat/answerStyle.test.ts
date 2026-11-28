import { buildAnswerStyleBlock, decideAnswerStyle, isManualAdvisorChat } from './answerStyle';

const MANUAL = {
  resolvedMode: 'advisor' as const,
  output: 'text' as const,
  insights: 'none' as const,
  hasCompanion: false,
  hasOperationGuidance: false,
};

describe('回答スタイルの判定', () => {
  it('業績の相談は会話型、履歴があれば前の会話を踏まえる会話型', () => {
    expect(decideAnswerStyle({ userText: 'うちの会社、どうやったら業績上がるの？', hasPriorAssistantTurn: false })).toBe('conversation');
    expect(decideAnswerStyle({ userText: '顧客別採算はまだ把握できていません', hasPriorAssistantTurn: true })).toBe('conversation_followup');
  });

  it('詳細分析・数値・施策・実行計画を明示的に求めた場合は詳細型', () => {
    expect(
      decideAnswerStyle({
        userText: '2030年度の業績目標について、数値・施策・実行計画を詳しく分析して',
        hasPriorAssistantTurn: true,
      })
    ).toBe('detailed');
  });
});

describe('回答スタイル指示の適用条件', () => {
  it('通常の手動チャットの advisor だけに適用する', () => {
    expect(isManualAdvisorChat(MANUAL)).toBe(true);
  });

  it('help・facilitator・JSON・自律伴走・操作案内・insights には適用しない', () => {
    expect(isManualAdvisorChat({ ...MANUAL, resolvedMode: 'help' })).toBe(false);
    expect(isManualAdvisorChat({ ...MANUAL, resolvedMode: 'facilitator' })).toBe(false);
    expect(isManualAdvisorChat({ ...MANUAL, output: 'json' })).toBe(false);
    expect(isManualAdvisorChat({ ...MANUAL, hasCompanion: true })).toBe(false);
    expect(isManualAdvisorChat({ ...MANUAL, hasOperationGuidance: true })).toBe(false);
    expect(isManualAdvisorChat({ ...MANUAL, insights: 'stage1' })).toBe(false);
  });
});

describe('回答スタイル指示の内容', () => {
  it('会話型は段落数を固定せず、報告書調を禁じ、問いは毎回返さない', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('【今回の回答スタイル：通常の経営相談】');
    expect(block).toContain('段落数は決めない');
    expect(block).toContain('「結論として」「重点は3つ」「まず90日間で」');
    expect(block).toContain('「率直に言うと」「正直に言うと」から話し始めない');
    expect(block).toContain('「うちの会社を良くするには」のような幅広い相談');
    expect(block).toContain('毎回は問わない');
    expect(block).not.toContain('2〜4段落');
    expect(block).not.toContain('1つ返す');
    expect(block).not.toContain('前の会話を踏まえ');
  });

  it('簡単な質問は結論を最初の一文に置き、段階の一覧を関係なく並べない', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('簡単な質問（確認や一言で答えられる問い）には、結論を最初の一文に書き、短い会話文で答える。');
    expect(block).toContain('STAGE1〜6などの段階の一覧は、質問に関係する場合だけ触れる。');
  });

  it('詳細な回答も、最初の一文に結論を書く（音声の要点読み上げに使う）', () => {
    expect(buildAnswerStyleBlock('detailed')).toContain('回答の最初の一文に結論を書く');
  });

  it('前の会話がある会話型は、返答を受けて議論を深める指示を含む', () => {
    const block = buildAnswerStyleBlock('conversation_followup');
    expect(block).toContain('前の会話を踏まえ');
    expect(block).toContain('最初から分析を繰り返さない');
  });

  it('詳細型は詳しい回答を維持し、会話型の段落制限を含まない', () => {
    const block = buildAnswerStyleBlock('detailed');
    expect(block).toContain('従来どおり十分に詳しく回答する');
    expect(block).not.toContain('2〜4段落');
  });

  it('会話型は、気持ちや困りごとを最初に受け止め、事情が足りない時だけ問いを1つ添える', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('最初の一文で相手の言葉や問題意識を受け止める');
    expect(block).toContain('自然な問いを1つだけ添える');
    expect(block).toContain('問い返しでかわさず');
  });

  it('会話型は一度に全部を説明せず、次の一歩と見出しを絞る', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('見出しは使わない');
    expect(block).toContain('一度の回答で分析・施策・実行計画をすべて説明しない');
    expect(block).toContain('次の一歩は、相手が求めた場合か判断に必要な場合だけ1つ示す');
  });

  it('共通原則は agentPrompt 側に一本化し、回答スタイル指示には重複させない', () => {
    for (const style of ['conversation', 'conversation_followup', 'repeat', 'objection', 'detailed'] as const) {
      const block = buildAnswerStyleBlock(style);
      expect(block).not.toContain('事実と仮説の区別');
      expect(block).not.toContain('個別の案件が赤字');
      expect(block).not.toContain('推測ですが');
    }
  });

  it('共通の会話規則は、どの会話型でも1回だけ書く（指示を重複させない）', () => {
    for (const style of ['conversation', 'conversation_followup', 'repeat', 'objection'] as const) {
      const block = buildAnswerStyleBlock(style);
      expect(block.split('見出しは使わない').length - 1).toBe(1);
    }
  });
});

describe('同じ質問の繰り返し・制約や異議の判定', () => {
  const Q = 'うちの会社、どうやったら業績上がるの？';

  it('前の発言と同じ質問（句読点・空白の差は無視）は、繰り返しとして扱う', () => {
    expect(
      decideAnswerStyle({ userText: 'うちの会社どうやったら業績上がるの', hasPriorAssistantTurn: true, priorUserTexts: [Q] })
    ).toBe('repeat');
  });

  it('前回の回答がなければ、同じ文でも繰り返しとはしない', () => {
    expect(decideAnswerStyle({ userText: Q, hasPriorAssistantTurn: false, priorUserTexts: [Q] })).toBe('conversation');
  });

  it('「でも、それは現実的ではない」は異議として扱う', () => {
    expect(
      decideAnswerStyle({ userText: 'でも、それは現実的ではない', hasPriorAssistantTurn: true, priorUserTexts: [Q] })
    ).toBe('objection');
  });

  it('制約（時間・人手・予算がない）も、新しい判断条件として異議と同じ扱いにする', () => {
    expect(
      decideAnswerStyle({
        userText: '顧客別採算は分からないし、原価計算に時間もかけられないんだよ',
        hasPriorAssistantTurn: true,
      })
    ).toBe('objection');
  });

  it('異議の判定より、詳細分析の明示的な依頼を優先する', () => {
    expect(
      decideAnswerStyle({ userText: 'でも、数値と実行計画を詳しく出して', hasPriorAssistantTurn: true, priorUserTexts: [Q] })
    ).toBe('detailed');
  });

  it('繰り返し・異議の指示は、それぞれ固有の指示を持ち、互いに混ざらない', () => {
    const repeat = buildAnswerStyleBlock('repeat');
    const objection = buildAnswerStyleBlock('objection');
    expect(repeat).toContain('前回と同じ説明は繰り返さない');
    expect(repeat).toContain('繰り返しだけを不満と決めつけない');
    expect(repeat).not.toContain('新しい判断条件');
    expect(objection).toContain('新しい判断条件として扱う');
    expect(objection).toContain('前の提案が成り立たないなら');
    expect(objection).not.toContain('前回と同じ説明は繰り返さない');
  });
});
