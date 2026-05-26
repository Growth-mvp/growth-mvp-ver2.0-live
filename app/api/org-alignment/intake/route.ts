// /app/api/org-alignment/intake/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const ROUTE_TAG = 'app/api/org-alignment/intake';

/* ========== types ========== */
type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

type IntakeDraft = {
  situation_text?: string;
  my_recognition_text?: string;
  ideal_text?: string;
  expectation_text?: string;
  counterparty_type?: CounterpartyType;
  counterparty_detail?: string;
};

type IntakeInputIntent =
  | 'actual_concern'
  | 'needs_input_help'
  | 'too_vague'
  | 'too_short'
  | 'emotional_venting'
  | 'personal_attack'
  | 'sensitive_or_harassment'
  | 'irrelevant'
  | 'unknown';

type IntakeResponse = {
  assistantMessage: string;
  status: 'asking' | 'ready_for_review';
  draft: IntakeDraft;
  conversationRound: number;
  /** デバッグ・検証用。フロント側で使わなくても問題ありません。 */
  inputIntent?: IntakeInputIntent;
};

/* ========== helpers ========== */
function json(res: any, status = 200, routeTag: string = ROUTE_TAG) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-GROWTH-Route': routeTag,
    },
  });
}

function cleanApiKey(raw?: string | null): string {
  const v = (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n|\r/g, '')
    .trim();
  return v;
}

function extractMessage(e: any): string {
  return (
    e?.message ??
    e?.response?.data?.error?.message ??
    e?.response?.data ??
    e?.error?.message ??
    String(e)
  );
}


/* ========== input intent guard ========== */

const NEEDS_INPUT_HELP_TERMS = [
  '何を書けばいい',
  'なにを書けばいい',
  'どう書けばいい',
  '何を入力',
  'なにを入力',
  '入力例',
  '例を見せて',
  '例を教えて',
  '書き方',
  'わからない',
  '分からない',
  '思いつかない',
  'うまく言えない',
  '整理できない',
];

const TOO_VAGUE_TERMS = [
  'なんとなく',
  '何となく',
  'もやもや',
  'モヤモヤ',
  '違和感がある',
  'よくわからないけど',
  'よく分からないけど',
  '引っかかる',
  'しっくりこない',
];

const EMOTIONAL_VENTING_TERMS = [
  '最悪',
  '腹が立つ',
  'ムカつく',
  'むかつく',
  'イライラ',
  '嫌い',
  'もう無理',
  '納得できない',
  'ありえない',
];

const PERSONAL_ATTACK_TERMS = [
  '無能',
  '使えない',
  '馬鹿',
  'バカ',
  'アホ',
  '最低',
  'クズ',
  '消えろ',
];

const SENSITIVE_TERMS = [
  'パワハラ',
  'セクハラ',
  'ハラスメント',
  'いじめ',
  '嫌がらせ',
  '無視される',
  '退職したい',
  '辞めたい',
  '会社に行きたくない',
  'つらい',
  '辛い',
  '死にたい',
  '消えたい',
];

const IRRELEVANT_TERMS = [
  '天気',
  '今日のニュース',
  '雑談',
  'こんにちは',
  'ありがとう',
  'テスト',
];

function normalizeText(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function containsAnyInput(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function isOnlyGreetingOrTest(text: string): boolean {
  const t = normalizeText(text);
  return ['こんにちは', 'こんばんは', 'おはよう', 'ありがとう', 'テスト', 'test', 'あ', 'a'].includes(t);
}

function detectInputIntent(userMessage: string): IntakeInputIntent {
  const text = normalizeText(userMessage);

  if (!text) return 'too_short';
  if (isOnlyGreetingOrTest(text)) return 'irrelevant';

  // 明確な安全・ハラスメント系は、通常の整理に流す前に慎重対応する
  if (containsAnyInput(text, SENSITIVE_TERMS)) return 'sensitive_or_harassment';

  // 「何を書けばいいかわからない」は、もやもや本文ではなく入力支援要求として扱う
  if (containsAnyInput(text, NEEDS_INPUT_HELP_TERMS)) {
    // ただし「何が問題かわからないが、上司の指示に違和感がある」のように、
    // 具体対象が含まれる場合は通常相談に流す
    const hasConcreteObject = containsAnyInput(text, [
      '上司',
      '経営',
      '会社',
      '評価',
      '目標',
      '業務',
      '部門',
      '現場',
      '方針',
      '指示',
      '会議',
      '顧客',
      'システム',
      '制度',
    ]);
    if (!hasConcreteObject) return 'needs_input_help';
  }

  if (text.length <= 4) return 'too_short';

  if (containsAnyInput(text, PERSONAL_ATTACK_TERMS)) return 'personal_attack';

  // 感情吐露だけに近い場合は、まず具体的な場面へ戻す
  if (containsAnyInput(text, EMOTIONAL_VENTING_TERMS)) {
    const hasConcreteAction = containsAnyInput(text, [
      '指示',
      '判断',
      '対応',
      '評価',
      '報告',
      '協力',
      '会議',
      '承認',
      '業務',
      '目標',
      '方針',
      '言われ',
      '求め',
    ]);
    if (!hasConcreteAction) return 'emotional_venting';
  }

  // 「なんとなくモヤモヤ」だけの場合は、いきなり整理カード化しない
  if (containsAnyInput(text, TOO_VAGUE_TERMS) && text.length < 18) return 'too_vague';

  // 明らかにルーム目的外の入力
  if (containsAnyInput(text, IRRELEVANT_TERMS) && text.length < 20) return 'irrelevant';

  return 'actual_concern';
}

function buildIntentSupportMessage(intent: IntakeInputIntent): string {
  switch (intent) {
    case 'needs_input_help':
      return `大丈夫です。まだ整理できていなくても問題ありません。

まずは、次のうち一番近いものを選ぶつもりで、1〜2行だけ書いてみてください。

・誰かの対応に違和感がある
・会社の方針や指示に納得できない
・評価や目標に違和感がある
・業務の進め方が非効率だと感じる
・職場の雰囲気やモチベーションに違和感がある
・何となく会社が変わらない気がする

たとえば、「最近、〇〇について少し違和感があります」くらいからで大丈夫です。`;

    case 'too_short':
      return `ありがとうございます。もう少しだけ教えてください。

その違和感は、主に次のどれに近いですか？

・人や部門の対応
・会社の方針や指示
・評価や目標
・業務の進め方
・職場の雰囲気
・人材育成やスキル
・仕組みやツール`;

    case 'too_vague':
      return `まだはっきり言葉になっていなくても大丈夫です。

そのモヤモヤは、主に「誰かの対応」「会社の方針」「評価や目標」「業務の進め方」「職場の雰囲気」のどれに近いですか？`;

    case 'emotional_venting':
      return `かなり強い違和感や不満があるのですね。

個人や部署を責める形ではなく、すり合わせ可能な論点にするために確認させてください。
どのような判断・指示・対応に、特に違和感を感じましたか？`;

    case 'personal_attack':
      return `個人の評価ではなく、認識のズレとして整理するために、具体的な行動や場面に置き換えて考えてみましょう。

どのような場面で、期待していた対応と実際の対応が違うと感じましたか？`;

    case 'sensitive_or_harassment':
      return `つらい状況、または慎重に扱うべき状況の可能性がありますね。

このルームでは「認識のズレ」として整理できますが、ハラスメントや安全に関わる可能性がある場合は、社内の相談窓口、人事、信頼できる管理者などにも相談してください。

差し支えない範囲で、どのような言動や場面が特につらいと感じたのか教えてください。`;

    case 'irrelevant':
      return `このルームでは、人と組織の問題を「認識のズレ」として整理します。

最近の仕事や職場で、違和感・もやもや・納得できないことがあれば、そのまま1〜2行で書いてください。`;

    default:
      return `もう少しだけ確認させてください。今回の違和感は、主に「誰かの対応」「会社の方針」「評価や目標」「業務の進め方」「職場の雰囲気」のどれに近いですか？`;
  }
}


// 抽象語リストの定義
const ABSTRACT_TERMS = ['挑戦', '施策', '取り組み', '新しいこと', '対応', '改善', '改革', '提案', '実行', 'プロジェクト', '変革', '新しい'];

// 抽象語が含まれているかチェック
function hasAbstractTerms(text: string): boolean {
  if (!text) return false;
  return ABSTRACT_TERMS.some((term) => text.includes(term));
}

// 抽象語の具体化が必要かどうかを判定
function needsAbstractClarification(draft: IntakeDraft): boolean {
  const allText = [draft.situation_text, draft.my_recognition_text].join(' ');

  if (!hasAbstractTerms(allText)) return false;

  // 抽象語があるが、その具体化が不足している場合
  // 例：「挑戦」という言葉があるが、それが何を指すか明確でない
  const isAbstractRemaining = hasAbstractTerms(allText) &&
    allText.split('。').some((sentence) => {
      // 抽象語を含むセンテンスが、十分に具体的でない
      const containsAbstract = ABSTRACT_TERMS.some(t => sentence.includes(t));
      const minContentLength = 20; // 最小文字数
      return containsAbstract && sentence.trim().length < minContentLength;
    });

  return isAbstractRemaining;
}

// 既存の整理カード項目にマッピング可能かどうかを判定
function assessCompleteness(
  currentDraft: IntakeDraft,
  isFirstInput: boolean = false
): {
  isComplete: boolean;
  hasAbstractTerms: boolean;
  hasRiskConcerns: boolean;
  nextQuestionPriority: 'abstract' | 'counterparty' | 'risk' | 'ideal' | 'expectation' | null;
} {
  // 各フィールドの充実度をチェック
  const hasSituation = !!(currentDraft.situation_text && currentDraft.situation_text.trim().length > 0);
  const hasRecognition = !!(currentDraft.my_recognition_text && currentDraft.my_recognition_text.trim().length > 0);
  const hasIdeal = !!(currentDraft.ideal_text && currentDraft.ideal_text.trim().length > 0);
  const hasExpectation = !!(currentDraft.expectation_text && currentDraft.expectation_text.trim().length > 0);
  const hasCounterparty = !!(currentDraft.counterparty_type && currentDraft.counterparty_type !== 'unknown');

  // 抽象語と不安の検出
  const allText = [
    currentDraft.situation_text,
    currentDraft.my_recognition_text,
    currentDraft.ideal_text,
    currentDraft.expectation_text,
  ].join(' ');

  const hasAbstractWords = hasAbstractTerms(allText);
  const riskTerms = ['評価が下がる', '責任を問われる', '失敗できない', '責任を問われたくない', '失敗'];
  const hasRiskConcerns = riskTerms.some((term) => allText.includes(term));

  // 優先度の決定
  let nextQuestionPriority: 'abstract' | 'counterparty' | 'risk' | 'ideal' | 'expectation' | null = null;

  if (needsAbstractClarification(currentDraft)) {
    nextQuestionPriority = 'abstract';
  } else if (!hasCounterparty) {
    nextQuestionPriority = 'counterparty';
  } else if (hasRiskConcerns && !needsAbstractClarification(currentDraft)) {
    nextQuestionPriority = 'risk';
  } else if (!hasIdeal) {
    nextQuestionPriority = 'ideal';
  } else if (!hasExpectation) {
    nextQuestionPriority = 'expectation';
  }

  // 初回入力の場合は、全フィールドが揃っており、抽象語が具体化されている場合のみ complete と判定
  const isComplete = isFirstInput
    ? hasSituation && hasRecognition && hasIdeal && hasExpectation && hasCounterparty && !needsAbstractClarification(currentDraft)
    : nextQuestionPriority === null;

  return {
    isComplete,
    hasAbstractTerms: hasAbstractWords,
    hasRiskConcerns,
    nextQuestionPriority,
  };
}

// AIで追加質問を生成（1問だけ）
async function generateFollowUpQuestion(
  openai: OpenAI,
  conversationHistory: Array<{ role: string; content: string }>,
  currentDraft: IntakeDraft,
  conversationRound: number,
  isFirstInput: boolean = false
): Promise<{
  question: string;
  draft: IntakeDraft;
}> {
  const assessment = assessCompleteness(currentDraft, isFirstInput);

  // 最大質問回数に達した場合は ready_for_review へ
  if (conversationRound >= 2) {
    const finalizedDraft = {
      ...currentDraft,
      situation_text: currentDraft.situation_text || '（未入力）',
      my_recognition_text: currentDraft.my_recognition_text || '（未入力）',
      ideal_text: currentDraft.ideal_text || '（未入力）',
      expectation_text: currentDraft.expectation_text || '（未入力）',
      counterparty_type: currentDraft.counterparty_type || 'unknown',
    };

    return {
      question: '',
      draft: finalizedDraft,
    };
  }

  // 完全な場合は ready_for_review へ
  if (assessment.isComplete) {
    const finalizedDraft = {
      ...currentDraft,
      situation_text: currentDraft.situation_text || '（未入力）',
      my_recognition_text: currentDraft.my_recognition_text || '（未入力）',
      ideal_text: currentDraft.ideal_text || '（未入力）',
      expectation_text: currentDraft.expectation_text || '（未入力）',
      counterparty_type: currentDraft.counterparty_type || 'unknown',
    };

    return {
      question: '',
      draft: finalizedDraft,
    };
  }

  // 優先度に基づいて1問だけを生成
  let questionPrompt = '';

  switch (assessment.nextQuestionPriority) {
    case 'abstract': {
      // 抽象語の具体化を確認
      const abstractTerm = ABSTRACT_TERMS.find(term =>
        (currentDraft.situation_text?.includes(term) || currentDraft.my_recognition_text?.includes(term))
      ) || '挑戦';

      questionPrompt = `その「${abstractTerm}」とは、具体的にはどのような施策・提案・行動のことですか？`;
      break;
    }

    case 'counterparty': {
      // 相手・関係者の特定
      questionPrompt = 'その違和感は、主に誰・どの部門との関係で感じたものですか？';
      break;
    }

    case 'risk': {
      // 評価・責任・不安の具体化
      questionPrompt = '失敗した場合、どのような評価低下や責任追及が起きると感じましたか？';
      break;
    }

    case 'ideal': {
      // 本来あるべき姿
      questionPrompt = '本来は、会社や上司にどのように判断・対応してほしいと感じましたか？';
      break;
    }

    case 'expectation': {
      // 相手に期待していたこと
      questionPrompt = '相手には、具体的にどのような支援や対応を期待していましたか？';
      break;
    }

    default: {
      questionPrompt = 'その場面で、具体的には何が起きていたのでしょうか？';
    }
  }

  // シンプルなシステムプロンプト - 優先度決定は既にサーバー側で実施済み
  const systemPrompt = `ユーザーの違和感を整理する対話の中で、以下の指定された質問を返してください。
質問は自然な日本語で、一度に1つの問いだけにしてください。
複数の問いを組み合わせてはいけません。
回答は質問テキストのみを返してください。`;

  const messages = [
    ...conversationHistory,
    {
      role: 'user',
      content: `以下のユーザー入力に対して、以下の質問を返してください。

ユーザー入力：
${currentDraft.situation_text || ''}
${currentDraft.my_recognition_text ? `\n${currentDraft.my_recognition_text}` : ''}

返すべき質問：
${questionPrompt}

この質問を、自然な会話体で返してください。質問文のみを返してください。`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages as any,
    temperature: 0.5,
    max_tokens: 150,
  });

  const questionText = completion.choices[0]?.message?.content || questionPrompt;

  return {
    question: questionText,
    draft: currentDraft,
  };
}

// ユーザー入力から draft に情報を抽出
async function extractDraftFromInput(
  openai: OpenAI,
  userInput: string,
  currentDraft: IntakeDraft
): Promise<IntakeDraft> {
  const systemPrompt = `ユーザーの入力から、以下の情報を抽出してください。
JSON形式で返してください。既に抽出済みの情報（draft内）については、更新または保持します。

抽出対象：
- situation_text：具体的な場面・背景・状況
- my_recognition_text：ユーザーがその状況をどう受け止めているか
- ideal_text：ユーザーが理想と考えている状態・本来あるべき姿
- expectation_text：相手方や会社に対する期待・確認したいこと
- counterparty_type：相手方の属性（'executive'|'manager'|'own_department'|'other_department'|'backoffice'|'field_member'|'customer'|'unknown'|'other'）
- counterparty_detail：その他の場合の詳細説明

抽出がない場合は、フィールドを省略してください。`;

  const userPrompt = `ユーザー入力：
${userInput}

現在の draft（既に抽出済みの情報）：
${JSON.stringify(currentDraft, null, 2)}

上記の入力から新たに抽出できる情報を反映してください。JSON のみを返してください。`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const responseText = completion.choices[0]?.message?.content || '{}';

  try {
    const extracted = JSON.parse(responseText);
    return {
      ...currentDraft,
      ...(extracted.situation_text && { situation_text: extracted.situation_text }),
      ...(extracted.my_recognition_text && { my_recognition_text: extracted.my_recognition_text }),
      ...(extracted.ideal_text && { ideal_text: extracted.ideal_text }),
      ...(extracted.expectation_text && { expectation_text: extracted.expectation_text }),
      ...(extracted.counterparty_type && { counterparty_type: extracted.counterparty_type }),
      ...(extracted.counterparty_detail && { counterparty_detail: extracted.counterparty_detail }),
    };
  } catch {
    return currentDraft;
  }
}

/* ========== POST ========== */
export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

  try {
    // 認証確認
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    // Body検証
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const {
      userMessage,
      conversationHistory = [],
      currentDraft = {},
      conversationRound = 0,
    } = payload;

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return json({ error: 'userMessage is required' }, 400);
    }

    // OpenAI APIキー取得
    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ error: 'OPENAI_API_KEY が未設定です。' }, 500);

    const safeHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((m: any) => m && typeof m.content === 'string')
          .map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          }))
      : [];

    const safeCurrentDraft: IntakeDraft =
      currentDraft && typeof currentDraft === 'object' ? currentDraft : {};

    const followUpCount = Number.isFinite(Number(conversationRound))
      ? Number(conversationRound)
      : 0;

    // STEP0: 入力意図判定
    // 「何を書けばいいかわからない」「疲れた」「上司が嫌い」などを、
    // いきなり通常のもやもやとして整理カード化しないためのガード。
    const inputIntent = detectInputIntent(userMessage.trim());

    if (inputIntent !== 'actual_concern') {
      const response: IntakeResponse = {
        assistantMessage: buildIntentSupportMessage(inputIntent),
        status: 'asking',
        draft: safeCurrentDraft,
        // 入力支援・短文・感情吐露などは、追加質問回数に含めない
        conversationRound: followUpCount,
        inputIntent,
      };

      return json(response);
    }

    const openai = new OpenAI({ apiKey });

    // ユーザー入力から draft に情報を抽出
    const updatedDraft = await extractDraftFromInput(openai, userMessage.trim(), safeCurrentDraft);

    // 初回入力かどうかを判定
    const isFirstInput = followUpCount === 0;

    // 追加質問を生成
    const newHistory = [
      ...safeHistory,
      { role: 'user', content: userMessage.trim() },
    ];

    // conversationRound は「AIが追加質問を返した回数」として扱う。
    // ここで +1 して渡すと、初回入力だけで最大回数に達しやすくなるため、
    // generateFollowUpQuestion には現在の followUpCount を渡す。
    const { question } = await generateFollowUpQuestion(
      openai,
      newHistory,
      updatedDraft,
      followUpCount,
      isFirstInput
    );

    let assistantMessage = '';
    let status: 'asking' | 'ready_for_review' = 'asking';
    let finalDraft = updatedDraft;
    let nextConversationRound = followUpCount;

    if (question) {
      // 追加質問がある
      status = 'asking';
      assistantMessage = question;
      nextConversationRound = followUpCount + 1;
    } else {
      // 質問が空 = 情報が十分に揃った、または最大質問回数に達した
      status = 'ready_for_review';
      assistantMessage = '情報をありがとうございます。整理カードで内容をご確認いただき、必要に応じて編集してください。';
      finalDraft = {
        ...updatedDraft,
        situation_text: updatedDraft.situation_text || '（必要に応じて追記してください）',
        my_recognition_text: updatedDraft.my_recognition_text || '（必要に応じて追記してください）',
        ideal_text: updatedDraft.ideal_text || '（必要に応じて追記してください）',
        expectation_text: updatedDraft.expectation_text || '（必要に応じて追記してください）',
        counterparty_type: updatedDraft.counterparty_type || 'unknown',
      };
    }

    const response: IntakeResponse = {
      assistantMessage,
      status,
      draft: finalDraft,
      conversationRound: nextConversationRound,
      inputIntent,
    };

    return json(response);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const msg = extractMessage(err);
    const status = err?.status || 500;
    return json({ error: msg }, status);
  }
}
