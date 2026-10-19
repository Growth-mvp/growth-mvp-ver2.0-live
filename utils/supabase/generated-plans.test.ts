import { createFakeDb, planRow } from '@/lib/plans/testing/fakeSupabase';

jest.mock('server-only', () => ({}));

import { assertStrategyInCompany, findSavedPlan, savePlanWithRetry, type SaveInput } from './generated-plans';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ADMIN = '99999999-9999-4999-8999-999999999999';

function baseInput(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    companyId: COMPANY_A,
    strategyId: STRATEGY_A,
    audience: 'bank',
    userId: USER_ADMIN,
    generatedText: '# 経営計画書\n本文',
    sections: ['# 経営計画書\n本文'],
    generatedAt: '2026-10-19T10:00:00.000Z',
    ...overrides,
  };
}

function seededDb() {
  return createFakeDb({
    strategy_data: [{ id: STRATEGY_A, company_id: COMPANY_A }],
  });
}

describe('savePlanWithRetry', () => {
  it('inserts a new plan and returns saved with version 1', async () => {
    const db = seededDb();
    const result = await savePlanWithRetry(db.client as any, baseInput());

    expect(result).toEqual(expect.objectContaining({ status: 'saved', version: 1 }));
    expect(db.rows.generated_plans).toHaveLength(1);
    expect(db.rows.generated_plans[0]).toEqual(
      expect.objectContaining({ company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank', created_by: USER_ADMIN })
    );
  });

  it('retries once after a transient insert failure and then saves', async () => {
    const db = seededDb();
    db.failures.push({ table: 'generated_plans', op: 'insert', times: 1, error: { message: 'network reset' } });

    const result = await savePlanWithRetry(db.client as any, baseInput());

    expect(result.status).toBe('saved');
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(2);
  });

  it('returns unsaved with the reason when both attempts fail, without throwing', async () => {
    const db = seededDb();
    db.failures.push({ table: 'generated_plans', op: 'insert', times: 5, error: { message: 'db down' } });

    const result = await savePlanWithRetry(db.client as any, baseInput());

    expect(result).toEqual({ status: 'unsaved', reason: 'error' });
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(2);
    expect(db.rows.generated_plans).toHaveLength(0);
  });

  it('does not retry on a unique conflict (23505) and reports conflict', async () => {
    const db = seededDb();
    db.beforeNextInsert = (rows) => {
      rows.push(planRow({ company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank' }));
    };

    const result = await savePlanWithRetry(db.client as any, baseInput());

    expect(result).toEqual({ status: 'unsaved', reason: 'conflict' });
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('does not retry when the database rejects the strategy/company pair (42501)', async () => {
    const db = seededDb();

    const result = await savePlanWithRetry(
      db.client as any,
      baseInput({ companyId: COMPANY_B })
    );

    expect(result).toEqual({ status: 'unsaved', reason: 'error' });
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
    expect(db.rows.generated_plans).toHaveLength(0);
  });

  it('updates the existing plan and increments version on regeneration', async () => {
    const db = seededDb();
    db.rows.generated_plans.push(
      planRow({
        company_id: COMPANY_A,
        strategy_id: STRATEGY_A,
        audience: 'bank',
        generated_text: '旧本文',
        version: 3,
      })
    );

    const result = await savePlanWithRetry(db.client as any, baseInput({ generatedText: '新しい本文' }));

    expect(result).toEqual(expect.objectContaining({ status: 'saved', version: 4 }));
    expect(db.rows.generated_plans).toHaveLength(1);
    expect(db.rows.generated_plans[0].generated_text).toBe('新しい本文');
  });

  it('reports conflict when another save bumps the version between read and write (concurrent save)', async () => {
    const db = seededDb();
    db.rows.generated_plans.push(
      planRow({ company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank', generated_text: '元', version: 1 })
    );
    db.beforeNextUpdate = (rows) => {
      rows[0].version += 1;
      rows[0].generated_text = '別の操作が先に保存';
    };

    const result = await savePlanWithRetry(db.client as any, baseInput({ generatedText: '後から来た保存' }));

    expect(result).toEqual({ status: 'unsaved', reason: 'conflict' });
    expect(db.rows.generated_plans[0].generated_text).toBe('別の操作が先に保存');
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(1);
  });
});

describe('assertStrategyInCompany', () => {
  it('is true only for the strategy owned by the company', async () => {
    const db = seededDb();
    expect(await assertStrategyInCompany(db.client as any, COMPANY_A, STRATEGY_A)).toBe(true);
    expect(await assertStrategyInCompany(db.client as any, COMPANY_B, STRATEGY_A)).toBe(false);
  });
});

describe('findSavedPlan', () => {
  it('returns only the plan of the exact company, strategy and audience', async () => {
    const db = seededDb();
    db.rows.generated_plans.push(
      planRow({ company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank', generated_text: '銀行' })
    );

    const bank = await findSavedPlan(db.client as any, { companyId: COMPANY_A, strategyId: STRATEGY_A, audience: 'bank' });
    const shareholder = await findSavedPlan(db.client as any, {
      companyId: COMPANY_A,
      strategyId: STRATEGY_A,
      audience: 'shareholder',
    });
    const otherCompany = await findSavedPlan(db.client as any, {
      companyId: COMPANY_B,
      strategyId: STRATEGY_A,
      audience: 'bank',
    });

    expect(bank?.generatedText).toBe('銀行');
    expect(shareholder).toBeNull();
    expect(otherCompany).toBeNull();
  });
});
