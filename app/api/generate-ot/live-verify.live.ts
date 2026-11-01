/*
 * 実 API 検証（単発専用）。通常の Jest（*.test.ts）からは読み込まれない。
 * 実行条件: 環境変数 LIVE_OT_CONFIRM=1 と、npm run live:ot-verify。
 * 1 回実行すると、一時フォルダに lock ファイルを作り、以降の実行は拒否する。
 * route は本番と同じコードを通し、認証（ユーザーとメンバーシップ）だけをスタブにする。
 */
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: async () => 'live-verify-user',
  requireMembership: async () => ({
    userId: 'live-verify-user',
    companyId: 'live-verify-company',
    role: 'member',
    departmentId: null,
  }),
}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({}) }));

const MAX_NETWORK_CALLS = 2; // 検索 1 + 分析 1
const LOCK_FILE = path.join(os.tmpdir(), 'growth-live-ot-verify.lock');

function loadOpenAiKeyFromEnvLocal(): void {
  if (process.env.OPENAI_API_KEY) return;
  const file = path.join(process.cwd(), '.env.local');
  const line = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('OPENAI_API_KEY='));
  if (!line) throw new Error('OPENAI_API_KEY が .env.local にありません');
  process.env.OPENAI_API_KEY = line.slice('OPENAI_API_KEY='.length).replace(/^["']|["']$/g, '').trim();
}

const runLive = process.env.LIVE_OT_CONFIRM === '1' ? describe : describe.skip;

runLive('実 API 検証: O・T 生成 1 回（単発）', () => {
  it('Web 検索 ON で 1 回だけ生成する', async () => {
    if (fs.existsSync(LOCK_FILE)) {
      throw new Error(`既に実行済みです（${LOCK_FILE}）。再実行は許可を得てから lock を削除してください。`);
    }
    fs.writeFileSync(LOCK_FILE, new Date().toISOString(), { flag: 'wx' });

    loadOpenAiKeyFromEnvLocal();
    process.env.OT_WEB_SEARCH_ENABLED = 'true';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openai } = require('@/lib/openai');
    const calls: Array<Record<string, unknown>> = [];
    let networkCalls = 0;
    let blocked = false;

    const guard = () => {
      if (blocked || networkCalls >= MAX_NETWORK_CALLS) {
        blocked = true;
        throw new Error('harness_blocked_further_calls');
      }
      networkCalls++;
    };
    const reportError = (phase: string, e: any) => {
      blocked = true;
      process.stdout.write(
        'LIVE_ERROR ' +
          JSON.stringify({
            phase,
            name: e?.name,
            status: e?.status ?? null,
            code: e?.code ?? null,
            type: e?.type ?? null,
            message: String(e?.message ?? e).slice(0, 400),
          }) +
          '\n'
      );
    };

    const responsesResource = openai.responses;
    const originalResponses = responsesResource.create.bind(responsesResource);
    responsesResource.create = async (params: any, options: any) => {
      const phase = params.tools ? 'search' : 'analysis';
      guard();
      let res: any;
      try {
        res = await originalResponses(params, options);
      } catch (e: any) {
        reportError(phase, e);
        throw e;
      }
      calls.push({
        phase,
        model: params.model,
        reasoning: params.reasoning ?? null,
        maxOutputTokens: params.max_output_tokens,
        usage: res.usage ?? null,
        webSearchCalls: (res.output ?? []).filter((i: any) => i.type === 'web_search_call').length,
      });
      return res;
    };

    const chatResource = openai.chat.completions;
    const originalChat = chatResource.create.bind(chatResource);
    chatResource.create = async (params: any, options: any) => {
      guard();
      let res: any;
      try {
        res = await originalChat(params, options);
      } catch (e: any) {
        reportError('chat_fallback', e);
        throw e;
      }
      calls.push({ phase: 'chat_fallback', model: params.model, usage: res.usage ?? null });
      return res;
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POST } = require('./route');
    const body = {
      industry: 'manufacturing',
      revenue: '約80億円',
      employees: '約300名',
      businessContent: '産業用の計測・制御機器の製造と、設置後の保守サービス（検証用の架空プロファイル）',
      mission: '現場の止まらない工場を支える',
      vision: '計測と保守のデータで、顧客の設備稼働を守る企業になる',
      value: '現場に寄り添う技術',
      ceoIntent: '技術で海外顧客の信頼を取り、保守の売上比率を高める',
      strength: '保守サービスで蓄積した現場の稼働データ',
      weakness: '海外の販売網と代理店が弱い',
      businessSegments: [
        { name: '計測機器事業', summary: '工場向け計測機器の製造・販売', revenue: 5000, profit: 600 },
        { name: '保守サービス事業', summary: '設置済み機器の保守・予兆検知', revenue: 3000, profit: 900 },
      ],
      financeRows: [
        { year: 2024, '売上高(円)': 7_600_000_000, '営業利益(円)': 1_000_000_000 },
        { year: 2025, '売上高(円)': 8_000_000_000, '営業利益(円)': 1_150_000_000 },
      ],
    };

    const started = Date.now();
    const res = await POST(
      new NextRequest('http://localhost/api/generate-ot', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer live-verify' },
        body: JSON.stringify(body),
      })
    );
    const json = await res.json();
    const wallMs = Date.now() - started;

    process.stdout.write(
      'LIVE_RESULT ' +
        JSON.stringify({ httpStatus: res.status, wallMs, networkCalls, blocked, calls, response: json }, null, 2) +
        '\n'
    );
    expect(res.status).toBe(200);
  }, 120_000);
});
