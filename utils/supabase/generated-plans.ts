import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PlanAudience, PlanScope } from '@/lib/plans/planDocumentState';

/**
 * generated_plans の読み書き（サーバー専用・service_role）
 *
 * 書き込みは API からのみ行う。会社・戦略の一致は呼び出し側で検証済みであること。
 * DB 側のトリガーも戦略の所属を再検査する（最後の防衛線）。
 */

export type SaveInput = {
  companyId: string;
  strategyId: string;
  audience: PlanAudience;
  userId: string;
  generatedText: string;
  sections: string[];
  generatedAt: string;
};

export type SaveResult =
  | { status: 'saved'; version: number; updatedAt: string }
  | { status: 'unsaved'; reason: 'conflict' | 'error' };

export type SavedPlan = {
  generatedText: string;
  sections: string[];
  generatedAt: string;
  version: number;
  updatedAt: string;
};

const PG_UNIQUE_VIOLATION = '23505';
const PG_INSUFFICIENT_PRIVILEGE = '42501';
const MAX_SAVE_ATTEMPTS = 2;

class VersionConflictError extends Error {
  constructor() {
    super('generated_plans version conflict');
  }
}

async function writeOnce(admin: SupabaseClient, input: SaveInput): Promise<{ version: number; updatedAt: string }> {
  const { data: existing, error: readError } = await admin
    .from('generated_plans')
    .select('id, version')
    .eq('company_id', input.companyId)
    .eq('strategy_id', input.strategyId)
    .eq('audience', input.audience)
    .maybeSingle();
  if (readError) throw readError;

  if (!existing) {
    const { data, error } = await admin
      .from('generated_plans')
      .insert({
        company_id: input.companyId,
        strategy_id: input.strategyId,
        audience: input.audience,
        generated_text: input.generatedText,
        sections: input.sections,
        generated_at: input.generatedAt,
        created_by: input.userId,
        updated_by: input.userId,
      })
      .select('version, updated_at')
      .single();
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) throw new VersionConflictError();
      throw error;
    }
    return { version: data.version, updatedAt: data.updated_at };
  }

  const { data, error } = await admin
    .from('generated_plans')
    .update({
      generated_text: input.generatedText,
      sections: input.sections,
      generated_at: input.generatedAt,
      updated_by: input.userId,
    })
    .eq('id', existing.id)
    .eq('version', existing.version)
    .select('version, updated_at');
  if (error) throw error;
  if (!data || data.length === 0) throw new VersionConflictError();
  return { version: data[0].version, updatedAt: data[0].updated_at };
}

/**
 * 保存する。一時的な失敗は 1 回だけ再試行する。
 * 競合（409 相当）と権限・整合性の拒否（42501）は再試行しない。
 * 失敗しても例外は投げず、呼び出し側が本文を返せるようにする。
 */
export async function savePlanWithRetry(admin: SupabaseClient, input: SaveInput): Promise<SaveResult> {
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    try {
      const written = await writeOnce(admin, input);
      return { status: 'saved', version: written.version, updatedAt: written.updatedAt };
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return { status: 'unsaved', reason: 'conflict' };
      }
      if ((err as { code?: string } | null)?.code === PG_INSUFFICIENT_PRIVILEGE) {
        return { status: 'unsaved', reason: 'error' };
      }
    }
  }
  return { status: 'unsaved', reason: 'error' };
}

export async function assertStrategyInCompany(
  admin: SupabaseClient,
  companyId: string,
  strategyId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('strategy_data')
    .select('id')
    .eq('id', strategyId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function findSavedPlan(admin: SupabaseClient, scope: PlanScope): Promise<SavedPlan | null> {
  const { data, error } = await admin
    .from('generated_plans')
    .select('generated_text, sections, generated_at, version, updated_at')
    .eq('company_id', scope.companyId)
    .eq('strategy_id', scope.strategyId)
    .eq('audience', scope.audience)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    generatedText: data.generated_text,
    sections: Array.isArray(data.sections) ? data.sections : [],
    generatedAt: data.generated_at,
    version: data.version,
    updatedAt: data.updated_at,
  };
}
