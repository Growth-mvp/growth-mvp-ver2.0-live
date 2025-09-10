// /lib/intentRouter.ts
export type Stage = 'strategy' | 'manual' | 'generic' | 'hybrid';
export type IntentResult = { stage: Stage; confidence: number; reasons: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const MANUAL_HINTS = [
  'どこに','どこで','どうやって','手順','ボタン','保存','画面','入力',
  '使い方','操作','エラー','表示されない','ナビ','遷移','クリック','開く',
  '/cascade','/story','/okr'
];

export const STRATEGY_HINTS = [
  'MVV','SWOT','ストーリー','部門戦略','OKR','Objective','KR','優先順位',
  '経営','戦略','施策','ロードマップ','組織','部長','意思決定','KPI'
];

/** まずは超軽量なヒューリスティック分類（速い・外してもOK） */
export function classifyHeuristic(q: string): IntentResult {
  const text = (q || '').toLowerCase();
  const m = MANUAL_HINTS.filter(k => text.includes(k.toLowerCase())).length;
  const s = STRATEGY_HINTS.filter(k => text.includes(k.toLowerCase())).length;

  if (m === 0 && s === 0) return { stage: 'generic', confidence: 0.4, reasons: ['no-keywords'] };
  if (m >= 2 && s === 0) return { stage: 'manual', confidence: 0.9, reasons: ['manual-keywords'] };
  if (s >= 2 && m === 0) return { stage: 'strategy', confidence: 0.9, reasons: ['strategy-keywords'] };

  if (m > 0 && s > 0) return { stage: 'hybrid', confidence: 0.55, reasons: ['mixed-keywords'] };
  return (m > s)
    ? { stage: 'manual', confidence: 0.6, reasons: ['manual-weak'] }
    : { stage: 'strategy', confidence: 0.6, reasons: ['strategy-weak'] };
}

/** 低信頼時だけ軽量LLMで補強（JSON返却） */
export async function classifyLLM(openai: any, q: string): Promise<IntentResult> {
  const sys = `あなたは問い合わせの意図を「strategy|manual|generic」から1つ選ぶ分類器です。
- strategy: 経営/戦略/OKR/部門設計など内容の相談
- manual: GROWTHアプリの使い方や画面操作、保存/ボタン/どこに入力 等
- generic: 一般知識や雑談
JSONで {"stage":"...", "confidence":0-1, "reasons":[".."]} を返すこと。`;
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: q.slice(0, 2000) }
    ]
  });
  try {
    const j = JSON.parse(r.choices[0]?.message?.content || '{}');
    const stage = (j.stage as Stage) || 'generic';
    const confidence = Math.max(0, Math.min(1, Number(j.confidence ?? 0.5)));
    const reasons = Array.isArray(j.reasons) ? j.reasons : [];
    return { stage, confidence, reasons };
  } catch {
    return { stage: 'generic', confidence: 0.4, reasons: ['parse-failed'] };
  }
}

/** 2つの判定をマージ（hybrid/高信頼側を優先） */
export function chooseBetter(a: IntentResult, b: IntentResult): IntentResult {
  if (b.stage === 'hybrid') return b;
  if (a.stage === 'hybrid') return a;
  return (b.confidence > a.confidence) ? b : a;
}

/** 表示用の重み（合成回答の強さ制御に使う想定） */
export function toWeights(intent: IntentResult) {
  switch (intent.stage) {
    case 'manual':   return { strategy: 0.15, manual: 0.75, generic: 0.10 };
    case 'strategy': return { strategy: 0.75, manual: 0.15, generic: 0.10 };
    case 'hybrid':   return { strategy: 0.50, manual: 0.40, generic: 0.10 };
    default:         return { strategy: 0.20, manual: 0.20, generic: 0.60 };
  }
}

/** シンプルなマッチヘルパ（manual項目のQ&A命中判定などに） */
export function includesAny(text: string, words: string[]) {
  const t = text || '';
  return words.some(w => new RegExp(escape(w), 'i').test(t));
}
