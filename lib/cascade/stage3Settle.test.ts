import { settleLegacySelections } from './stage3Settle';
import { emptyWorkspaceState, type Selection, type WorkspaceState } from './stage3StrategyBook';

const official = [
  { id: 'd-a', name: '不動産', mission: '賃貸を伸ばす', missionDescription: null },
  { id: 'd-b', name: '金属缶', mission: '缶を作る', missionDescription: null },
];

const sel = (over: Partial<Selection>): Selection => ({
  departmentKey: 'id:d-b',
  departmentName: '金属缶',
  item: 'mission',
  proposed: { mission: '新しい使命' },
  base: { mission: '缶を作る' },
  decision: 'pending',
  ...over,
});

const withSelections = (selections: Selection[]): WorkspaceState => ({ ...emptyWorkspaceState(), selections });

describe('settleLegacySelections（旧形式の未判断の整理）', () => {
  it('表示中の文章で、保存時点の正式値と一致する未判断は反映する（利用者に採否を求めない）', () => {
    const { state, counts } = settleLegacySelections(withSelections([sel({})]), official);
    expect(state.selections[0].decision).toBe('applied');
    expect(counts).toEqual({ applied: 1, discarded: 0 });
  });

  it('正式値と食い違う未判断は反映しない（正式データを上書きしない）', () => {
    const { state, counts } = settleLegacySelections(withSelections([sel({ base: { mission: '古い値' } })]), official);
    expect(state.selections[0].decision).toBe('discarded');
    expect(counts).toEqual({ applied: 0, discarded: 1 });
  });

  it('内容が空の未判断は反映しない（正式データを空にしない）', () => {
    const { state } = settleLegacySelections(withSelections([sel({ proposed: { mission: '  ' } })]), official);
    expect(state.selections[0].decision).toBe('discarded');
  });

  it('部門が正式データに無い未判断は反映しない', () => {
    const { state } = settleLegacySelections(withSelections([sel({ departmentKey: 'id:gone' })]), official);
    expect(state.selections[0].decision).toBe('discarded');
  });

  it('未設定（null）と空文字の差だけでは食い違いとしない', () => {
    const { state } = settleLegacySelections(
      withSelections([sel({ item: 'missionDescription', proposed: { missionDescription: '概要' }, base: { missionDescription: '' } })]),
      official,
    );
    expect(state.selections[0].decision).toBe('applied');
  });

  it('判断済みの項目と、未判断が無い状態は変えない', () => {
    const input = withSelections([sel({ decision: 'applied' }), sel({ item: 'stopList', decision: 'discarded' })]);
    const { state, counts } = settleLegacySelections(input, official);
    expect(state).toBe(input);
    expect(counts).toEqual({ applied: 0, discarded: 0 });
  });
});
