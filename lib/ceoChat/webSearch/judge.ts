import type OpenAI from 'openai';
import { z } from 'zod';
import { AI_MODELS, MODEL_CONFIGURATIONS } from '@/lib/modelConfig';
import { COMPANY_REF } from './classify';

const judgementSchema = z.object({
  needsExternal: z.boolean(),
  scope: z.enum(['company', 'general']),
  publicQuery: z.string(),
});

export type SearchJudgement = z.infer<typeof judgementSchema>;

const JUDGE_INSTRUCTIONS = [
  'あなたは経営相談チャットの前処理です。利用者の質問に答えるために、インターネット上の最新の公開情報が必要かを判断してください。',
  '',
  '外部の最新情報が必要な例: 株価・指数・為替など時点で変わる数値、特定の企業の最新の業績や発表、最近の法令・制度・統計・市場動向、ニュース。',
  '外部情報が不要な例: 当社の戦略・計画・実績・KPI・組織など、利用者の会社の登録情報で答える質問。SWOT分析や経営用語の説明など、一般的な知識で答えられる質問。',
  '',
  '判断の結果を次のJSONで返してください。',
  '{"needsExternal": 真偽値, "scope": "company" または "general", "publicQuery": 文字列}',
  '- needsExternal: 外部の最新情報が必要なら true。',
  '- scope: 利用者の会社が属する業界・市場についての外部情報なら "company"。株価・為替・特定企業・経済全般など、それ以外は "general"。',
  '- publicQuery: needsExternal が true のとき、公開情報を検索するための短い語句（80字以内）。例「日経平均株価 本日 終値」。利用者の会社名・個人名・社内の数値・質問の原文は含めないでください。needsExternal が false のときは空文字。',
  'JSON以外は出力しないでください。',
].join('\n');

/** 質問の意味から外部情報の要否と検索の範囲を判定する。失敗時は null（呼び出し側はキーワード判定に戻る） */
export async function judgeSearchNeed(
  client: Pick<OpenAI, 'chat'>,
  question: string
): Promise<SearchJudgement | null> {
  try {
    const completion = await client.chat.completions.create({
      model: AI_MODELS.lightweight,
      max_completion_tokens: MODEL_CONFIGURATIONS.ceoChatSearchJudge.maxCompletionTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: JUDGE_INSTRUCTIONS },
        { role: 'user', content: question.slice(0, 1000) },
      ],
    });
    const parsed = judgementSchema.safeParse(JSON.parse(completion.choices[0]?.message?.content ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const normalizeName = (value: string) => value.replace(/株式会社|\(株\)|（株）|\s/g, '').toLowerCase();

/** 一般の検索語句として使えるかを確かめる。会社を特定できる語や、会社への言及を含むものは使わない */
export function sanitizePublicQuery(raw: string, companyName: string): string | null {
  const query = raw.replace(/\s+/g, ' ').trim();
  if (query.length === 0 || query.length > 80 || /https?:\/\//i.test(query)) return null;
  if (COMPANY_REF.test(query)) return null;
  const name = normalizeName(companyName);
  if (name.length >= 2 && normalizeName(query).includes(name)) return null;
  return query;
}
