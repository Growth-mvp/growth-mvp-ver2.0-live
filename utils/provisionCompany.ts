// /utils/provisionCompany.ts
'use client';

import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

type ProvisionResp = {
  ok: boolean;
  companyId?: string | null;
  strategyId?: string | null;
  note?: string;
  via?: string;
  seedError?: { code?: string | null; message?: string } | null;
};

export async function provisionCompany(params?: { companyName?: string; departmentId?: string | null }) {
  const res = await fetch('/api/companies/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: params ? JSON.stringify(params) : undefined,
  });
  const json = (await res.json()) as ProvisionResp;

  // 会社IDは userStore へ
  if (json?.companyId) {
    useUserStore.setState({ companyId: json.companyId });
  }
  // ←ここが重要：strategyId を strategyStore へ反映
  if (json?.strategyId) {
    useStrategyStore.setState({ strategyId: json.strategyId });
  }

  return json;
}
