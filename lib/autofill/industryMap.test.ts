import { SELECTABLE_INDUSTRY_VALUES } from '@/utils/industryTemplates';
import { EDINET_INDUSTRY_TO_STAGE1, mapEdinetIndustry } from './industryMap';

describe('EDINETの提出者業種 → STAGE1の業種区分', () => {
  it('対応先は、すべて選べる業種区分（16）のいずれか', () => {
    for (const v of Object.values(EDINET_INDUSTRY_TO_STAGE1)) {
      expect(SELECTABLE_INDUSTRY_VALUES).toContain(v);
    }
  });

  it('東証33業種の代表的な名称を対応させる（日本製罐：金属製品→製造業、丹青社：サービス業→その他サービス業）', () => {
    expect(mapEdinetIndustry('金属製品')).toEqual({ status: 'MAPPED', value: 'manufacturing', edinetName: '金属製品' });
    expect(mapEdinetIndustry('サービス業')).toMatchObject({ status: 'MAPPED', value: 'service' });
    expect(mapEdinetIndustry('情報・通信業')).toMatchObject({ status: 'MAPPED', value: 'it' });
    expect(mapEdinetIndustry('銀行業')).toMatchObject({ status: 'MAPPED', value: 'finance' });
  });

  it('対応表に無い・空の業種は、未対応として返す（推測で埋めない）', () => {
    expect(mapEdinetIndustry('未知の業種')).toEqual({ status: 'UNMAPPED', edinetName: '未知の業種' });
    expect(mapEdinetIndustry(null)).toEqual({ status: 'UNMAPPED', edinetName: null });
    expect(mapEdinetIndustry('  ')).toEqual({ status: 'UNMAPPED', edinetName: null });
  });
});
