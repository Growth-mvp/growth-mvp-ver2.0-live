// 全社・事業別の財務表の項目（画面の表示順と保存キー）。画面の入力表とAI入力の解釈で同じものを使う
export const PL_FIELDS = [
  { key: 'revenue' as const, label: '売上高', required: true },
  { key: 'grossProfit' as const, label: '売上総利益', required: false },
  { key: 'cogs' as const, label: '売上原価', required: false },
  { key: 'sga' as const, label: '販管費', required: false },
  { key: 'operatingIncome' as const, label: '営業利益', required: true },
  { key: 'depreciation' as const, label: '減価償却費', required: false },
  { key: 'interest' as const, label: '支払利息', required: false },
  { key: 'tax' as const, label: '法人税等', required: false },
  { key: 'netIncome' as const, label: '当期純利益', required: false },
] as const;

export const BS_FIELDS = [
  { key: 'cash' as const, label: '現預金', required: false },
  { key: 'ar' as const, label: '売掛金', required: true },
  { key: 'inventory' as const, label: '棚卸資産', required: true },
  { key: 'ap' as const, label: '買掛金', required: true },
  { key: 'fixedAssets' as const, label: '固定資産', required: true },
  { key: 'totalAssets' as const, label: '総資産', required: false },
  { key: 'interestBearingDebt' as const, label: '有利子負債', required: true },
  { key: 'equity' as const, label: '純資産（株主資本）', required: true },
] as const;

export type PLFieldKey = (typeof PL_FIELDS)[number]['key'];
export type BSFieldKey = (typeof BS_FIELDS)[number]['key'];
