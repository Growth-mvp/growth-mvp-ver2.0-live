/** 通常の経営相談で、APIへ送る会話の末尾に付加する独立した開発者指示。保存する履歴・画面表示には含めない。 */
export const CONSULT_TONE_INSTRUCTION =
  '回答の専門性や情報量は維持しながら、親しみやすく、人間味のある言葉で、私と一緒に考えるように話してください。';

export function withConsultTone<T extends { role: string }>(
  messages: readonly T[]
): Array<T | { role: 'developer'; content: string }> {
  return [...messages, { role: 'developer', content: CONSULT_TONE_INSTRUCTION }];
}
