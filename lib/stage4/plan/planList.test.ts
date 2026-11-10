import { listPlans } from './planService';
import type { PlanDocRecord } from './planDocumentStore';

const ok = <T,>(value: T) => ({ ok: true as const, value });
const rec = (projectId: string, status: PlanDocRecord['status']): PlanDocRecord =>
  ({
    key: { companyId: 'c', strategyId: 's', projectId },
    version: 1,
    aiDraft: {},
    userEdits: {},
    adopted: false,
    updatedAt: '2026-11-10T00:00:00.000Z',
    updatedBy: 'u',
    status,
    adoption: null,
    startInfo: null,
  }) as PlanDocRecord;

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    userId: 'u-1',
    gateway: {
      membershipRole: async () => ok<string | null>('member'),
      listPlans: async () => ok([rec('p-a', 'DRAFT'), rec('p-b', 'GENERATING'), rec('p-c', 'GENERATION_FAILED')]),
      ...over,
    },
  }) as unknown as Parameters<typeof listPlans>[0];

describe('計画書の一覧（STAGE6の参考シナリオ用）', () => {
  it('草案の状態のものだけ返す（生成中・失敗は返さない）', async () => {
    const out = await listPlans(ctx(), 'c', 's');
    expect(out.status).toBe('FOUND');
    if (out.status === 'FOUND') expect(out.records.map((r) => r.key.projectId)).toEqual(['p-a']);
  });

  it('会社の所属がなければ DENIED（読まない）', async () => {
    const out = await listPlans(ctx({ membershipRole: async () => ok(null) }), 'c', 's');
    expect(out.status).toBe('DENIED');
  });

  it('一覧を読めない実装なら FAILED', async () => {
    const out = await listPlans(ctx({ listPlans: undefined }), 'c', 's');
    expect(out.status).toBe('FAILED');
  });
});
