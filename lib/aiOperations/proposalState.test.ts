import { PROPOSAL_TTL_MS } from './proposal';
import { alreadyReflected, newChatProposal, proposalSignatureOf } from './proposalState';

jest.mock('@/utils/supabase/client', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('@/store/strategyStore', () => ({ useStrategyStore: { getState: jest.fn() } }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: jest.fn() } }));

const ID = { userId: 'u1', companyId: 'c1', strategyId: 's1' };

function stateOf(over: Record<string, unknown> = {}) {
  return {
    ceoIntent: '既存の思い',
    mission: '',
    strength: '技術力\n顧客との信頼',
    weakness: '',
    opportunity: '',
    threat: '',
    companyTargets: [{ id: 't-1', label: '営業利益', unit: '万円', base: 5000, dueYear: 2030 }],
    answers12: [{ id: 'ch1-q2', answer: '回答A' }],
    stage1Issues: [{ title: '新規顧客の獲得力が弱い' }],
    ...over,
  } as never;
}

describe('画面の内容と提案の重複', () => {
  it('経営者の思いに、同じ文がすでにあれば、提案しない', () => {
    expect(alreadyReflected({ kind: 'ceo.append', text: '既存の思い' }, stateOf())).toBe(true);
    expect(alreadyReflected({ kind: 'ceo.append', text: '新しい文' }, stateOf())).toBe(false);
    expect(alreadyReflected({ kind: 'ceo.set', text: '既存の思い' }, stateOf())).toBe(true);
  });

  it('SWOTは、項目の行で判定する（追加は既存の行、削除は行がないとき）', () => {
    expect(alreadyReflected({ kind: 'swot.add', field: 'strength', text: '技術力' }, stateOf())).toBe(true);
    expect(alreadyReflected({ kind: 'swot.add', field: 'weakness', text: '人手不足' }, stateOf())).toBe(false);
    expect(alreadyReflected({ kind: 'swot.remove', field: 'weakness', text: '人手不足' }, stateOf())).toBe(true);
  });

  it('業績目標は、同じ名前・単位・値・年度があれば提案しない', () => {
    expect(alreadyReflected({ kind: 'target.add', label: '営業利益', unit: '万円', base: 5000, dueYear: 2030 }, stateOf())).toBe(true);
    expect(alreadyReflected({ kind: 'target.add', label: '営業利益', unit: '万円', base: 6000, dueYear: 2030 }, stateOf())).toBe(false);
    expect(alreadyReflected({ kind: 'target.remove', id: 't-9', label: '営業利益' }, stateOf())).toBe(true);
  });

  it('12の問いの回答と経営課題も、同じ内容があれば提案しない', () => {
    expect(alreadyReflected({ kind: 'answer.set', questionId: 'ch1-q2', text: '回答A' }, stateOf())).toBe(true);
    expect(alreadyReflected({ kind: 'stage1.issue', title: '新規顧客の獲得力が弱い', description: '' }, stateOf())).toBe(true);
    expect(alreadyReflected({ kind: 'stage1.issue', title: '別の課題', description: '' }, stateOf())).toBe(false);
  });
});

describe('提案の作成（権限と重複を確かめる）', () => {
  const now = 10_000;

  it('STAGE1の提案は管理職以上、STAGE2の提案は管理者に限る', () => {
    const issue = { kind: 'stage1.issue', title: '別の課題', description: '' };
    expect(newChatProposal(issue, ID, stateOf(), 'member', now)).toBeUndefined();
    expect(newChatProposal(issue, ID, stateOf(), 'manager', now)).toMatchObject({ status: 'open' });
    const ceo = { kind: 'ceo.append' as const, text: '新しい文' };
    expect(newChatProposal(ceo, ID, stateOf(), 'manager', now)).toBeUndefined();
    expect(newChatProposal(ceo, ID, stateOf(), 'admin', now)).toMatchObject({ status: 'open', ...ID });
  });

  it('提案には、提案時の対象の状態と有効期限を持たせる', () => {
    const ceo = { kind: 'ceo.append' as const, text: '新しい文' };
    const p = newChatProposal(ceo, ID, stateOf(), 'admin', now);
    expect(p?.signature).toBe(proposalSignatureOf(ceo, stateOf()));
    expect(p?.expiresAt).toBe(now + PROPOSAL_TTL_MS);
  });

  it('画面にすでにある内容、形の合わない内容は、提案を作らない', () => {
    expect(newChatProposal({ kind: 'ceo.append', text: '既存の思い' }, ID, stateOf(), 'admin', now)).toBeUndefined();
    expect(newChatProposal(null, ID, stateOf(), 'admin', now)).toBeUndefined();
  });

  it('対象の内容が変われば、提案時の指紋と変わる', () => {
    const ceo = { kind: 'ceo.append', text: '新しい文' } as const;
    expect(proposalSignatureOf(ceo, stateOf())).not.toBe(proposalSignatureOf(ceo, stateOf({ ceoIntent: '手で書いた思い' })));
  });
});
