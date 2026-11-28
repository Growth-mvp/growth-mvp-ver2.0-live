import { useStage2CommandStore } from './stage2Command';

const cmd = { kind: 'draft' as const, companyId: 'c-1', strategyId: 's-1', userId: 'u-1' };

describe('STAGE2の依頼の受け渡し', () => {
  beforeEach(() => useStage2CommandStore.setState({ pending: null, lastReport: null }));

  it('依頼は一度だけ受け取れる', () => {
    const id = useStage2CommandStore.getState().request(cmd);
    expect(useStage2CommandStore.getState().take()?.id).toBe(id);
    expect(useStage2CommandStore.getState().take()).toBeNull();
  });

  it('依頼には、利用者・企業・戦略と有効期限を持たせる', () => {
    useStage2CommandStore.getState().request(cmd);
    const taken = useStage2CommandStore.getState().take();
    expect(taken).toMatchObject({ companyId: 'c-1', strategyId: 's-1', userId: 'u-1', kind: 'draft' });
    expect(taken!.expiresAt - Date.now()).toBeGreaterThan(0);
    expect(taken!.expiresAt - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('受け取られていない前の依頼は、新しい依頼に置き換わる', () => {
    useStage2CommandStore.getState().request(cmd);
    const second = useStage2CommandStore.getState().request({ ...cmd, kind: 'commit' });
    const taken = useStage2CommandStore.getState().take();
    expect(taken?.id).toBe(second);
    expect(taken?.kind).toBe('commit');
  });

  it('結果の報告は、画面の表示に使えるように残る', () => {
    useStage2CommandStore.getState().report({ id: 'x', kind: 'commit', ok: false, message: '確定に失敗しました' });
    expect(useStage2CommandStore.getState().lastReport).toMatchObject({ id: 'x', ok: false, message: '確定に失敗しました' });
  });
});
