/* PlanGateway の検証用実装（PGlite＝ローカルのPostgreSQL）。
 * 1回の操作を1つのトランザクションとし、利用者のJWTクレーム（auth.uid()の元）を設定して、authenticated の役割で実行する。
 * 行単位の権限（RLS）とトリガーは、データベース側の規則がそのまま効く。 */
import type { ClaimResult, GatewayFailure, GatewayResult, IdentityRpcResult, PlanGateway, PlanPatch } from '@/lib/stage4/plan/planService';
import type { PlanDocEvent, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { JSONB_COLUMNS, patchColumns, rowToEvent, rowToRecord } from '@/lib/stage4/plan/planRecordMapping';

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

type Row = Record<string, unknown>;

export class PgliteGateway implements PlanGateway {
  constructor(private readonly db: Db, private readonly userId: string) {}

  /* 利用者の権限で1つの操作を実行する（失敗は結果として返し、例外は外に出さない） */
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

  async findPlan(key: PlanDocKey): Promise<GatewayResult<PlanDocRecord | null>> {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        'select * from stage4_plan_documents where company_id = $1 and strategy_id = $2 and project_id = $3',
        [key.companyId, key.strategyId, key.projectId]
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    });
  }

  async listEvents(key: PlanDocKey): Promise<GatewayResult<PlanDocEvent[]>> {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `select e.action, e.version, e.actor_user_id, e.created_at, e.payload
           from stage4_plan_document_events e
           join stage4_plan_documents d on d.id = e.document_id
          where d.company_id = $1 and d.strategy_id = $2 and d.project_id = $3
          order by e.created_at, e.id`,
        [key.companyId, key.strategyId, key.projectId]
      );
      return rows.map(rowToEvent);
    });
  }

  async claimGeneration(key: PlanDocKey, userId: string): Promise<GatewayResult<ClaimResult>> {
    const inserted = await this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `insert into stage4_plan_documents (company_id, strategy_id, project_id, status, created_by, updated_by)
         values ($1, $2, $3, 'GENERATING', $4, $4) returning *`,
        [key.companyId, key.strategyId, key.projectId, userId]
      );
      return rows[0];
    });
    if (inserted.ok) return { ok: true, value: { claimed: true, record: rowToRecord(inserted.value) } };
    if (inserted.code !== 'DUPLICATE') return { ok: false, code: inserted.code };

    const retried = await this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `update stage4_plan_documents set status = 'GENERATING', updated_by = $4
          where company_id = $1 and strategy_id = $2 and project_id = $3 and status = 'GENERATION_FAILED'
          returning *`,
        [key.companyId, key.strategyId, key.projectId, userId]
      );
      return rows[0] ?? null;
    });
    if (!retried.ok) return { ok: false, code: retried.code };
    if (retried.value) return { ok: true, value: { claimed: true, record: rowToRecord(retried.value) } };

    const existing = await this.findPlan(key);
    if (!existing.ok || !existing.value) return { ok: false, code: 'ERROR' };
    return { ok: true, value: { claimed: false, existing: existing.value } };
  }

  async completeGeneration(key: PlanDocKey, userId: string, aiDraft: Record<string, unknown>) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `update stage4_plan_documents set status = 'DRAFT', ai_draft = $5::jsonb, updated_by = $4
          where company_id = $1 and strategy_id = $2 and project_id = $3 and status = 'GENERATING'
          returning *`,
        [key.companyId, key.strategyId, key.projectId, userId, JSON.stringify(aiDraft)]
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    });
  }

  async failGeneration(key: PlanDocKey, userId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `update stage4_plan_documents set status = 'GENERATION_FAILED', updated_by = $4
          where company_id = $1 and strategy_id = $2 and project_id = $3 and status = 'GENERATING'
          returning *`,
        [key.companyId, key.strategyId, key.projectId, userId]
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    });
  }

  async updatePlan(key: PlanDocKey, expectedVersion: number, patch: PlanPatch, userId: string): Promise<GatewayResult<PlanDocRecord | null>> {
    const cols: Record<string, unknown> = { ...patchColumns(patch, userId), version: expectedVersion + 1 };
    const names = Object.keys(cols);
    const sets = names.map((c, i) => `${c} = $${i + 5}${JSONB_COLUMNS.has(c) ? '::jsonb' : ''}`).join(', ');
    const values = names.map((c) => (JSONB_COLUMNS.has(c) && cols[c] !== null ? JSON.stringify(cols[c]) : cols[c]));
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>(
        `update stage4_plan_documents set ${sets}
          where company_id = $1 and strategy_id = $2 and project_id = $3 and version = $4 and status = 'DRAFT'
          returning *`,
        [key.companyId, key.strategyId, key.projectId, expectedVersion, ...values]
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    });
  }

  async readStrategyRow(companyId: string, strategyId: string) {
    return this.asUser(async (tx) => {
      const { rows } = await tx.query<Row>('select * from strategy_data where id = $1 and company_id = $2', [strategyId, companyId]);
      return rows[0] ?? null;
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
