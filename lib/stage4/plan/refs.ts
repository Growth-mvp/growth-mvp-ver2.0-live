/* 参照IDの正規化。
 * 生成された sourceRefs のうち、角括弧で囲まれた ID（例：[S2-CORE]）が、入力の既知の正規IDと完全一致する場合に限り、
 * 角括弧を外す。それ以外（存在しないID、部分一致、別の情報源への読み替え）は一切変えず、検証でエラーにする。 */

const BRACKETED = /^\[([^\[\]]+)\]$/;

export type RefCanonicalization<T> = {
  value: T;
  normalized: number;
  samples: string[];
};

export function canonicalizeRefs<T>(draft: T, known: Set<string>): RefCanonicalization<T> {
  let normalized = 0;
  const samples: string[] = [];

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'sourceRefs' && Array.isArray(v)) {
          out[k] = v.map((r) => {
            if (typeof r !== 'string') return r;
            const m = r.match(BRACKETED);
            if (m && known.has(m[1])) {
              normalized += 1;
              if (samples.length < 3) samples.push(`${r} → ${m[1]}`);
              return m[1];
            }
            return r;
          });
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    }
    return node;
  };

  return { value: walk(draft) as T, normalized, samples };
}
