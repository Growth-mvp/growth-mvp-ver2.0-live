import type { OperationProposal } from './instruction';
import { proposalBlockReason, proposalRequiredRole, proposalStaleReason } from './guard';

const INTENT: OperationProposal = {
  kind: 'stage2.ceoIntent',
  pathname: '/stage2',
  companyId: 'company-1',
  strategyId: 'strategy-1',
  before: '原点',
  addition: '地域',
};

const REVENUE: OperationProposal = {
  kind: 'stage1.revenue',
  pathname: '/stage1',
  companyId: 'company-1',
  strategyId: 'strategy-1',
  year: 2025,
  beforeYen: 190_000_000,
  afterYen: 160_000_000,
};

const SAME: { companyId: string; strategyId: string; pathname: string; dirty: boolean } = {
  companyId: 'company-1',
  strategyId: 'strategy-1',
  pathname: '/stage2',
  dirty: false,
};

describe('proposalBlockReason', () => {
  it('対象が同じで未保存の変更がなければ通す', () => {
    expect(proposalBlockReason(INTENT, SAME)).toBeNull();
  });

  it('会社が切り替わった入力案は破棄する', () => {
    expect(proposalBlockReason(INTENT, { ...SAME, companyId: 'company-2' })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('戦略が違う入力案は破棄する', () => {
    expect(proposalBlockReason(INTENT, { ...SAME, strategyId: 'strategy-2' })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('画面が変わった入力案は破棄する', () => {
    expect(proposalBlockReason(INTENT, { ...SAME, pathname: '/stage1' })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('未保存の変更があれば保存を止めるが、入力案は残す', () => {
    expect(proposalBlockReason(INTENT, { ...SAME, dirty: true })).toEqual(expect.objectContaining({ discard: false }));
  });
});

describe('proposalStaleReason', () => {
  it('作成後に「経営者の思い」が変わっていれば保存しない', () => {
    expect(proposalStaleReason(INTENT, { ceoIntent: '原点' })).toBeNull();
    expect(proposalStaleReason(INTENT, { ceoIntent: '別の文' })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('作成後に売上高が変わっていれば保存しない', () => {
    expect(proposalStaleReason(REVENUE, { revenueYen: 190_000_000 })).toBeNull();
    expect(proposalStaleReason(REVENUE, { revenueYen: 175_000_000 })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('未登録だった年度は、未登録のままなら通す', () => {
    const fresh: OperationProposal = { ...REVENUE, beforeYen: null };
    expect(proposalStaleReason(fresh, { revenueYen: null })).toBeNull();
  });
});

describe('proposalRequiredRole', () => {
  it('STAGE2 は管理者、STAGE1 の財務は管理職以上', () => {
    expect(proposalRequiredRole(INTENT)).toBe('admin');
    expect(proposalRequiredRole(REVENUE)).toBe('manager');
  });
});

describe('STAGE3 の6問の入力案', () => {
  const QUESTION: OperationProposal = {
    kind: 'stage3.question',
    pathname: '/cascade',
    companyId: 'company-1',
    strategyId: 'strategy-1',
    departmentName: '宅配事業',
    stepNumber: 1,
    question: '地域の配送需要はどこにあるか',
    before: '',
    answer: '地域の配送需要を取り込む',
  };

  it('管理職以上で承認する', () => {
    expect(proposalRequiredRole(QUESTION)).toBe('manager');
  });

  it('作成後に回答が変わっていれば保存しない', () => {
    expect(proposalStaleReason(QUESTION, { stage3Answer: '' })).toBeNull();
    expect(proposalStaleReason(QUESTION, { stage3Answer: '別の回答' })).toEqual(expect.objectContaining({ discard: true }));
  });

  it('対象の画面が変わったら破棄する', () => {
    expect(proposalBlockReason(QUESTION, { ...SAME, pathname: '/cascade' })).toBeNull();
    expect(proposalBlockReason(QUESTION, { ...SAME, pathname: '/okr' })).toEqual(expect.objectContaining({ discard: true }));
  });
});
