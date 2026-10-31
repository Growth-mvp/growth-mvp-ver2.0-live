/** 顧客課題探索（Phase 2A）の機能フラグ。既定は OFF。値は厳密に "true" のときだけ ON。 */
export function isCustomerNeedDiscoveryEnabled(value: string | undefined): boolean {
  return value === 'true';
}
