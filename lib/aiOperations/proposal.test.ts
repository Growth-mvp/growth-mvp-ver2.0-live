import {
  CONSENT_WITHOUT_PROPOSAL_NOTE,
  PROPOSAL_TTL_MS,
  consentWithoutProposal,
  declinedProposalKeysOf,
  decideProposalReply,
  isProposalConsent,
  openProposalMessageOf,
  parseProposedOp,
  proposalKeyOf,
  type ChatProposal,
} from './proposal';

const ID = { userId: 'u1', companyId: 'c1', strategyId: 's1' };
const OP = { kind: 'ceo.append' as const, text: '収益性を高め、社員の給与を上げられる会社にする' };

function proposalOf(over: Partial<ChatProposal> = {}): ChatProposal {
  return {
    status: 'open',
    op: OP,
    key: proposalKeyOf(OP),
    ...ID,
    signature: '"既存の思い"',
    createdAt: 1_000,
    expiresAt: 1_000 + PROPOSAL_TTL_MS,
    ...over,
  };
}

describe('同意の判定', () => {
  it.each(['はい', 'お願いします', 'お願いします。', 'そうして', 'そうしてください', 'はい、お願いします', 'ぜひお願いします', 'OK'])(
    '「%s」は同意',
    (text) => {
      expect(isProposalConsent(text)).toBe(true);
    },
  );

  it.each([
    'はい、でも登録しないで',
    'お願いしますけど、やっぱりやめて',
    '売上の話をしたい',
    'お願いします。ところで売上は？',
    'いいえ',
    '',
  ])('「%s」は同意ではない', (text) => {
    expect(isProposalConsent(text)).toBe(false);
  });
});

describe('提案への返事の扱い', () => {
  const now = 2_000;

  it('同意で、対象・期限・内容が提案時のままなら反映する', () => {
    expect(decideProposalReply({ proposal: proposalOf(), text: 'お願いします', now, identity: ID, signatureNow: '"既存の思い"' })).toEqual({
      kind: 'accept',
    });
  });

  it('否定は、反映せず提案を断られたものとして閉じる', () => {
    expect(decideProposalReply({ proposal: proposalOf(), text: 'はい、でも登録しないで', now, identity: ID, signatureNow: '"既存の思い"' })).toEqual({
      kind: 'decline',
    });
  });

  it('話題を変えた発言は、反映せず提案を閉じる', () => {
    expect(decideProposalReply({ proposal: proposalOf(), text: '売上の見通しを教えて', now, identity: ID, signatureNow: '"既存の思い"' })).toEqual({
      kind: 'close',
    });
  });

  it('有効期限が切れていれば、同意でも反映しない', () => {
    const late = 1_000 + PROPOSAL_TTL_MS + 1;
    expect(decideProposalReply({ proposal: proposalOf(), text: 'お願いします', now: late, identity: ID, signatureNow: '"既存の思い"' })).toEqual({
      kind: 'discard',
      reason: 'expired',
    });
  });

  it('提案の後に対象の内容が変わっていれば、同意でも反映しない', () => {
    expect(decideProposalReply({ proposal: proposalOf(), text: 'お願いします', now, identity: ID, signatureNow: '"手で書き換えた思い"' })).toEqual({
      kind: 'discard',
      reason: 'changed',
    });
  });

  it('企業・戦略・利用者が違えば、同意でも反映しない', () => {
    for (const identity of [{ ...ID, companyId: 'c2' }, { ...ID, strategyId: 's2' }, { ...ID, userId: 'u2' }]) {
      expect(decideProposalReply({ proposal: proposalOf(), text: 'お願いします', now, identity, signatureNow: '"既存の思い"' })).toEqual({
        kind: 'discard',
        reason: 'scope',
      });
    }
  });
});

describe('提案の鍵と形', () => {
  it('内容が同じなら同じ鍵、内容が違えば別の鍵（キーの順は問わない）', () => {
    const key = proposalKeyOf(OP);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(proposalKeyOf({ text: OP.text, kind: 'ceo.append' } as typeof OP)).toBe(key);
    expect(proposalKeyOf({ ...OP, text: '別の文' })).not.toBe(key);
  });

  it('画面から戻された操作は、形の合うものだけ受け付ける', () => {
    expect(parseProposedOp({ kind: 'ceo.append', text: 'x' })).toEqual({ kind: 'ceo.append', text: 'x' });
    expect(parseProposedOp({ kind: 'stage1.issue', title: '' })).toBeNull();
    expect(parseProposedOp('ceo.append')).toBeNull();
    expect(parseProposedOp(null)).toBeNull();
  });
});

describe('相談の中での提案の探し方', () => {
  const open = proposalOf();

  it('同じ相談で、直前のAIの回答の提案が開いていれば返す', () => {
    const messages = [
      { role: 'user' as const, content: '思いを整理したい', execKey: 'k1' },
      { role: 'assistant' as const, content: '追記しましょうか？', consultKey: 'k1', operationProposal: open },
    ];
    expect(openProposalMessageOf(messages, 'k1')).toBe(messages[1]);
  });

  it('別の相談の提案は返さない。閉じた提案も返さない', () => {
    const messages = [
      { role: 'assistant' as const, content: '追記しましょうか？', consultKey: 'k2', operationProposal: open },
      { role: 'assistant' as const, content: '別の相談', consultKey: 'k1', operationProposal: { ...open, status: 'closed' as const } },
    ];
    expect(openProposalMessageOf(messages, 'k1')).toBeNull();
    expect(openProposalMessageOf(messages, 'k2')).toBe(messages[0]);
  });

  it('否定された提案の鍵だけを、同じ相談の中から集める（重複は1つにする）', () => {
    const declined = { ...open, status: 'declined' as const };
    const messages = [
      { role: 'assistant' as const, content: 'a', consultKey: 'k1', operationProposal: declined },
      { role: 'assistant' as const, content: 'b', consultKey: 'k1', operationProposal: declined },
      { role: 'assistant' as const, content: 'c', consultKey: 'k2', operationProposal: declined },
      { role: 'assistant' as const, content: 'd', consultKey: 'k1', operationProposal: open },
    ];
    expect(declinedProposalKeysOf(messages, 'k1')).toEqual([open.key]);
  });
});

describe('同意されたが提案が保持されていない場合', () => {
  const asked = 'この考えをSTAGE2の『経営者の思い』に追記しておきましょうか？';

  it('直前に反映の問いかけがあり、提案が保持されていない同意だけを対象にする', () => {
    expect(consentWithoutProposal({ lastUser: 'お願いします', previousAssistant: asked, openProposal: false })).toBe(true);
    expect(consentWithoutProposal({ lastUser: 'お願いします', previousAssistant: asked, openProposal: true })).toBe(false);
    expect(consentWithoutProposal({ lastUser: 'お願いします', previousAssistant: '他に知りたいことは？', openProposal: false })).toBe(false);
    expect(consentWithoutProposal({ lastUser: '売上の話をしたい', previousAssistant: asked, openProposal: false })).toBe(false);
  });

  it('AIへの指示は、反映したと言わせず、案の出し直しを求める', () => {
    expect(CONSENT_WITHOUT_PROPOSAL_NOTE).toContain('反映したことにしてはならない');
    expect(CONSENT_WITHOUT_PROPOSAL_NOTE).toContain('<<PROPOSE');
  });
});
