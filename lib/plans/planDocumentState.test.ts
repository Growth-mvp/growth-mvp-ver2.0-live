import {
  canGeneratePlan,
  isUnsaved,
  markdownFileName,
  scopeKey,
  toPlanDocument,
  visibleDocument,
  type GenerateResponseBody,
  type PlanScope,
} from './planDocumentState';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STRATEGY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const scopeA: PlanScope = { companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' };

function savedBody(overrides: Partial<GenerateResponseBody> = {}): GenerateResponseBody {
  return {
    generatedText: '本文',
    sections: ['本文'],
    generatedAt: '2026-10-19T10:00:00.000Z',
    status: 'saved',
    version: 2,
    saveReason: null,
    ...overrides,
  };
}

describe('scopeKey', () => {
  it('differs for company, strategy and audience', () => {
    const keys = new Set([
      scopeKey(scopeA),
      scopeKey({ ...scopeA, companyId: COMPANY_B }),
      scopeKey({ ...scopeA, strategyId: STRATEGY_B }),
      scopeKey({ ...scopeA, audience: 'shareholder' }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe('visibleDocument (company / strategy switching)', () => {
  it('hides a document once the company or strategy changes', () => {
    const doc = toPlanDocument(scopeA, savedBody());
    const afterCompanySwitch = scopeKey({ ...scopeA, companyId: COMPANY_B });
    const afterStrategySwitch = scopeKey({ ...scopeA, strategyId: STRATEGY_B });

    expect(visibleDocument(doc, scopeKey(scopeA))).toBe(doc);
    expect(visibleDocument(doc, afterCompanySwitch)).toBeNull();
    expect(visibleDocument(doc, afterStrategySwitch)).toBeNull();
  });

  it('hides a document of another audience', () => {
    const doc = toPlanDocument(scopeA, savedBody());
    expect(visibleDocument(doc, scopeKey({ ...scopeA, audience: 'employee' }))).toBeNull();
  });
});

describe('canGeneratePlan', () => {
  it('allows admin and manager only', () => {
    expect(canGeneratePlan('admin')).toBe(true);
    expect(canGeneratePlan('manager')).toBe(true);
    expect(canGeneratePlan('member')).toBe(false);
    expect(canGeneratePlan(null)).toBe(false);
    expect(canGeneratePlan(undefined)).toBe(false);
  });
});

describe('toPlanDocument', () => {
  it('maps a saved response', () => {
    const doc = toPlanDocument(scopeA, savedBody());
    expect(doc).toEqual({
      scopeKey: scopeKey(scopeA),
      saveStatus: 'saved',
      saveReason: null,
      generatedText: '本文',
      sections: ['本文'],
      generatedAt: '2026-10-19T10:00:00.000Z',
      version: 2,
    });
    expect(isUnsaved(doc)).toBe(false);
  });

  it('maps an unsaved response with the reason and no version', () => {
    const doc = toPlanDocument(
      scopeA,
      savedBody({ status: 'unsaved', version: null, saveReason: 'conflict' })
    );
    expect(doc.saveStatus).toBe('unsaved');
    expect(doc.saveReason).toBe('conflict');
    expect(doc.version).toBeNull();
    expect(isUnsaved(doc)).toBe(true);
    expect(doc.generatedText).toBe('本文');
  });
});

describe('markdownFileName', () => {
  it('uses audience and the generation date', () => {
    expect(markdownFileName('bank', '2026-10-19T10:00:00.000Z')).toBe('bank-plan-20261019.md');
  });

  it('falls back when the date is invalid', () => {
    expect(markdownFileName('employee', 'not-a-date')).toBe('employee-plan-undated.md');
  });
});
