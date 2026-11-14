/* STAGE6 の検証用：STAGE4 参考シナリオの通信を遮断する（評価専用）。読込はせず、表示は出さない。 */
export const remotePlanOps = () => ({
  list: async () => ({ status: 'DISABLED' as const }),
});
