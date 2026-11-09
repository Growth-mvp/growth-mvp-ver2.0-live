/* PlanGateway の検証用実装（PGlite＝ローカルのPostgreSQL）。
 * 1回の操作を1つのトランザクションとし、利用者のJWTクレーム（auth.uid()の元）を設定して、authenticated の役割で実行する。
 * 行単位の権限（RLS）とトリガーは、データベース側の規則がそのまま効く。 */
import type { GatewayFailure, GatewayResult, IdentityRpcResult, PlanGateway } from '@/lib/stage4/plan/planService';
import type { PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';

export type Tx = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
};
export type Db = { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

export function failureOf(err: unknown): GatewayFailure {
  const code = typeof err === 'object' && err !== null ? String((err as { code?: unknown }).code ?? '') : '';
  if (code === '23505') return 'DUPLICATE';
  if (code === '42501') return 'FORBIDDEN';
  if (code === '40001') return 'CONFLICT';
  return 'ERROR';
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function toRecord(row: Record<string, unknown>): PlanDocRecord {
  return {
    key: { companyId: String(row.company_id), strategyId: String(row.strategy_id), projectId: String(row.project_id) },
    version: Number(row.version),
    aiDraft: row.ai_draft as Record<string, unknown>,
    userEdits: (row.user_edits ?? {}) as PlanDocRecord['userEdits'],
    adopted: row.adopted === true,
    updatedAt: iso(row.updated_at),
    updatedBy: String(row.updated_by),
  };
}

export class PgliteGateway implements PlanGateway {
  constructor(private readonly db: Db, private readonly userId: string) {}

  private async asUser<T>(fn: (tx: Tx) => Promise<T>): Promise<GatewayResult<T>> {
    try {
      const value = await this.db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [this.userId]);
        await tx.exec('set local role authenticated');
        return fn(tx);
      });
      return { ok: true, value };
    } catch (e) {
      return { ok: false, code: failureOf(e), message: e instanceof Error ? e.message : undefined };
    }
  }

  async membershipRole(userId: string, companyId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<{ role: string }>(
        'select role from company_members where company_id = $1 and user_id = $2',
        [companyId, userId]
      );
      return rows[0]?.role ?? null;
    });
  }

  async findPlan(key: { companyId: string; strategyId: string; projectId: string }) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query(
        'select * from stage4_plan_documents where company_id = $1 and strategy_id = $2 and project_id = $3',
        [key.companyId, key.strategyId, key.projectId]
      );
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async insertPlan(key: { companyId: string; strategyId: string; projectId: string }, input: { aiDraft: Record<string, unknown>; userEdits: Record<string, unknown>; adopted: boolean }, userId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query(
        `insert into stage4_plan_documents
           (company_id, strategy_id, project_id, ai_draft, user_edits, adopted, created_by, updated_by)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $7)
         returning *`,
        [key.companyId, key.strategyId, key.projectId, JSON.stringify(input.aiDraft), JSON.stringify(input.userEdits), input.adopted, userId]
      );
      return toRecord(rows[0]);
    });
  }

  async updatePlan(key: { companyId: string; strategyId: string; projectId: string }, expectedVersion: number, input: { userEdits: Record<string, unknown>; adopted: boolean }, userId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query(
        `update stage4_plan_documents
            set version = $5, user_edits = $6::jsonb, adopted = $7, updated_by = $8
          where company_id = $1 and strategy_id = $2 and project_id = $3 and version = $4
          returning *`,
        [key.companyId, key.strategyId, key.projectId, expectedVersion, expectedVersion + 1, JSON.stringify(input.userEdits), input.adopted, userId]
      );
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async readStrategy(companyId: string, strategyId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<{ departments: unknown; revision: number }>(
        'select departments, revision from strategy_data where id = $1 and company_id = $2',
        [strategyId, companyId]
      );
      return rows[0] ? { revision: Number(rows[0].revision), departments: rows[0].departments } : null;
    });
  }

  async assignIdentity(args: {
    companyId: string;
    strategyId: string;
    departmentIndex: number;
    projectIndex: number;
    expectedTitle: string;
    expectedRevision: number;
    newId: string;
  }): Promise<GatewayResult<IdentityRpcResult>> {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<{ result: IdentityRpcResult }>(
        'select public.stage4_assign_project_identity($1, $2, $3, $4, $5, $6, $7) as result',
        [args.companyId, args.strategyId, args.departmentIndex, args.projectIndex, args.expectedTitle, args.expectedRevision, args.newId]
      );
      return rows[0].result;
    });
  }
}
