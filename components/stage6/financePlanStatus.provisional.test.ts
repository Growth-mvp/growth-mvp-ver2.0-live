import type { CfAssumptions } from '@/utils/stage6/cashflow';
import { PROVISIONAL_ITEM_KEY, provisionalFundingReasonsOf, withProvisionalItem, type UnconfirmedItem } from './financePlanStatus';

const BASE: CfAssumptions = {
  minCashYen: 150_000_000,
  taxRate: 0.3,
  depreciationYen: 10_000_000,
  arRatio: 0.15,
  inventoryRatio: 0.05,
  apRatio: 0.08,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};

describe('売上増加時の資金判定は、前提が不足している間は暫定にする', () => {
  it('売上増加がなければ、暫定にしない', () => {
    expect(provisionalFundingReasonsOf({ revenueChanged: false, assumptions: { ...BASE, arRatio: null, taxRate: null } })).toEqual([]);
  });

  it('売上増加があり、運転資金の比率と税率を利用者が入力していれば、暫定にしない', () => {
    expect(provisionalFundingReasonsOf({ revenueChanged: true, assumptions: BASE })).toEqual([]);
  });

  it('売上増加があり運転資金の比率が未入力なら、その理由を示す', () => {
    const reasons = provisionalFundingReasonsOf({ revenueChanged: true, assumptions: { ...BASE, arRatio: null, taxRate: 0.3 } });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('売掛・棚卸・買掛の比率');
  });

  it('売上増加があり税率も未入力なら、税率の理由も加える', () => {
    const reasons = provisionalFundingReasonsOf({ revenueChanged: true, assumptions: { ...BASE, inventoryRatio: null, taxRate: null } });
    expect(reasons).toHaveLength(2);
    expect(reasons[1]).toContain('税率は直近実績からの推計');
  });

  it('暫定のときは、判定を妨げる未確認事項の先頭に前提の入力を出す（経営目標では補完しない）', () => {
    const rest: UnconfirmedItem[] = [{ key: 'cf-mincash', label: '最低現預金が未入力', tab: 'cashflow', required: true }];
    const items = withProvisionalItem(rest, ['売上増加に伴う運転資金は推計']);
    expect(items[0]).toMatchObject({ key: PROVISIONAL_ITEM_KEY, tab: 'cashflow', required: true });
    expect(items.slice(1)).toEqual(rest);
  });

  it('暫定でなければ、未確認事項の一覧は変えない', () => {
    const rest: UnconfirmedItem[] = [{ key: 'debt-existing', label: '既存借入の明細が未入力', tab: 'debt', required: true }];
    expect(withProvisionalItem(rest, [])).toBe(rest);
  });
});
