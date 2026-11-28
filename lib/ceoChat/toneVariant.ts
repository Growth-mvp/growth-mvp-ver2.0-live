/** 検証用：APIへ送る話し方の指示の付け方を比較する。保存する会話履歴・画面表示には影響させない。 */

export const TONE_INSTRUCTION =
  '回答の専門性や情報量は維持しながら、親しみやすく、人間味のある言葉で、私と一緒に考えるように話してください。';

export type ToneVariant = 'A' | 'B' | 'C';

export function toneVariantFromEnv(): ToneVariant {
  const v = process.env.CEO_TONE_VARIANT;
  return v === 'B' || v === 'C' ? v : 'A';
}

type ChatTurn = { role: string; content: any };

/** A：変更なし。B：最終ユーザーメッセージの末尾に指示を付加。C：末尾に独立した開発者指示を追加。 */
export function applyToneVariant<T extends ChatTurn>(messages: readonly T[], variant: ToneVariant): Array<T | ChatTurn> {
  if (variant === 'A') return [...messages];
  if (variant === 'C') return [...messages, { role: 'developer', content: TONE_INSTRUCTION } as ChatTurn];
  const idx = messages.map((m) => m.role).lastIndexOf('user');
  if (idx < 0) return [...messages];
  return messages.map((m, i) =>
    i === idx ? ({ ...m, content: `${String(m.content ?? '')}\n\n${TONE_INSTRUCTION}` } as T) : m
  );
}
