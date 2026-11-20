export type AnswerStyle = 'detailed' | 'conversation' | 'conversation_followup';

const DETAIL_REQUEST = /詳しく|詳細|詳述|数値|比較|実行計画|報告書|計画書|一覧|複数の施策|施策を複数/;

export function decideAnswerStyle(input: { userText: string; hasPriorAssistantTurn: boolean }): AnswerStyle {
  if (DETAIL_REQUEST.test(input.userText)) return 'detailed';
  return input.hasPriorAssistantTurn ? 'conversation_followup' : 'conversation';
}

export function isManualAdvisorChat(input: {
  resolvedMode: 'facilitator' | 'help' | 'advisor';
  output: 'text' | 'json';
  insights: 'none' | 'stage1';
  hasCompanion: boolean;
  hasOperationGuidance: boolean;
}): boolean {
  return (
    input.resolvedMode === 'advisor' &&
    input.output === 'text' &&
    input.insights === 'none' &&
    !input.hasCompanion &&
    !input.hasOperationGuidance
  );
}

const CONVERSATION_RULES = [
  '- 最も重要な見解と、この企業に固有の根拠に絞り、原則2〜4段落の自然な会話で答える。見出しは使わない。',
  '- 「結論として」「重点は3つ」「まず90日間で」のような報告書調の展開をしない。長い箇条書きや複数段階の実行計画は書かない。',
  '- 初回に分析・施策・実行計画をすべて説明しない。次の一歩は、相手が求めた場合か判断に必要な場合だけ1つ示す。',
  '- 判断材料が不足し重要な論点が残る場合に限り、自然な質問を1つ返す。質問は必須ではない。',
];

const FOLLOWUP_RULE =
  '- 前の会話を踏まえ、相手の返答を受け止めて議論を深める。最初から分析を繰り返さない。必要なら前の見解を修正する。';

const DETAILED_RULES = [
  '- 詳細な分析・数値比較・施策・実行計画を求められているため、根拠を示して従来どおり十分に詳しく回答する。',
  '- 見出しや箇条書きで構造化してよい。',
];

export function buildAnswerStyleBlock(style: AnswerStyle): string {
  if (style === 'detailed') {
    return ['【今回の回答スタイル：詳細】', ...DETAILED_RULES].join('\n');
  }
  if (style === 'conversation_followup') {
    return ['【今回の回答スタイル：通常の経営相談（前の会話を踏まえる）】', ...CONVERSATION_RULES, FOLLOWUP_RULE].join('\n');
  }
  return ['【今回の回答スタイル：通常の経営相談】', ...CONVERSATION_RULES].join('\n');
}
