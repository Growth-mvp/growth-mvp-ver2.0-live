import { replayDecisions, settleSentDecisions, type DecisionEntry } from '@/lib/cascade/stage3DecisionQueue';

type S = { decisions: Record<string, string>; revision: number };

const init: S = { decisions: {}, revision: 1 };
const decide = (key: string, value: string, after?: () => void): DecisionEntry<S> => ({
  key,
  apply: (s) => ({ ...s, decisions: { ...s.decisions, [key]: value } }),
  after,
});

describe('stage3DecisionQueue', () => {
  it('送信中に追加された判断は、保存成功後も残り、次の保存の下書きに含まれる', () => {
    const a = decide('cand:1', 'adopted');
    const sent = [a];
    const draftA = replayDecisions(init, [a]);

    const b = decide('cand:2', 'rejected');
    const pending = [a, b];

    const settled = settleSentDecisions(pending, sent, draftA);
    expect(settled.done).toEqual([a]);
    expect(settled.rest).toEqual([b]);
    expect(settled.draft?.decisions).toEqual({ 'cand:1': 'adopted', 'cand:2': 'rejected' });
  });

  it('送信した判断がすべて保存された場合は、未保存の下書きを残さない', () => {
    const a = decide('cand:1', 'adopted');
    const settled = settleSentDecisions([a], [a], replayDecisions(init, [a]));
    expect(settled.rest).toEqual([]);
    expect(settled.draft).toBeNull();
  });

  it('保存成功した判断の後処理だけを実行し、残りの判断は実行しない', () => {
    const afterA = jest.fn();
    const afterB = jest.fn();
    const a = decide('cand:1', 'adopted', afterA);
    const b = decide('cand:2', 'rejected', afterB);

    const settled = settleSentDecisions([a, b], [a], replayDecisions(init, [a]));
    settled.done.forEach((e) => e.after?.());

    expect(afterA).toHaveBeenCalledTimes(1);
    expect(afterB).not.toHaveBeenCalled();
  });

  it('競合時は最新の保存済み状態の上に、まだ保存していない判断を積み直す', () => {
    const a = decide('cand:1', 'adopted');
    const latest: S = { decisions: { 'cand:9': 'rejected' }, revision: 2 };

    const rebuilt = replayDecisions(latest, [a]);
    expect(rebuilt.decisions).toEqual({ 'cand:9': 'rejected', 'cand:1': 'adopted' });
    expect(rebuilt.revision).toBe(2);
  });

  it('判断の適用は元の状態を書き換えない', () => {
    const a = decide('cand:1', 'adopted');
    replayDecisions(init, [a]);
    expect(init.decisions).toEqual({});
  });
});
