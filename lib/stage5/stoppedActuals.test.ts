import { actualMaxYmOf, actualMonthRefusal, isListedOnExecution, monthAfterLimit } from './stoppedActuals';

const stopped = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  lifecycle: { status: 'STOPPED', changedAt: '2026-11-01T00:00:00.000Z', changedBy: null, stoppedAt: '2026-10-15', ...over },
});
const excluded = { id: 'p2', lifecycle: { status: 'EXCLUDED', changedAt: '2026-11-01T00:00:00.000Z', changedBy: null } };
const active = { id: 'p3' };

describe('中止した施策の実績（stoppedActuals）', () => {
  it('中止した施策は、中止月（stoppedAt の年月）を上限にする', () => {
    expect(actualMaxYmOf(stopped())).toBe('2026-10');
  });

  it('stoppedAt が無ければ changedAt の年月を上限にする', () => {
    expect(actualMaxYmOf(stopped({ stoppedAt: undefined }))).toBe('2026-11');
  });

  it('中止していない施策・除外の施策には上限を設けない', () => {
    expect(actualMaxYmOf(active)).toBeNull();
    expect(actualMaxYmOf(excluded)).toBeNull();
  });

  it('中止月を含む月は登録できる。中止月より後の月は登録できない', () => {
    expect(actualMonthRefusal(stopped(), '2026-09')).toBeNull();
    expect(actualMonthRefusal(stopped(), '2026-10')).toBeNull();
    expect(actualMonthRefusal(stopped(), '2026-11')).toBe('中止した月（2026-10）より後の実績は登録できません。');
    expect(actualMonthRefusal(stopped(), '2027-01')).toBe('中止した月（2026-10）より後の実績は登録できません。');
  });

  it('中止していない施策は、どの月も登録を妨げない', () => {
    expect(actualMonthRefusal(active, '2030-12')).toBeNull();
  });

  it('上限が無いときは、どの年月も妨げない', () => {
    expect(monthAfterLimit('2030-01', null)).toBeNull();
    expect(monthAfterLimit('2030-01', undefined)).toBeNull();
  });

  it('中止した施策は実績の登録の一覧に出す。除外の施策は出さない（状態が無い施策は従来どおり出す）', () => {
    expect(isListedOnExecution(stopped())).toBe(true);
    expect(isListedOnExecution(active)).toBe(true);
    expect(isListedOnExecution(excluded)).toBe(false);
  });
});
