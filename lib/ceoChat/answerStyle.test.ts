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
  it('会話型は報告書調を禁じ、2〜4段落と質問の任意性を示す', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('【今回の回答スタイル：通常の経営相談】');
    expect(block).toContain('原則2〜4段落の自然な会話で答える');
    expect(block).toContain('「結論として」「重点は3つ」「まず90日間で」');
    expect(block).toContain('質問は必須ではない');
    expect(block).not.toContain('前の会話を踏まえ');
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

  it('会話型は初回に全部を説明せず、次の一歩と見出しを絞る', () => {
    const block = buildAnswerStyleBlock('conversation');
    expect(block).toContain('見出しは使わない');
    expect(block).toContain('初回に分析・施策・実行計画をすべて説明しない');
    expect(block).toContain('次の一歩は、相手が求めた場合か判断に必要な場合だけ1つ示す');
  });

  it('共通原則は agentPrompt 側に一本化し、回答スタイル指示には重複させない', () => {
    for (const style of ['conversation', 'conversation_followup', 'detailed'] as const) {
      const block = buildAnswerStyleBlock(style);
      expect(block).not.toContain('事実と仮説の区別');
      expect(block).not.toContain('個別の案件が赤字');
      expect(block).not.toContain('推測ですが');
    }
  });
});
