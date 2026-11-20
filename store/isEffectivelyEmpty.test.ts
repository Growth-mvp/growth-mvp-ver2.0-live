jest.mock('@/utils/supabase/client', () => ({
  supabase: { from: () => ({}), auth: { getUser: async () => ({ data: { user: null }, error: null }) }, rpc: async () => ({ data: null, error: null }) },
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
}));

import { isEffectivelyEmpty } from './strategyStore';

const EMPTY = { story: [], finalStory: [], answers2: [], departments: [], csvFinanceData: {}, financeSummary: [], stage1Issues: [], companyName: '', mission: '', vision: '', value: '', thought: '' };

describe('保存する内容が空かどうかの判定（承認の保存を省略しないため）', () => {
  it('何も入っていなければ空とみなし、保存しない', () => {
    expect(isEffectivelyEmpty(EMPTY)).toBe(true);
  });

  it('会社名が無くても、所在地だけを承認した内容は空とみなさず、保存する', () => {
    expect(isEffectivelyEmpty({ ...EMPTY, location: '東京都千代田区1-1-1' })).toBe(false);
  });

  it('会社名が無くても、従業員数・事業内容・業種・証券コードのいずれかがあれば保存する', () => {
    expect(isEffectivelyEmpty({ ...EMPTY, employees: '120' })).toBe(false);
    expect(isEffectivelyEmpty({ ...EMPTY, businessContent: '合成の事業内容' })).toBe(false);
    expect(isEffectivelyEmpty({ ...EMPTY, industry: 'manufacturing' })).toBe(false);
    expect(isEffectivelyEmpty({ ...EMPTY, ticker: '5905' })).toBe(false);
  });

  it('空白だけの値は内容とみなさない', () => {
    expect(isEffectivelyEmpty({ ...EMPTY, location: '   ', employees: '' })).toBe(true);
  });
});
