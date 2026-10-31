/** 候補の重複判定に使う文字列の比較（クライアント側でも使えるよう、サーバー専用の依存を持たない） */
export const normalizeForCompare = (s: string) => s.replace(/[\s、。,.・：:；;「」『』（）()\-―]/g, '').toLowerCase();

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 言い換えだけの重複を検出する（文字2-gram の Jaccard 類似度）。短文は差が小さく見えるため完全一致のみ */
export function isNearDuplicate(a: string, b: string, threshold = 0.6): boolean {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const gx = bigrams(x);
  const gy = bigrams(y);
  if (gx.size < 12 || gy.size < 12) return false;
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter++;
  const union = gx.size + gy.size - inter;
  return union > 0 && inter / union >= threshold;
}
