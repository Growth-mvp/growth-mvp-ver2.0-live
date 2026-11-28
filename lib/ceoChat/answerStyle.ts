export type AnswerStyle = 'detailed' | 'conversation' | 'conversation_followup' | 'repeat' | 'objection';

const DETAIL_REQUEST = /詳しく|詳細に|詳述|分析(して|してほしい|し|する)|計算(方法|すれば|して|し|する)|報告書|計画書|資料(に|として|で)|実行計画を(作|立|まとめ|書)/;
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
  '- 長さは相手の質問と相談の重さに合わせる。簡単な質問は100〜300字、通常の経営相談は300〜600字、重要な経営判断は500〜1,000字を目安にし、判断に必要な根拠と理由は省かない。文字数は厳格な制限ではない。段落数は決めない。見出しは使わない。番号付きの手順や太字の小見出しで組み立てない。',
  '- 簡単な質問（確認や一言で答えられる問い）には、結論を最初の一文に書き、短い会話文で答える。',
  '- STAGE1〜6などの段階の一覧は、質問に関係する場合だけ触れる。関係のない段階を列挙しない。',
  '- 相談者が担当業務や立場（一般社員・部門責任者など）を示した場合は、その人の仕事の場面と言葉で助言する。提案する業務の手順は、その人が自分の範囲で試せるかを踏まえる。',
  '- 相談者の部門や担当が質問から分からない場合は、部門や担当を推測して断定しない。',
  '- 「結論として」「重点は3つ」「まず90日間で」のような報告書調の展開をしない。説明調の解説文や箇条書きで並べず、相手の言葉を受けて会話として話す。複数段階の実行計画は書かない。',
  '- 一度の回答で分析・施策・実行計画をすべて説明しない。次の一歩は、相手が求めた場合か判断に必要な場合だけ1つ示す。',
  '- 経営者の考えを聞くと議論が深まる場合は、自然な問いを添える。毎回は問わない。',
  '- 事情（立場・時間・人手・上司との関係など）が分からず助言の前提が欠けるときは、答えの中で必要なことを自然な問いを1つだけ添える。',
  '- 具体的な方法や判断を求められた場合は、問い返しでかわさず、今の情報で言える答えを示す。',
  '- 「うちの会社を良くするには」のような幅広い相談では、課題や優先順位を最初から一方的に決めつけない。相手の問題意識を尋ねてもよい。',
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
  '- 詳細な分析や資料を求められているため、根拠を示して従来どおり十分に詳しく回答する。',
  '- 見出しや箇条書きで構造化してよい。ただし利用者と対話している場面では、冒頭で相手の問題意識を受け止め、共通の人柄を保つ。',
  '- 回答の最初の一文に結論を書く。画面の回答は詳しくてよいが、音声ではこの冒頭の文を要点として読み上げる。',
];

export type PersonaVariant = 'A' | 'B' | 'C';

export function buildAnswerStyleBlock(style: AnswerStyle, variant: PersonaVariant = 'A'): string {
  if (style === 'detailed') return [TITLES.detailed, ...DETAILED_RULES].join('\n');
  if (variant === 'C') return [TITLES[style], '- 相談内容に応じて、十分な根拠と説明を提供する。文字数や構成は指定しない。'].join('\n');
  return [TITLES[style], ...CONVERSATION_BASE, ...CONVERSATION_EXTRA[style]].join('\n');
}
