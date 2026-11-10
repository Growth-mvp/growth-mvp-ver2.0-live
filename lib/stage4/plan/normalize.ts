/* モデル出力の既知の余分な項目だけを、スキーマ検証の前に取り除く。
 * 対象は次の2か所の verifyBy（文字列のときだけ）に限る：
 *   - section1.problemCause
 *   - section2.actions[i].mechanism（行動の因果。検証方法は obstacles に書く）
 * 他の余分な項目と不足項目は、そのまま検証エラーにする。
 * 取り除いた値は、正規化の記録として返す（診断・ログ用）。 */

export type Normalization = {
  path: string;
  key: string;
  removed: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeKnownDrift(json: unknown): { json: unknown; applied: Normalization[] } {
  if (!isObject(json)) return { json, applied: [] };
  const applied: Normalization[] = [];
  let out: Record<string, unknown> = json;

  const section1 = out.section1;
  if (isObject(section1) && isObject(section1.problemCause) && typeof section1.problemCause.verifyBy === 'string') {
    const { verifyBy, ...problemCause } = section1.problemCause;
    applied.push({ path: 'section1.problemCause', key: 'verifyBy', removed: String(verifyBy) });
    out = { ...out, section1: { ...section1, problemCause } };
  }

  const section2 = out.section2;
  if (isObject(section2) && Array.isArray(section2.actions)) {
    let changed = false;
    const actions = section2.actions.map((action: unknown, i: number) => {
      if (!isObject(action) || !isObject(action.mechanism) || typeof action.mechanism.verifyBy !== 'string') return action;
      const { verifyBy, ...mechanism } = action.mechanism;
      applied.push({ path: `section2.actions[${i}].mechanism`, key: 'verifyBy', removed: String(verifyBy) });
      changed = true;
      return { ...action, mechanism };
    });
    if (changed) out = { ...out, section2: { ...section2, actions } };
  }

  return { json: out, applied };
}
