import { mapWithConcurrency, runWithRetryBudget } from './aiCallMetrics';

const apiError = (name: string, status?: number) => Object.assign(new Error(name), { name, status });

describe('AI呼び出しの時間予算つき再試行（課題No.3・18・29）', () => {
  let logs: unknown[][];
  beforeEach(() => {
    logs = [];
    jest.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('成功したら1回だけ呼び、所要時間と回数を1行に残す', async () => {
    const run = jest.fn(async () => 'ok');
    await expect(runWithRetryBudget('draft', 280_000, run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
    expect(logs[0][0]).toBe('[ai-call]');
    expect(JSON.parse(logs[0][1] as string)).toMatchObject({ label: 'draft', ok: true, attempts: 1 });
  });

  it('一時的な障害（429・5xx・接続失敗）は、残りが足りれば1回だけ再試行する', async () => {
    const run = jest.fn().mockRejectedValueOnce(apiError('APIError', 429)).mockResolvedValueOnce('ok');
    await expect(runWithRetryBudget('draft', 280_000, run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(logs[0][1] as string)).toMatchObject({ ok: true, attempts: 2 });
  });

  it('再試行は1回まで（2回目も失敗したら、その例外を返す）', async () => {
    const run = jest.fn().mockRejectedValue(apiError('APIConnectionError'));
    await expect(runWithRetryBudget('draft', 280_000, run)).rejects.toThrow('APIConnectionError');
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.parse(logs[0][1] as string)).toMatchObject({ ok: false, attempts: 2, errorKind: 'APIConnectionError' });
  });

  it('タイムアウトと中断は再試行しない（時間を延ばして同じ処理を繰り返さない）', async () => {
    for (const name of ['APIConnectionTimeoutError', 'AbortError', 'APIUserAbortError']) {
      const run = jest.fn().mockRejectedValue(apiError(name));
      await expect(runWithRetryBudget('draft', 280_000, run)).rejects.toThrow(name);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it('入力の不備（400など）は再試行しない', async () => {
    const run = jest.fn().mockRejectedValue(apiError('BadRequestError', 400));
    await expect(runWithRetryBudget('draft', 280_000, run)).rejects.toThrow('BadRequestError');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('残り時間が足りないときは、一時的な障害でも再試行しない', async () => {
    let t = 0;
    const now = () => t;
    const run = jest.fn(async () => {
      t += 270_000;
      throw apiError('APIConnectionError');
    });
    await expect(runWithRetryBudget('draft', 280_000, run, now)).rejects.toThrow('APIConnectionError');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('各試行のタイムアウトは、残りの時間予算から決まる（SDKの既定の再試行は使わない）', async () => {
    const seen: number[] = [];
    const run = jest.fn(async (timeoutMs: number) => {
      seen.push(timeoutMs);
      if (seen.length === 1) throw apiError('APIConnectionError');
      return 'ok';
    });
    await runWithRetryBudget('draft', 100_000, run, () => 0);
    expect(seen).toEqual([98_000, 98_000]);
  });
});

describe('順序を保つ並列実行（課題No.3・18・29）', () => {
  it('結果は入力の順序どおりに並び、同時に動く数は上限を超えない', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, (6 - n) * 2));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it('入力が空でも結果は空', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });
});
