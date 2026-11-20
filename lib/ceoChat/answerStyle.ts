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
  '- 最も重要な見解と、この企業に固有の根拠に絞り、原則2〜4段落の自然な会話で答える。',
  '- 「結論として」「重点は3つ」「まず90日間で」のような報告書調の展開をしない。見出し、長い箇条書き、複数段階の実行計画は書かない。',
  '- STAGE1〜6の登録情報は網羅せず、質問に関係するものだけを選んで使う。',
  '- 判断材料が不足し重要な論点が残る場合に限り、自然な質問を1つ返す。質問は必須ではない。',
];

const FOLLOWUP_RULE =
  '- 直前の会話を踏まえ、利用者の返答を受けて議論を深める。最初から分析を繰り返さない。';

const DETAILED_RULES = [
  '- 利用者は詳細な分析・数値・施策・実行計画を求めています。根拠を示し、従来どおり十分に詳しく回答する。',
  '- 事実・仮説・提案を区別し、数値は登録データと出典に基づいて正確に示す。推測は「推測ですが」と明記する。',
];

const COMMON_RULES = [
  '- 事実と仮説の区別、数値の正確性、批判的な見解、顧客価値、全体最適、社員の主体性は維持する。',
  '- 会社全体の赤字から、個別の案件が赤字だと断定しない。個別の数値が確認できた場合だけ述べる。',
];

export function buildAnswerStyleBlock(style: AnswerStyle): string {
  if (style === 'detailed') {
    return ['【今回の回答スタイル：詳細】', ...DETAILED_RULES, ...COMMON_RULES].join('\n');
  }
  const rules = style === 'conversation_followup'
    ? [...CONVERSATION_RULES, FOLLOWUP_RULE]
    : CONVERSATION_RULES;
  const title = style === 'conversation_followup'
    ? '【今回の回答スタイル：通常の経営相談（前の会話を踏まえる）】'
    : '【今回の回答スタイル：通常の経営相談】';
  return [title, ...rules, ...COMMON_RULES].join('\n');
}
