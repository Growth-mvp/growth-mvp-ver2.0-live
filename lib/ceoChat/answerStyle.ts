export type AnswerStyle = 'detailed' | 'conversation' | 'conversation_followup' | 'repeat' | 'objection';

const DETAIL_REQUEST = /詳しく|詳細|詳述|数値|比較|実行計画|報告書|計画書|一覧|複数の施策|施策を複数/;
const OBJECTION_CUE = /^(でも|ただ|いや|しかし)|現実的|無理|難しい|できない|かけられ|余裕|時間がない|人手が|予算が|不可能|それは違/;

const normalize = (s: string) => s.replace(/[\s、。，．,.!！?？]/g, '');

export function decideAnswerStyle(input: {
  userText: string;
  hasPriorAssistantTurn: boolean;
  priorUserTexts?: readonly string[];
}): AnswerStyle {
  const { userText, hasPriorAssistantTurn } = input;
  if (DETAIL_REQUEST.test(userText)) return 'detailed';
  if (!hasPriorAssistantTurn) return 'conversation';
  if (OBJECTION_CUE.test(userText.trim())) return 'objection';
  const current = normalize(userText);
  if ((input.priorUserTexts ?? []).some((t) => normalize(t) === current)) return 'repeat';
  return 'conversation_followup';
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

const TITLES: Record<AnswerStyle, string> = {
  detailed: '【今回の回答スタイル：詳細】',
  conversation: '【今回の回答スタイル：通常の経営相談】',
  conversation_followup: '【今回の回答スタイル：通常の経営相談（前の会話を踏まえる）】',
  repeat: '【今回の回答スタイル：同じ質問の繰り返し】',
  objection: '【今回の回答スタイル：相手の制約・異議を受けて】',
};

const CONVERSATION_BASE = [
  '- 長さは相手の質問に合わせ、段落数は決めない。見出しは使わない。',
  '- 「結論として」「重点は3つ」「まず90日間で」のような報告書調の展開をしない。長い箇条書きや複数段階の実行計画は書かない。',
  '- 一度の回答で分析・施策・実行計画をすべて説明しない。次の一歩は、相手が求めた場合か判断に必要な場合だけ1つ示す。',
  '- 経営者の考えを聞くと議論が深まる場合は、自然な問いを添える。毎回は問わない。',
  '- 「率直に言うと」「結論として」「正直に言うと」などの決まり文句から話し始めない。最初の一文は、相談内容への自分の受け止めや見解から始める。',
  '- 「うちの会社を良くするには」のような幅広い相談では、課題や優先順位を最初から一方的に決めつけない。相手の問題意識を尋ねてもよい。',
  '- 明確な賛否や判断を求められた場合は、最初から見解を述べてよい。',
];

const CONVERSATION_EXTRA: Record<Exclude<AnswerStyle, 'detailed'>, string[]> = {
  conversation: [],
  conversation_followup: ['- 前の会話を踏まえ、相手の返答を受け止めて議論を深める。最初から分析を繰り返さない。'],
  repeat: [
    '- 前回と同じ説明は繰り返さない。前回の要点は一言触れる程度にとどめる。',
    '- 別の重要な視点を一つ示すか、どこを深掘りしたいかを自然に尋ねる。',
    '- 繰り返しだけを不満と決めつけない。',
    '- 判断に必要な重要な数値や前提は省略しないが、前回と同じ形で並べ直さない。',
  ],
  objection: [
    '- 相手の制約や異議は、新しい判断条件として扱う。前の提案が成り立たないなら、何が変わったから修正するのかを一言で示して修正する。',
    '- 同じ論点の説明を続けず、相手の条件に合う代替案か、判断の分かれ目を示す。',
    '- 異議を論破しようとしない。相手の状況を確かめる問いは、必要な場合に限る。',
  ],
};

const DETAILED_RULES = [
  '- 詳細な分析・数値比較・施策・実行計画を求められているため、根拠を示して従来どおり十分に詳しく回答する。',
  '- 見出しや箇条書きで構造化してよい。',
];

export function buildAnswerStyleBlock(style: AnswerStyle): string {
  if (style === 'detailed') return [TITLES.detailed, ...DETAILED_RULES].join('\n');
  return [TITLES[style], ...CONVERSATION_BASE, ...CONVERSATION_EXTRA[style]].join('\n');
}
