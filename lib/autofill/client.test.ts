import { runAutofillPipeline, type PipelineProgress } from './client';
import { identifyFound, jsonRes, reportFound } from './__fixtures__/pipelineResponses';

const TOKEN = 'token-1';
const BASE = { text: '日本製罐の基本情報を入力して', companyId: 'co-a', strategyId: 'st-a', token: TOKEN, now: () => '2026-11-19T00:00:00.000Z' };

function fetchRouter(routes: Record<string, (body: Record<string, unknown>) => unknown>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body, auth: String((init.headers as Record<string, string>).Authorization) });
    const handler = routes[url.replace('/api/stage1/autofill/', '')];
    if (!handler) throw new Error(`no route ${url}`);
    return jsonRes(handler(body));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('依頼から候補までの一連の流れ（ブラウザ側）', () => {
  it('会社の特定→決算期ごとの報告書（3期）→候補の組み立ての順に呼び、進行を段階ごとに知らせる', async () => {
    const { fetchImpl, calls } = fetchRouter({
      identify: () => identifyFound(['2026-03-31', '2024-03-31', '2022-03-31']),
      report: (body) => (body.periodEnd === '2026-03-31' ? reportFound() : { status: 'NOT_FOUND', scannedDays: 110, periodEnd: body.periodEnd }),
    });
    const progress: PipelineProgress[] = [];
    const r = await runAutofillPipeline({ ...BASE, fetchImpl, onProgress: (p) => progress.push(p) });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    expect(calls.map((c) => c.url)).toEqual([
      '/api/stage1/autofill/identify',
      '/api/stage1/autofill/report',
      '/api/stage1/autofill/report',
      '/api/stage1/autofill/report',
    ]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    expect(calls[1].body).toEqual({ companyId: 'co-a', strategyId: 'st-a', edinetCode: 'E01408', periodEnd: '2026-03-31' });
    expect(progress.map((p) => p.step)).toEqual([1, 2, 3, 4, 5]);
    expect(progress[0].label).toContain('会社を特定');
    expect(progress[1].label).toContain('2026年3月期');
    expect(r.missingPeriods).toEqual(['2024-03-31', '2022-03-31']);
    expect(r.candidate.finance.map((y) => y.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(r.candidate.finance.find((y) => y.year === 2026)?.revenue?.value).toBe(11442246000);
  });

  it('会社名が複数ある時は、候補の一覧を返し、報告書は取りに行かない', async () => {
    const { fetchImpl, calls } = fetchRouter({
      identify: () => ({ status: 'AMBIGUOUS', candidates: [{ name: 'A', secCode: '1111', edinetCode: 'E1', address: 'x', listed: true }] }),
    });
    const r = await runAutofillPipeline({ ...BASE, fetchImpl });
    expect(r).toEqual({ status: 'AMBIGUOUS', candidates: [{ name: 'A', secCode: '1111', edinetCode: 'E1', address: 'x', listed: true }] });
    expect(calls).toHaveLength(1);
  });

  it('会社が見つからない・読み取れない依頼は、理由を返す（問い合わせは1回）', async () => {
    const { fetchImpl, calls } = fetchRouter({ identify: () => ({ status: 'NOT_FOUND' }) });
    const r = await runAutofillPipeline({ ...BASE, fetchImpl });
    expect(r.status).toBe('NOT_FOUND');
    expect(calls).toHaveLength(1);
  });

  it('書類の確認件数の上限に達したら、途中で止め、その旨を返す（それ以上は問い合わせない）', async () => {
    const { fetchImpl, calls } = fetchRouter({
      identify: () => identifyFound(['2026-03-31', '2024-03-31', '2022-03-31']),
      report: () => ({ status: 'BUDGET_EXCEEDED', scannedDays: 110 }),
    });
    const r = await runAutofillPipeline({ ...BASE, fetchImpl });
    expect(r.status).toBe('BUDGET_EXCEEDED');
    expect(calls).toHaveLength(2);
  });

  it('入口がエラー（例：権限なし）なら、そのエラーを投げる（再試行しない）', async () => {
    const fetchImpl = (async () => jsonRes({ error: 'insufficient_role' }, 403)) as unknown as typeof fetch;
    await expect(runAutofillPipeline({ ...BASE, fetchImpl })).rejects.toThrow('insufficient_role');
  });

  it('どの決算期も見つからなければ、NOT_FOUND（候補は作らない）', async () => {
    const { fetchImpl } = fetchRouter({
      identify: () => identifyFound(['2026-03-31']),
      report: (body) => ({ status: 'NOT_FOUND', scannedDays: 3, periodEnd: body.periodEnd }),
    });
    const r = await runAutofillPipeline({ ...BASE, fetchImpl });
    expect(r.status).toBe('NOT_FOUND');
  });
});
