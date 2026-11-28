import {
  ISSUE_DESCRIPTION_MAX,
  ISSUE_TITLE_MAX,
  OPERATION_PROPOSAL_BLOCK,
  allowConsultCandidate,
  extractConsultOperation,
  isClearIssueInstruction,
  asksProposalQuestion,
  parseOperationCandidate,
  withoutUnbackedProposal,
  UNBACKED_PROPOSAL_NOTE,
} from './consultOperation';

const ISSUE = { kind: 'stage1.issue', title: '新規顧客の獲得力が弱い', description: '既存顧客は増えるが、新規の商談が増えない。' };
const extraAd = (raw: unknown) =>
  raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'ceo.append' ? { ok: true as const, value: raw } : null;

describe('印の取り出し（提案と直接の操作）', () => {
  it('直接の操作の印は候補にし、本文からは取り除く', () => {
    const r = extractConsultOperation(`承知しました。\n<<OP ${JSON.stringify(ISSUE)}>>`);
    expect(r.content).toBe('承知しました。');
    expect(r.candidate).toEqual({ kind: 'stage1.issue', title: ISSUE.title, description: ISSUE.description });
    expect(r.proposal).toBeNull();
    expect(r.rejected).toBe(false);
  });

  it('提案の印は提案として返し、候補にはせず、本文からは取り除く', () => {
    const r = extractConsultOperation(`経営課題として記録しましょうか？\n<<PROPOSE ${JSON.stringify(ISSUE)}>>`);
    expect(r.content).toBe('経営課題として記録しましょうか？');
    expect(r.proposal).toEqual(ISSUE);
    expect(r.candidate).toBeNull();
    expect(r.rejected).toBe(false);
  });

  it('STAGE2の操作の提案は、検証の関数が通したものだけを返す', () => {
    const ok = extractConsultOperation('追記しましょうか？\n<<PROPOSE {"kind":"ceo.append","text":"収益性を高める"}>>', extraAd);
    expect(ok.proposal).toEqual({ kind: 'ceo.append', text: '収益性を高める' });
    const bad = extractConsultOperation('本文\n<<PROPOSE {"kind":"ceo.zap","text":"x"}>>');
    expect(bad.proposal).toBeNull();
    expect(bad.rejected).toBe(true);
  });

  it('印が2つ以上、または直接の操作と提案が同時にあれば、すべて捨てる（安全側）', () => {
    const one = `<<PROPOSE ${JSON.stringify(ISSUE)}>>`;
    const two = `<<PROPOSE ${JSON.stringify({ ...ISSUE, title: '別の課題' })}>>`;
    expect(extractConsultOperation(`本文\n${one}\n${two}`)).toMatchObject({ content: '本文', proposal: null, candidate: null, rejected: true });
    const mixed = extractConsultOperation(`本文\n<<OP ${JSON.stringify(ISSUE)}>>\n${one}`);
    expect(mixed).toMatchObject({ content: '本文', proposal: null, candidate: null, rejected: true });
  });

  it('閉じていない印は捨て、本文に残さない', () => {
    const r = extractConsultOperation('本文\n<<PROPOSE {"kind":"stage1.issue","title":"A"');
    expect(r).toMatchObject({ content: '本文', proposal: null, rejected: true });
  });

  it('形の合わない経営課題（題名が長すぎる・空）は捨てる', () => {
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: '  ', description: '' })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'あ'.repeat(ISSUE_TITLE_MAX + 1) })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'x', description: 'い'.repeat(ISSUE_DESCRIPTION_MAX + 1) })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'x', companyId: 'other', role: 'admin' })).toEqual({
      kind: 'stage1.issue',
      title: 'x',
      description: '',
    });
  });
});

describe('AIへの指示', () => {
  it('提案の印と直接の操作の印の両方、提案の条件と否定の扱いを含む', () => {
    expect(OPERATION_PROPOSAL_BLOCK).toContain('<<PROPOSE {"kind":"stage1.issue"');
    expect(OPERATION_PROPOSAL_BLOCK).toContain('<<OP {"kind":"stage1.issue"');
    expect(OPERATION_PROPOSAL_BLOCK).toContain('仮定・検討・質問');
    expect(OPERATION_PROPOSAL_BLOCK).toContain('どれか曖昧');
    expect(OPERATION_PROPOSAL_BLOCK).not.toContain('<<OFFER');
  });
});

describe('明確な依頼かどうか（決定的な判定）', () => {
  it.each([
    '経営課題として新規顧客の獲得力強化を追加して',
    '経営課題に新規顧客の獲得力を入れて',
    '論点に入れて',
  ])('「%s」は、明確な依頼', (text) => {
    expect(isClearIssueInstruction(text, false)).toBe(true);
  });

  it('指示語（それを）は、直前に提案が開いているときだけ依頼になる', () => {
    expect(isClearIssueInstruction('それを経営課題に入れておいて', false)).toBe(false);
    expect(isClearIssueInstruction('それを経営課題に入れておいて', true)).toBe(true);
  });

  it.each([
    ['お願いします', true],
    ['はい', true],
    ['新規顧客が増えないことを経営課題にした方がいいかな', false],
    ['経営課題に入れたほうがいいですか？', false],
    ['もし新規顧客が増えないなら経営課題に入れて', false],
    ['新規顧客の獲得を経営課題にしたい', false],
    ['はい、でも登録しないで', false],
    ['やっぱりやめておく', false],
    ['最近、新規顧客が増えない', false],
  ])('「%s」（提案が開いている: %s）でも、同意だけでは直接の依頼にしない', (text, open) => {
    expect(isClearIssueInstruction(text, open)).toBe(false);
  });
});

describe('サーバーが直接の候補を通してよいか', () => {
  const admin = { role: 'admin', enabled: true, openProposal: false };

  it('管理職・管理者で、明確な依頼なら通す。一般の利用者・機能が無効なら通さない', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(true);
    expect(allowConsultCandidate({ ...admin, role: 'manager', lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(true);
    expect(allowConsultCandidate({ ...admin, role: 'member', lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
    expect(allowConsultCandidate({ ...admin, role: null, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
    expect(allowConsultCandidate({ ...admin, enabled: false, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
  });

  it('同意の発言は、提案が開いていても直接の候補にしない（AIが内容を作り直さない）', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: 'お願いします', openProposal: true })).toBe(false);
  });
});

describe('提案の印のない反映の問いかけ', () => {
  it('反映の問いかけを検出する（印の有無と関係なく、問いかけの文だけを見る）', () => {
    expect(asksProposalQuestion('この考えをSTAGE2の『経営者の思い』に追記しておきましょうか？')).toBe(true);
    expect(asksProposalQuestion('経営課題として記録しましょうか？')).toBe(true);
    expect(asksProposalQuestion('売上の見通しを整理しましょう。')).toBe(false);
  });

  it('印のない問いかけは、実行できない提案として見せず、説明に置き換える', () => {
    const out = withoutUnbackedProposal('収益性の話です。\nこの考えを経営者の思いに追記しておきましょうか？');
    expect(out).toBe(`収益性の話です。\n${UNBACKED_PROPOSAL_NOTE}`);
    const middle = withoutUnbackedProposal('A\nこれを記録しましょうか？\n\nB');
    expect(middle).not.toContain('記録しましょうか');
    expect(middle).toContain('B');
  });
});
