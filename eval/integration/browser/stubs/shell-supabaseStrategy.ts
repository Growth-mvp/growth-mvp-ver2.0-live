/* 実アプリのレイアウト確認用の保存・復元関数の代替（評価専用）。DBへは接続せず、空の結果を返す。 */
const empty = async () => ({ data: null, error: null });

export const getFullStrategyDataByCompany = empty;
export const getFullStrategyDataByStrategyId = empty;
export async function loadProgressLogs(..._args: unknown[]): Promise<unknown[]> {
  return [];
}
/* 保存処理が呼ばれたことを検証するための記録（DBへは書かない） */
const wm: any = typeof window !== 'undefined' ? window : globalThis;
wm.__dbWriteCalls = wm.__dbWriteCalls || [];

export async function saveProgressLog(..._args: unknown[]): Promise<{ ok: true; data: null }> {
  wm.__dbWriteCalls.push('saveProgressLog');
  return { ok: true, data: null };
}
export async function saveStrategyData(..._args: unknown[]): Promise<{ ok: true; skipped: true; reason: 'mock' }> {
  wm.__dbWriteCalls.push('saveStrategyData');
  return { ok: true, skipped: true, reason: 'mock' };
}
export const saveStrategyDataApi = saveStrategyData;
export function buildDbRowFromState(..._args: unknown[]): Record<string, unknown> {
  return {};
}
export function buildStateFromDbRow(..._args: unknown[]): Record<string, unknown> {
  return {};
}
export function buildFinanceCsvUnitMeta(..._args: unknown[]): Record<string, unknown> {
  return {};
}
export function unwrapCsvFinanceData<T>(value: T): T {
  return value;
}
export function okrsToKpis(..._args: unknown[]): unknown[] {
  return [];
}
export function okrsV2ToOkrs(..._args: unknown[]): unknown[] {
  return [];
}
