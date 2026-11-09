/* ローカルDB（PGlite）での検証環境。本番のDB・本番の接続設定には触れない。
 * 土台（eval/db/standin.sql）→ 保留中のSQL（supabase/pending）→ 架空の企業・利用者・戦略 の順に準備する。
 * HTTPの入口は本番と同じ planApi を使い、認証だけを検証用の Bearer（test:<利用者ID>）に差し替える。
 * モデルの呼び出しは検証用のモック（実際のAIは呼ばない）。 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { createPlanApi } from '@/lib/stage4/plan/planApi';
import { createMockModel } from '@/lib/stage4/plan/mockGenerate';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';

import { PgliteGateway, type Db } from './pgliteGateway';

export const IDS = {
  companyA: '00000000-0000-4000-8000-00000000c0de',
  companyB: '00000000-0000-4000-8000-00000000b2b2',
  strategyA: '00000000-0000-4000-8000-0000000057a1',
  strategyB: '00000000-0000-4000-8000-0000000057b2',
  alice: '00000000-0000-4000-8000-00000000a11c',
  bob: '00000000-0000-4000-8000-00000000b0b0',
  manager: '00000000-0000-4000-8000-00000000d00d',
  carol: '00000000-0000-4000-8000-00000000ca01',
} as const;

const ROOT = process.cwd();
const PGLITE_HOME = process.env.PGLITE_HOME ?? 'C:/dev/growth-mvp-tools/pglite';

async function openDb(): Promise<{ db: Db; close: () => Promise<void>; raw: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; exec: (s: string) => Promise<unknown> } }> {
  const entry = path.join(PGLITE_HOME, 'node_modules/@electric-sql/pglite/dist/index.js');
  const mod = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as { PGlite: { create: () => Promise<unknown> } };
  const pg = (await mod.PGlite.create()) as Db & {
    query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    exec: (s: string) => Promise<unknown>;
    close: () => Promise<void>;
  };
  return { db: pg, close: () => pg.close(), raw: pg };
}

const DEPARTMENTS_A = (): unknown => JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0].departments));
const DEPARTMENTS_B = (): unknown => [{ name: '製造部', mission: '他社の製造工程を改善する', projects: [{ id: 'b-only-project', title: '他社だけの案件', okrsV2: [] }] }];
const SWOT_A = {
  strength: '工場向けの計測器で、高い精度と長い稼働実績を持つ',
  weakness: '医療機関の業務や購買の流れを知る社員が少ない',
  opportunity: '院内の記録を自動化したいという医療機関の需要が増えている',
  threat: '医療機器としての規制対応に、時間と費用がかかる',
};

/* 検証用：保存された戦略の行を、計画エンジンの入力の形にする（本番は buildStateFromDbRow を使う） */
export const mapStrategyRow = (row: Record<string, unknown>): RawPlanStrategy =>
  ({
    id: String(row.id),
    company_id: String(row.company_id),
    departments: row.departments,
    strength: row.strength ?? undefined,
    weakness: row.weakness ?? undefined,
    opportunity: row.opportunity ?? undefined,
    threat: row.threat ?? undefined,
  }) as unknown as RawPlanStrategy;

export type TestEnv = {
  db: Db;
  handle: (req: Request) => Promise<Response>;
  /** 直接の読み取り（検証の確認用。管理者の権限で行う） */
  strategyRow: (strategyId: string) => Promise<{ departments: unknown; revision: number }>;
  planRows: () => Promise<Record<string, unknown>[]>;
  eventRows: () => Promise<Record<string, unknown>[]>;
  /** 架空の戦略Aの内容を、指定の部門で置き換える（管理者の権限） */
  setStrategyA: (departments: unknown) => Promise<void>;
  /** 検証用：権限を使わずに SQL を実行する（DB側の確認に使う） */
  sql: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  /** 検証用：モデルの呼び出しを失敗させる（次の1回） */
  failNextModelCall: () => void;
  close: () => Promise<void>;
};

export async function createTestEnv(): Promise<TestEnv> {
  const { db, close, raw } = await openDb();
  await raw.exec(fs.readFileSync(path.join(ROOT, 'eval/db/standin.sql'), 'utf8'));
  await raw.exec(fs.readFileSync(path.join(ROOT, 'supabase/pending/20261110_stage4_plan_documents.sql'), 'utf8'));

  await raw.exec(`
    insert into companies (id, name) values ('${IDS.companyA}', '架空精密計測株式会社（評価用）'), ('${IDS.companyB}', '架空食品加工株式会社（評価用）');
    insert into company_members (company_id, user_id, role) values
      ('${IDS.companyA}', '${IDS.alice}', 'member'),
      ('${IDS.companyA}', '${IDS.bob}', 'member'),
      ('${IDS.companyA}', '${IDS.manager}', 'manager'),
      ('${IDS.companyB}', '${IDS.carol}', 'member');
  `);

  const put = async (strategyId: string, companyId: string, departments: unknown, swot: Record<string, string> | null) => {
    await raw.query(
      'insert into strategy_data (id, company_id, departments, strength, weakness, opportunity, threat) values ($1, $2, $3::jsonb, $4, $5, $6, $7)',
      [strategyId, companyId, JSON.stringify(departments), swot?.strength ?? null, swot?.weakness ?? null, swot?.opportunity ?? null, swot?.threat ?? null]
    );
  };
  await put(IDS.strategyA, IDS.companyA, DEPARTMENTS_A(), SWOT_A);
  await put(IDS.strategyB, IDS.companyB, DEPARTMENTS_B(), null);

  let modelFailures = 0;
  const api = createPlanApi({
    verifyUser: async (req) => {
      const m = /^Bearer test:([0-9a-f-]{36})$/i.exec(req.headers.get('authorization') ?? '');
      return m ? m[1] : null;
    },
    gatewayFor: (_req, userId) => new PgliteGateway(db, userId),
    generationEnabled: true,
    generation: {
      currentYm: () => '2026-11',
      mapStrategy: mapStrategyRow,
      modelFor: async (raw) => {
        const mock = createMockModel(raw);
        return async (prompt) => {
          if (modelFailures > 0) {
            modelFailures -= 1;
            throw new Error('検証用の失敗');
          }
          return mock(prompt);
        };
      },
    },
    companyNameOf: () => '架空精密計測株式会社（評価用）',
  });

  return {
    db,
    handle: async (req) => {
      const pathname = new URL(req.url).pathname;
      if (pathname.endsWith('/plan-documents/generate')) return api.generate(req);
      if (pathname.endsWith('/plan-documents/transition')) return api.transition(req);
      if (pathname.endsWith('/plan-documents')) return api.plans(req);
      if (pathname.endsWith('/project-identity')) return api.identity(req);
      return new Response('not found', { status: 404 });
    },
    strategyRow: async (strategyId) => {
      const { rows } = await raw.query('select departments, revision from strategy_data where id = $1', [strategyId]);
      return { departments: rows[0].departments, revision: Number(rows[0].revision) };
    },
    planRows: async () => (await raw.query('select * from stage4_plan_documents order by created_at, project_id')).rows,
    eventRows: async () => (await raw.query('select * from stage4_plan_document_events order by created_at, id')).rows,
    setStrategyA: async (departments) => {
      await raw.query('update strategy_data set departments = $2::jsonb where id = $1', [IDS.strategyA, JSON.stringify(departments)]);
    },
    sql: async (text, params) => (await raw.query(text, params)).rows,
    failNextModelCall: () => {
      modelFailures += 1;
    },
    close,
  };
}
