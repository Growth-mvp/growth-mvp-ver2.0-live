import { SAMPLE_PLANS } from './fixtures';
import {
  INITIAL_PLAN_STATE,
  adopt,
  applyEdit,
  computePlanView,
  discardEdit,
  enterEdit,
  reconcileStart,
  setCommittedValue,
  setDraftValue,
  start,
  unadopt,
} from './planState';

const growth = SAMPLE_PLANS.find((s) => s.id === 'growth')!.bundle;

describe('planState: 修正の反映と取り消し', () => {
  it('修正をやめると、反映済みの内容はそのまま残る', () => {
    let s = setCommittedValue(INITIAL_PLAN_STATE, 'goal', '反映済み');
    s = enterEdit(s);
    s = setDraftValue(s, 'goal', '取り消す内容');
    s = discardEdit(s);
    expect(s.mode).toBe('read');
    expect(s.committed).toEqual({ goal: '反映済み' });
    expect(s.draft).toEqual({});
  });

  it('内容が変わらない反映は、採用を解除しない', () => {
    let s = setCommittedValue(INITIAL_PLAN_STATE, 'goal', 'A');
    s = { ...s, adopted: true };
    s = applyEdit({ ...enterEdit(s) });
    expect(s.adopted).toBe(true);
    expect(s.notice).toBeNull();
  });

  it('採用後に内容を変えて反映すると、採用と開始を解除し、理由を残す', () => {
    let s = { ...INITIAL_PLAN_STATE, adopted: true, started: true };
    s = setDraftValue(enterEdit(s), 'goal', '変更後');
    s = applyEdit(s);
    expect(s.adopted).toBe(false);
    expect(s.started).toBe(false);
    expect(s.committed).toEqual({ goal: '変更後' });
    expect(s.notice).toContain('採用と実行開始の状態を解除');
  });
});

describe('planState: 採用と実行開始の分離', () => {
  it('採用できない計画は採用されない', () => {
    expect(adopt(INITIAL_PLAN_STATE, false).adopted).toBe(false);
    expect(adopt(INITIAL_PLAN_STATE, true).adopted).toBe(true);
  });

  it('編集中の計画は採用できない', () => {
    expect(adopt(enterEdit(INITIAL_PLAN_STATE), true).adopted).toBe(false);
  });

  it('採用を取り消すと、開始も解除される', () => {
    const s = unadopt({ ...INITIAL_PLAN_STATE, adopted: true, started: true });
    expect(s.adopted).toBe(false);
    expect(s.started).toBe(false);
  });

  it('開始の条件が欠けていれば開始されない', () => {
    expect(start(INITIAL_PLAN_STATE, false).started).toBe(false);
    expect(start(INITIAL_PLAN_STATE, true).started).toBe(true);
  });

  it('開始後に条件が欠けたら、開始を解除して保留の理由を残す', () => {
    const s = reconcileStart({ ...INITIAL_PLAN_STATE, started: true }, false);
    expect(s.started).toBe(false);
    expect(s.holdNotice).toBe(true);
  });

  it('条件がそろっても、開始は自動では行われない', () => {
    const s = reconcileStart(INITIAL_PLAN_STATE, true);
    expect(s.started).toBe(false);
  });
});

describe('planState: 表示の計算（架空の成長戦略型）', () => {
  it('採用していない計画は、開始できない理由に採用が含まれる', () => {
    const view = computePlanView(growth, INITIAL_PLAN_STATE);
    expect(view.gate.startable).toBe(false);
    expect(view.gate.blockers).toContain('先に計画案を採用してください');
  });

  it('実行責任者が未確定なら、開始できない理由に含まれる', () => {
    const view = computePlanView(growth, { ...INITIAL_PLAN_STATE, adopted: true });
    expect(view.responsibleConfirmed).toBe(false);
    expect(view.gate.blockers).toContain('実行責任者を確定してください');
  });
});
