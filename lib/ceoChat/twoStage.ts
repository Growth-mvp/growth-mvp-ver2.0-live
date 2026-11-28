/** 検証用：第1段階（経営分析）の回答を、第2段階（コミュニケーション）で自然な会話に書き換える。失敗・保持違反時は第1段階の回答を返す。 */

export const TWO_STAGE_SYSTEM = `あなたは、優秀な経営コンサルタントの見解を、相談者に自然に伝えるコミュニケーションの専門家です。
与えられた経営分析や判断を尊重し、経営者や社員と対等な立場で話す、親しみやすく誠実な経営コンサルタントの言葉に書き換えてください。
相手の発言に含まれる具体的な事情や問題意識を受け止め、必要に応じて共感・承認・同調を示してください。
経営コンサルタントとしての見解を持ち、上から教えるのではなく、一緒に考えている感覚を伝えてください。
専門的な内容を省略せず、十分な回答量を維持してください。
事実確認や単純な質問には自然に直接回答してください。

厳守事項：
- 数値、単位、年度、固有名詞を変更しない。
- 経営判断、結論、推奨事項を変更しない。
- 判断の条件や不確実性を失わない。
- 根拠や出典を削除しない。
- 第1段階にない経営分析や事実を追加しない。
- 専門性を低下させない。
- 回答を要約することを目的としない。
- 相手の意見に迎合しない。
- 実在の人間を装わない。
- 固定的な共感表現を繰り返さない。
書き換えた本文のみを出力してください。`;

const TWO_STAGE_HEAD = TWO_STAGE_SYSTEM.slice(0, 40);

export function isTwoStageRequest(system: unknown): boolean {
  return typeof system === 'string' && system.startsWith(TWO_STAGE_HEAD);
}

export function twoStageEnabled(): boolean {
  return process.env.CEO_TWO_STAGE === '1';
}

export function twoStageModel(): string {
  return process.env.CEO_TWO_STAGE_MODEL || 'gpt-4o-mini';
}

type Turn = { role: string; content?: unknown };

export function buildStage2Messages(args: { question: string; history: readonly Turn[]; draft: string }) {
  const recent = args.history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-2)
    .map((m) => `${m.role === 'user' ? '相談者' : 'AI'}：${String(m.content ?? '').slice(0, 300)}`);
  const user = [
    '【相談者の発言】',
    args.question,
    '',
    '【直前の会話（参考）】',
    recent.length ? recent.join('\n') : 'なし',
    '',
    '【経営分析の回答（第1段階）】',
    args.draft,
    '',
    '上の経営分析の回答を、相談者に自然に伝わる言葉に書き換えてください。',
  ].join('\n');
  return [
    { role: 'system', content: TWO_STAGE_SYSTEM },
    { role: 'user', content: user },
  ];
}

const normalizeNumerals = (s: string) => s.normalize('NFKC').replace(/ゼロ/g, '0').replace(/〇/g, '0');
const numberSet = (s: string) =>
  new Set((normalizeNumerals(s).match(/\d+(?:[.,]\d+)*/g) ?? []).map((t) => t.replace(/,/g, '')));
const namedSet = (s: string) => new Set(s.match(/STAGE\s?\d+|GROWTH SHIFT|MVV|PHASE\s?\d+/g) ?? []);
const urlSet = (s: string) => new Set(s.match(/https?:\/\/[^\s)）]+/g) ?? []);

/** 第2段階の書き換えで、数値・固有名詞・URL・判断の量が変質していないかを検査する（文字列の一致だけで意味は保証しない）。 */
export function checkStage2Integrity(draft: string, rewrite: string): { ok: boolean; reason: string | null } {
  const r = rewrite.trim();
  if (!r) return { ok: false, reason: 'empty' };
  if (r.length < draft.length * 0.5) return { ok: false, reason: 'too_short' };
  const dn = numberSet(draft);
  const rn = numberSet(r);
  if ([...dn].some((t) => !rn.has(t))) return { ok: false, reason: 'number_missing' };
  if ([...rn].some((t) => !dn.has(t))) return { ok: false, reason: 'number_added' };
  const dname = namedSet(draft);
  const rname = namedSet(r);
  if ([...dname].some((t) => !rname.has(t))) return { ok: false, reason: 'name_missing' };
  const du = urlSet(draft);
  const ru = urlSet(r);
  if ([...du].some((t) => !ru.has(t))) return { ok: false, reason: 'url_missing' };
  return { ok: true, reason: null };
}

type ChatClient = { chat: { completions: { create: (p: any) => Promise<any> } } };

export async function rewriteWithTwoStage(args: {
  client: ChatClient;
  question: string;
  history: readonly Turn[];
  draft: string;
}): Promise<{ content: string; outcome: 'rewritten' | 'fallback'; reason: string | null; model: string; latencyMs: number; usage: { prompt_tokens: number; completion_tokens: number } | null }> {
  const model = twoStageModel();
  const started = Date.now();
  const params: any = {
    model,
    max_completion_tokens: 3000,
    messages: buildStage2Messages(args),
  };
  if (model.startsWith('gpt-5')) params.reasoning_effort = 'low';
  try {
    const res = await args.client.chat.completions.create(params);
    const rewrite = String(res.choices?.[0]?.message?.content ?? '').trim();
    const usage = res.usage ?? null;
    const check = checkStage2Integrity(args.draft, rewrite);
    if (!check.ok) return { content: args.draft, outcome: 'fallback', reason: check.reason, model, latencyMs: Date.now() - started, usage };
    return { content: rewrite, outcome: 'rewritten', reason: null, model, latencyMs: Date.now() - started, usage };
  } catch {
    return { content: args.draft, outcome: 'fallback', reason: 'stage2_error', model, latencyMs: Date.now() - started, usage: null };
  }
}
