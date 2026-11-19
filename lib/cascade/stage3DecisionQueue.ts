export type DecisionEntry<S> = { key: string; apply: (s: S) => S; after?: () => void };

export function replayDecisions<S>(base: S, entries: readonly DecisionEntry<S>[]): S {
  return entries.reduce((s, e) => e.apply(s), base);
}

/* 送信に成功した判断だけを取り除く。送信中に追加された判断は残し、保存済みの状態の上に載せ直して次の保存の下書きにする */
export function settleSentDecisions<S>(
  pending: readonly DecisionEntry<S>[],
  sent: readonly DecisionEntry<S>[],
  saved: S,
): { done: DecisionEntry<S>[]; rest: DecisionEntry<S>[]; draft: S | null } {
  const sentSet = new Set(sent);
  const done = pending.filter((e) => sentSet.has(e));
  const rest = pending.filter((e) => !sentSet.has(e));
  return { done, rest, draft: rest.length > 0 ? replayDecisions(saved, rest) : null };
}
