import { planFilingApply, type ApplicableCandidate, type CurrentFilingProfile } from './filingCandidates';
import { extractProfileFromPages } from '@/utils/stage1/importers/profileExtract';

const CURRENT: CurrentFilingProfile = {
  companyName: '株式会社サンプル',
  ticker: '',
  fiscalYearEnd: '',
  isListed: undefined,
  location: '',
  employees: '',
  businessContent: '',
  industry: '',
};

const src = { source: 'DOCUMENT' as const, fileName: 'sample.pdf', periodEnd: null, fetchedAt: '2026-11-26T00:00:00.000Z' };

function candidateWithFiscalEnd(month: string): ApplicableCandidate {
  return {
    filer: { name: '株式会社サンプル', secCode: null, edinetCode: null },
    fiscalYear: null,
    profile: { fields: { fiscalYearEnd: { value: month, source: src, fiscalYear: null, consolidation: 'NOT_APPLICABLE' } }, issues: [] },
    profileExtra: {},
    finance: [],
    segments: null,
    issues: [],
  };
}

function plan(current: Partial<CurrentFilingProfile>, overwriteProfile: CurrentFilingProfile[keyof CurrentFilingProfile][] = []) {
  return planFilingApply({
    current: { ...CURRENT, ...current },
    currentFinance: [],
    candidate: candidateWithFiscalEnd('3'),
    selectedProfile: ['fiscalYearEnd'],
    overwriteProfile: overwriteProfile as never,
    selectedYears: [],
    overwriteYears: [],
  });
}

describe('決算月の反映：登録済みの決算月は、上書きを選ばない限り変えない', () => {
  it('決算月が空なら、資料の月を入れる', () => {
    const p = plan({ fiscalYearEnd: '' });
    expect(p.profilePatch).toEqual({ fiscalYearEnd: '3' });
    expect(p.profileApplied).toEqual(['fiscalYearEnd']);
  });

  it('登録済みの決算月が違っても、上書きを選ぶまで変えない', () => {
    const p = plan({ fiscalYearEnd: '9' });
    expect(p.profilePatch).toEqual({});
    expect(p.profileSkipped).toEqual([{ key: 'fiscalYearEnd', reason: 'already_filled' }]);
  });

  it('上書きを選んだ時だけ、登録済みの決算月を資料の月にする', () => {
    const p = plan({ fiscalYearEnd: '9' }, ['fiscalYearEnd']);
    expect(p.profilePatch).toEqual({ fiscalYearEnd: '3' });
  });
});

describe('決算月の読み取り：明記された月だけを採る', () => {
  const page = (text: string) => [{ pageNumber: 1, text }];

  it('「決算期 3月末」「決算月：12月」の値から月を取る', () => {
    expect(extractProfileFromPages(page('決算期 3月末'), 'a.pdf').fiscalYearEnd?.value).toBe('3');
    expect(extractProfileFromPages(page('決算月：12月'), 'a.pdf').fiscalYearEnd?.value).toBe('12');
  });

  it('「3月末決算」の文言からも月を取る', () => {
    expect(extractProfileFromPages(page('当社は3月末決算です'), 'a.pdf').fiscalYearEnd?.value).toBe('3');
  });

  it('年月（2026年3月期）からは、決算月を推測しない', () => {
    expect(extractProfileFromPages(page('決算期 2026年3月期'), 'a.pdf').fiscalYearEnd).toBeUndefined();
  });
});
