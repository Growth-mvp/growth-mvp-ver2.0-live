/* 利用者の修正（項目ID → 値）を、保存の時点の版（base）と、自分の修正（local）、保存済みの最新（remote）で突き合わせる。
 * 片方だけが変えた項目は、変えた方を採る。両方が違う値に変えた項目は、自動では選ばず競合として返す。 */
export type UserEdits = Record<string, unknown>;

const slot = (edits: UserEdits, key: string) =>
  Object.prototype.hasOwnProperty.call(edits, key) ? { present: true, value: edits[key] } : { present: false };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sameSlot = (a: ReturnType<typeof slot>, b: ReturnType<typeof slot>) =>
  a.present === b.present && (!a.present || same(a.value, (b as { value: unknown }).value));

function put(out: UserEdits, key: string, s: ReturnType<typeof slot>) {
  if (s.present) out[key] = (s as { value: unknown }).value;
}

export function mergeUserEdits(base: UserEdits, local: UserEdits, remote: UserEdits): { merged: UserEdits; conflicts: string[] } {
  const merged: UserEdits = {};
  const conflicts: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const b = slot(base, key);
    const l = slot(local, key);
    const r = slot(remote, key);
    if (sameSlot(l, r)) put(merged, key, l);
    else if (sameSlot(l, b)) put(merged, key, r);
    else if (sameSlot(r, b)) put(merged, key, l);
    else conflicts.push(key);
  }
  return { merged, conflicts };
}

/* 競合の項目を、利用者が選んだ側（local / remote）で確定した修正の全体を作る */
export function resolveUserEdits(args: {
  base: UserEdits;
  local: UserEdits;
  remote: UserEdits;
  picks: Record<string, 'local' | 'remote'>;
}): UserEdits {
  const { merged, conflicts } = mergeUserEdits(args.base, args.local, args.remote);
  const out: UserEdits = { ...merged };
  for (const key of conflicts) {
    const pick = args.picks[key];
    if (pick === undefined) continue;
    put(out, key, slot(pick === 'local' ? args.local : args.remote, key));
  }
  return out;
}
