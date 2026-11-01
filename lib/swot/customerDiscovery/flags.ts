/** 新方式（顧客課題の発見）の機能フラグ。既定は OFF。値は厳密に "true" のときだけ ON。 */
export function isCustomerDiscoveryV2Enabled(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * 旧方式フラグと新方式フラグの組み合わせ。
 * - 探索A（本文確認・発見経路の表示）は、旧方式フラグの値だけで決まる（新方式では変えない）
 * - 旧方式の顧客課題の経路（役割推定・検索計画・旧い顧客課題の呼び出し）は、新方式ONのとき止める
 * - 新方式は、旧方式フラグとは独立に、顧客課題の発見の呼び出しだけを行う
 */
export function resolveNeedRoute(args: { legacyOn: boolean; v2On: boolean }) {
  return {
    /** 探索Aの本文確認・発見経路の表示（旧フラグの値のまま） */
    marketFlagOn: args.legacyOn,
    /** 旧方式の顧客課題の経路（新方式ONのときは止める） */
    legacyNeedOn: args.legacyOn && !args.v2On,
    /** 新方式の顧客課題の発見 */
    discoveryOn: args.v2On,
  };
}
