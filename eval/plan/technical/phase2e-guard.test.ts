import { assertCanSend, PHASE2E } from '../live-2e';

describe('Phase 2E の上限（送信なしで確認）', () => {
  it('3回に達した台帳では、4回目は送信前に止まる', () => {
    expect(() => assertCanSend({ calls: 3, spentUsd: 0, entries: [] }, 4000)).toThrow('回数上限');
  });

  it('費用の最悪ケースが上限を超えるなら、送らずに止まる', () => {
    expect(() => assertCanSend({ calls: 0, spentUsd: 0.999, entries: [] }, 4000)).toThrow('費用上限');
  });

  it('上限の内側なら通る', () => {
    expect(() => assertCanSend({ calls: 0, spentUsd: 0, entries: [] }, 4000)).not.toThrow();
    expect(PHASE2E.maxCalls).toBe(3);
    expect(PHASE2E.budgetUsd).toBe(1);
  });
});
