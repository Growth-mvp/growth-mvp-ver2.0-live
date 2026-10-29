/* eslint-disable @typescript-eslint/no-explicit-any -- DB・OpenAI モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  ...jest.requireActual('@/lib/server/rbacGuard'),
  getAuthUserIdFromBearer: jest.fn(),
  requireMembership: jest.fn(),
  assertMinRole: jest.fn(),
}));
jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => undefined),
  extractAuditMetadata: jest.fn(() => ({})),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { openai } from '@/lib/openai';
import { getStage2QuestionById } from '@/lib/stage2/questions12';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY_ID = '33333333-3333-4333-8333-333333333333';

function setupAdmin() {
  const admin: any = {};
  admin.from = (table: string) => {
    if (table !== 'strategy_data') throw new Error(`unexpected table ${table}`);
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: { company_id: COMPANY }, error: null }),
    };
    return builder;
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
}

function req(body: unknown) {
  return new Request('http://localhost/api/stage2/generate-final', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ strategyDataId: STRATEGY_ID, ...(body as object) }),
  }) as any;
}

async function capturePrompt(answers12: unknown[]): Promise<string> {
  await POST(req({ answers12 }));
  const calls = (openai.chat.completions.create as jest.Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return JSON.stringify(calls[0][0].messages);
}

describe('POST /api/stage2/generate-final: 12問のプロンプト反映', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'manager' });
    setupAdmin();
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({
      choices: [{ message: { content: '{}' } }],
    });
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  it('質問文は保存済みの古い文面ではなく、現行IDの質問文でプロンプトに渡る', async () => {
    const prompt = await capturePrompt([
      { id: 'ch1-q1', question: '5年後、どんな商品やサービスが…', answer: '人手不足で作業が止まる' },
    ]);

    expect(prompt).toContain(getStage2QuestionById('ch1-q1')?.question);
    expect(prompt).not.toContain('5年後、どんな商品やサービスが');
    expect(prompt).toContain('人手不足で作業が止まる');
  });

  it('配列の並び順が変わっても、digest は質問IDに対応する意味で作られる', async () => {
    const prompt = await capturePrompt([
      { id: 'ch3-q2', answer: '来月から全社で週次の振り返りを始める' },
      { id: 'ch1-q1', answer: '小規模事業者の受発注がデジタル化を求められる' },
    ]);

    expect(prompt).toContain('futureCustomerIssues');
    expect(prompt).toContain('小規模事業者の受発注がデジタル化を求められる');
    expect(prompt).toContain('firstActions');
    expect(prompt).toContain('来月から全社で週次の振り返りを始める');
  });

  it('複数事業の長い記述は1500字を超えても後半まで渡る', async () => {
    const filler = 'あ'.repeat(2000);
    const longAnswer = `A事業：${filler}。B事業：後半事業の末尾マーカー。`;
    const prompt = await capturePrompt([{ id: 'ch1-q3', answer: longAnswer }]);

    expect(prompt).toContain('後半事業の末尾マーカー');
  });

  it('一部だけ回答された場合も生成処理に進む', async () => {
    const res = await POST(req({ answers12: [{ id: 'ch0-q1', answer: '危機' }] }));

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
    expect(openai.chat.completions.create).toHaveBeenCalled();
  });
});

describe('POST /api/stage2/generate-final: 人材配分・事業区分・STAGE2境界のプロンプト', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const sectionBody = (extra: string) =>
    `当社は高精度加工と品質保証を基盤に、医療機器メーカーの設計協業へ踏み込むための方針を示す。${extra}` +
    'これにより、経営判断の優先順位を明確にし、資源配分の基準を全社で共有する。'.repeat(12);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER);
    (requireMembership as jest.Mock).mockResolvedValue({ userId: USER, companyId: COMPANY, role: 'manager' });
    setupAdmin();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  it('システムプロンプトに、事業区分の維持・人/お金/時間の確認・戦略仮説の明示・STAGE3境界が含まれる', async () => {
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    await POST(req({ answers12: [{ id: 'ch1-q1', answer: 'A事業：既存市場は縮小' }] }));

    const messages = (openai.chat.completions.create as jest.Mock).mock.calls[0][0].messages;
    const system = messages.find((m: { role: string }) => m.role === 'system').content as string;

    expect(system).toContain('ユーザーが示した事業区分を、勝手に分割・統合・置換しない');
    expect(system).toContain('「人材」「お金・投資」「経営や組織の時間」の3つを必ず確認する');
    expect(system).toContain('「考えられる方向」「戦略仮説」として書き、経営者自身の回答として断定しない');
    expect(system).toContain('その区分を分析単位として優先する');
    expect(system).toContain('A事業とB事業の間で、人・お金・時間をどう配分するかの単位で整理する');
    expect(system).toContain('STAGE3以降に残すもの');
  });

  it('12問回答の「人材が不足」は、AIへの入力から削られない', async () => {
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    await POST(req({
      answers12: [{ id: 'ch1-q4', answer: 'B事業：人材が不足しており、成長に必要な投資余力も限られている。' }],
    }));

    const messages = (openai.chat.completions.create as jest.Mock).mock.calls[0][0].messages;
    expect(JSON.stringify(messages)).toContain('人材が不足しており');
  });

  it('出力の人材配分の文は残し、研修・育成の計画文だけを除く', async () => {
    const content = JSON.stringify({
      sections: [
        { heading: 'なぜ今', body: sectionBody('B事業の人材が不足しており、成長投資の前に人材配分の優先順位を決める必要がある。') },
        { heading: 'どう戦う', body: sectionBody('全社研修を年4回実施し、研修計画を全部門へ展開する。') },
        { heading: 'どんな未来', body: sectionBody('') },
        { heading: 'どう実行する', body: sectionBody('') },
      ],
    });
    (openai.chat.completions.create as jest.Mock).mockResolvedValue({ choices: [{ message: { content } }] });

    const res = await POST(req({ answers12: [{ id: 'ch0-q1', answer: '危機' }] }));
    const text = JSON.stringify(await res.json());

    expect(text).toContain('人材配分の優先順位を決める必要がある');
    expect(text).not.toContain('全社研修を年4回実施');
  });
});
