/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(async () => 'user-1'),
  requireMembership: jest.fn(async () => ({ role: 'ADMIN', company_id: 'company-1' })),
  assertMinRole: jest.fn(async () => undefined),
}));

/** どのクエリを投げても空の結果を返すモック（ルートが読む補助データは不要） */
function chainable(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get: (_t, prop) =>
      prop === 'then' ? (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }) : chainable(),
    apply: () => chainable(),
  });
}
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => chainable() }));

const mockCreate = jest.fn();
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } } },
}));

let POST: (req: NextRequest) => Promise<Response>;
beforeAll(() => {
  process.env.OPENAI_API_KEY = 'test-key';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  POST = require('./route').POST;
});

const completion = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} });

/** 人事部の施策（モデルが返す想定の形）。KPIは間接部門の成果分類（支援先部門の成果）で作る */
const badSlot2Once: string[] = [];

function hrSlotProject(slot: number, payload: any) {
  const basis = payload.strategyReferences?.[0]?.id ?? 'S1';
  const lane = slot <= 2 ? 'existing' : slot === 3 ? 'new' : slot === 4 ? 'intraCollab' : 'interCollab';
  const levers: Record<number, string> = { 1: 'FUTURE', 2: 'EFFICIENCY', 3: 'FUTURE', 4: 'COST', 5: 'FUTURE' };
  const invalidOnce = slot === 2 && badSlot2Once.length > 0 ? badSlot2Once.shift() : undefined;
  return {
    slot,
    title: `人材施策${slot}`,
    reason: '全社戦略の実現に必要な人材を育てるため',
    hypothesis: `もし支援の仕組みを整えれば、営業部の提案準備が早くなる（施策${slot}）`,
    objective: '事業部門の提案力を高める',
    strategyBasisIds: [basis],
    mainLever: invalidOnce ?? levers[slot],
    horizon: 'mid',
    kind: slot === 3 ? 'future' : 'growth',
    collaboration: lane === 'existing' || lane === 'new' ? '' : '事業部門と役割を分ける',
    partnerDepartment: slot === 5 ? (payload.allowedPartners?.[0] ?? '') : '',
    skillRequirements: { roleSkills: ['人材育成'], executionSkills: ['研修設計'] },
    humanInvestments: [
      { category: 'TRAINING_OJT', title: '研修', detail: '手順を教える' },
      { category: 'TOOLS_PROCESS', title: '仕組み', detail: '支援の手順を標準化する' },
    ],
    causalDesign: {
      buyer: '事業部門の責任者', problem: '提案準備に時間がかかる', intervention: '支援の手順を整える',
      customerChange: '提案準備の時間が減る', revenueMechanism: '提案件数が増え、全社の業績に寄与する', differentiation: '人材の育成手順',
    },
    keyResults: [
      { label: '全社の業績への寄与（件数）', unit: '件', kind: slot === 3 ? 'validation' : 'business_outcome', measurementScope: 'own_business', population: '全社の対象案件', calculation: '件数の合計', dataSource: '案件記録', comparison: '前年同期', measurementMethod: '件数を月次で集計する', hypothesisLink: '全社の業績への寄与を測る' },
      { label: '営業部の提案準備時間（時間）', unit: '時間', kind: slot === 3 ? 'validation' : 'customer_outcome', measurementScope: 'internal_process', population: '支援を受ける営業部の対象業務', calculation: '準備時間の平均', dataSource: '業務記録', comparison: '支援前後', measurementMethod: '準備時間を月次で平均する', hypothesisLink: '支援の効果を測る' },
      { label: '研修後の実施件数（件）', unit: '件', kind: 'leading', measurementScope: 'internal_process', population: '対象研修の参加者', calculation: '件数の合計', dataSource: '研修記録', comparison: '研修前', measurementMethod: '件数を月次で集計する', hypothesisLink: '実施の先行指標' },
    ],
    exploration: slot === 3 ? { payer: '事業部門', offering: '研修の仕組み', paymentTest: '試行', decisionRule: '継続率' } : undefined,
    crossBusinessStructure: slot === 5 ? { partnerBusiness: payload.allowedPartners?.[0] ?? '', ownResponsibility: '人材の支援', partnerResponsibility: '事業の実行', revenueAttribution: '自部門の寄与', responsibilityBoundary: '実行は事業部門', unclarifiedItems: [] } : undefined,
    collaborationStructure: slot === 4 ? { phases: [{ phase: '準備', owner: '人事', deliverable: '研修の設計', handoverTo: '営業' }, { phase: '実行', owner: '営業', deliverable: '実施', handoverTo: '人事' }], jointDecision: '月次で判断する' } : undefined,
  };
}

/** モデルの呼び出し内容に応じた応答（実OpenAIは呼ばない） */
function respond(params: any): any {
  const user = params.messages?.[1]?.content ?? '';
  let payload: any = null;
  try { payload = JSON.parse(user); } catch { payload = null; }
  const task = String(payload?.task ?? '');
  if (task.includes('担当スロット1件だけ生成する')) {
    return completion(JSON.stringify({ project: hrSlotProject(payload.responseTemplate.project.slot, payload) }));
  }
  if (task.includes('全社戦略本文から対象departmentの役割')) {
    const basis = payload.strategyReferences?.[0]?.id ?? 'S1';
    return completion(JSON.stringify({
      missionDraft: '人材を育て、全社戦略を事業部門で実行できる組織にする',
      missionDescription: '全社戦略を実行できる人材と仕組みを整える',
      currentPosition: '全社の支援機能として位置づく',
      strategicRole: '事業部門の実行力を高める',
      themes: payload.requiredSlots.map((spec: any) => ({
        ...spec, title: `人材施策${spec.slot}`, buyer: '事業部門の責任者', problem: '準備に時間がかかる',
        intervention: '支援の仕組みを整える', customerChange: '準備時間が減る', revenueMechanism: '全社の業績に寄与する',
        differentiation: '人材の育成手順', strategyBasisIds: [basis], partnerDepartment: spec.slot === 5 ? (payload.allowedPartners?.[0] ?? '') : undefined,
      })),
    }));
  }
  // 最初の全社生成：部門の名前と既存の計画だけを返す（部門ごとの詳細は後段の審査で作る）
  return completion(JSON.stringify({
    strategy: { summary: '全社戦略の要約' },
    departments: [{ name: '人事部', missionDraft: '人材を育てる', currentPosition: '全社の支援機能', strategicRole: '事業部門の実行力を高める', keyIssues: ['提案準備の時間'], alignmentRiskPoints: ['研修件数が目的化するおそれ'], lanes: { existing: { projects: [] }, new: { projects: [] } }, projects: [] }],
  }));
}

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockImplementation(async (params: any) => respond(params));
});

function slotCalls(): any[] {
  return mockCreate.mock.calls
    .map((c: any[]) => { try { return JSON.parse(c[0].messages[1].content); } catch { return null; } })
    .filter((p: any) => p && String(p.task ?? '').includes('担当スロット1件だけ生成する'));
}

function requestFor(): NextRequest {
  return new NextRequest('http://localhost/api/generate-cascade', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      industry: '製造業',
      strategySummary: '人事部の間接部門としての生成の検証',
      departments: [{ name: '人事部', answers: [] }],
      businessSegments: [{ id: 'seg-a', name: '営業部', pl: [] }],
      csvFinanceData: {},
    }),
  });
}

describe('人事部（間接部門）の生成を、ルートの経路で通す（AI呼び出しはモック）', () => {
  it('5スロットの成果分類が検証を通り、人事部の生成結果が返る（各スロットは1回だけ生成）', async () => {
    const res = await POST(requestFor());
    const body = await res.json();
    expect(res.status).toBe(200);
    const projects = body.departments[0].lanes
      ? Object.values(body.departments[0].lanes).flatMap((l: any) => l.projects ?? [])
      : body.departments[0].projects;
    expect(projects).toHaveLength(5);
    const calls = slotCalls();
    expect(calls).toHaveLength(5);
    expect(calls.map((p: any) => p.responseTemplate.project.slot)).toEqual([1, 2, 3, 4, 5]);
    for (const p of calls) {
      expect(p.departmentScope).toBe('indirect');
      expect(p.departmentGuidance).toContain('間接部門');
      expect(p.responseTemplate.project.mainLever).toBeNull();
      expect(p.responseTemplate.project.causalDesign.buyer).not.toContain('発注企業');
      const kpiScopes = p.responseTemplate.project.keyResults.map((k: any) => k.measurementScope);
      expect(kpiScopes).toContain('internal_process');
      expect(kpiScopes).not.toContain('client_business');
    }
  });

  it('不正な mainLever が返っても、そのスロットだけを1回修復し、修復指示に前回の値と許可値を示す', async () => {
    const invalid = '6コードのうち施策が効かせる1つ';
    badSlot2Once.push(invalid);
    const res = await POST(requestFor());
    expect(res.status).toBe(200);
    const calls = slotCalls();
    const bySlot = (n: number) => calls.filter((p: any) => p.responseTemplate.project.slot === n);
    expect(bySlot(2)).toHaveLength(2);
    for (const n of [1, 3, 4, 5]) expect(bySlot(n)).toHaveLength(1);
    const repair = bySlot(2)[1];
    expect(repair.mainLeverCorrection).toContain(invalid);
    expect(repair.mainLeverCorrection).toContain('ARPU');
    expect(repair.responseTemplate.project.mainLever).toBeNull();
    expect(repair.previousCandidate?.mainLever).toBe(invalid);
  });

  it('[診断] 修復しても不正値が続くと 422 になり、開発環境では試行ごとのAIの値と指摘を保存する（戦略書の本文は含めない）', async () => {
    const invalid = '6コードのうち施策が効かせる1つ';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-diag-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(dir);
    const env = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'development';
    try {
      badSlot2Once.push(invalid, invalid);
      const res = await POST(requestFor());
      expect(res.status).toBe(422);
      expect((await res.json()).issues).toEqual(['slot_2_lever']);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cascade-debug', 'latest-failure.json'), 'utf8'));
      expect(saved.deptName).toBe('人事部');
      const slot2 = saved.attempts.filter((a: any) => a.slot === 2);
      expect(slot2.map((a: any) => a.rawMainLever)).toEqual([invalid, invalid]);
      expect(slot2[0].errors).toEqual(['slot_2_lever']);
      const text = JSON.stringify(saved);
      expect(text).not.toContain('strategyActuallyUsed');
      expect(text).not.toContain('全社戦略の要約');
    } finally {
      cwd.mockRestore();
      (process.env as any).NODE_ENV = env;
    }
  });
});
