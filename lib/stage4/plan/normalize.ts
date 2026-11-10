/* モデル出力の既知の余分な項目だけを、スキーマ検証の前に取り除く。
 * 対象は section1.problemCause の verifyBy（文字列のときだけ）の1か所に限る。他の余分な項目と不足項目は、そのまま検証エラーにする。
 * 取り除いた値は、正規化の記録として返す（診断・ログ用）。 */

export type Normalization = {
  path: string;
  key: string;
  removed: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeKnownDrift(json: unknown): { json: unknown; applied: Normalization[] } {
  if (!isObject(json) || !isObject(json.section1) || !isObject(json.section1.problemCause)) {
    return { json, applied: [] };
  }
  const problemCause = json.section1.problemCause;
  const removed = problemCause.verifyBy;
  if (typeof removed !== 'string') return { json, applied: [] };

  const { verifyBy: _dropped, ...rest } = problemCause;
  void _dropped;
  const section1 = { ...json.section1, problemCause: rest };
  return {
    json: { ...json, section1 },
    applied: [{ path: 'section1.problemCause', key: 'verifyBy', removed }],
  };
}
