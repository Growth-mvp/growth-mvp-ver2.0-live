import { createRefetchCoordinator } from './refetchCoordinator';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createRefetchCoordinator', () => {
  it('単独の要求は 1 回だけ実行する', async () => {
    const run = jest.fn(async () => {});
    const c = createRefetchCoordinator(run);
    await c.request();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('完了後の新しい要求は再度実行する', async () => {
    const run = jest.fn(async () => {});
    const c = createRefetchCoordinator(run);
    await c.request();
    await c.request();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('実行中の要求は捨てず、完了後に再実行する', async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const run = jest.fn(() => {
      const g = deferred();
      gates.push(g);
      return g.promise;
    });
    const c = createRefetchCoordinator(run);

    const first = c.request();
    const second = c.request();
    expect(run).toHaveBeenCalledTimes(1);

    gates[0].resolve();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);

    gates[1].resolve();
    await Promise.all([first, second]);
  });

  it('実行中の複数の要求は 1 回の再実行にまとめる', async () => {
    const gates: ReturnType<typeof deferred>[] = [];
    const run = jest.fn(() => {
      const g = deferred();
      gates.push(g);
      return g.promise;
    });
    const c = createRefetchCoordinator(run);

    const p = c.request();
    c.request();
    c.request();
    c.request();
    gates[0].resolve();
    await flush();
    gates[1].resolve();
    await p;
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('同時に走る実行は常に 1 つだけ', async () => {
    let active = 0;
    let maxActive = 0;
    const run = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await flush();
      active -= 1;
    });
    const c = createRefetchCoordinator(run);
    await Promise.all([c.request(), c.request(), c.request()]);
    expect(maxActive).toBe(1);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('markDirty で完了後に再実行される（古い結果を破棄した場合の再取得）', async () => {
    const run = jest.fn(async () => {});
    const c = createRefetchCoordinator(run);
    const p = c.request();
    c.markDirty();
    await p;
    expect(run).toHaveBeenCalledTimes(2);
    expect(c.isDirty()).toBe(false);
  });

  it('実行が失敗しても、待機中の要求は再実行される', async () => {
    let call = 0;
    const run = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        await flush();
        throw new Error('network');
      }
    });
    const c = createRefetchCoordinator(run);
    const first = c.request();
    const second = c.request();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('最後の実行が失敗した場合は要求元にエラーを返す', async () => {
    const run = jest.fn(async () => {
      throw new Error('boom');
    });
    const c = createRefetchCoordinator(run);
    await expect(c.request()).rejects.toThrow('boom');
  });

  it('失敗後は次の要求で再び実行できる', async () => {
    let fail = true;
    const run = jest.fn(async () => {
      if (fail) throw new Error('boom');
    });
    const c = createRefetchCoordinator(run);
    await expect(c.request()).rejects.toThrow('boom');
    fail = false;
    await expect(c.request()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
