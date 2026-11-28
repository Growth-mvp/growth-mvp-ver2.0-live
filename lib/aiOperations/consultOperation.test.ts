import {
  ISSUE_DESCRIPTION_MAX,
  ISSUE_TITLE_MAX,
  OPERATION_OFFER_BLOCK,
  allowConsultCandidate,
  extractConsultOperation,
  consultOfferKeyOf,
  isClearIssueInstruction,
  parseConsultOffer,
  parseOperationCandidate,
} from './consultOperation';

describe('操作候補の取り出しと検証', () => {
  it('正しい印は候補にし、本文からは取り除く', () => {
    const r = extractConsultOperation('承知しました。\n<<OP {"kind":"stage1.issue","title":"新規顧客の獲得力が弱い","description":"説明"}>>');
    expect(r.content).toBe('承知しました。');
    expect(r.candidate).toEqual({ kind: 'stage1.issue', title: '新規顧客の獲得力が弱い', description: '説明' });
    expect(r.rejected).toBe(false);
  });

  it('提案のみの印は、提案として返し、本文からは取り除く', () => {
    const r = extractConsultOperation('経営課題として整理しますか。\n<<OFFER stage1.issue>>');
    expect(r.offer).toBe('stage1.issue');
    expect(r.candidate).toBeNull();
    expect(r.content).toBe('経営課題として整理しますか。');
  });

  it('印が無ければ、本文はそのまま（通常の相談の回答）', () => {
    const r = extractConsultOperation('まずは顧客の声を集めましょう。');
    expect(r).toEqual({ content: 'まずは顧客の声を集めましょう。', candidate: null, offer: null, rejected: false });
  });

  it('JSONが壊れている印や、対象の種類が違う印は捨て、捨てたことを示す', () => {
    expect(extractConsultOperation('本文\n<<OP {broken}>>')).toMatchObject({ candidate: null, rejected: true, content: '本文' });
    expect(extractConsultOperation('本文\n<<OP {"kind":"stage4.plan","title":"x"}>>')).toMatchObject({ candidate: null, rejected: true });
  });

  it('題名は必須で、100字以内・改行なし。説明文は300字以内', () => {
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: '  ', description: '' })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'あ'.repeat(ISSUE_TITLE_MAX) })).not.toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'あ'.repeat(ISSUE_TITLE_MAX + 1) })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'a\nb' })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'x', description: 'い'.repeat(ISSUE_DESCRIPTION_MAX + 1) })).toBeNull();
    expect(parseOperationCandidate({ kind: 'stage1.issue', title: 'x' })).toEqual({ kind: 'stage1.issue', title: 'x', description: '' });
  });

  it('候補に企業・戦略・権限の情報があっても、取り出すのは種類・題名・説明文だけ', () => {
    const r = parseOperationCandidate({ kind: 'stage1.issue', title: 'x', companyId: 'other', role: 'admin' });
    expect(r).toEqual({ kind: 'stage1.issue', title: 'x', description: '' });
  });

  it('AIへの指示は、操作の型・文字数・仮定と曖昧さの扱いを含む', () => {
    expect(OPERATION_OFFER_BLOCK).toContain('<<OP {"kind":"stage1.issue"');
    expect(OPERATION_OFFER_BLOCK).toContain('<<OFFER stage1.issue>>');
    expect(OPERATION_OFFER_BLOCK).toContain('仮定・検討・質問');
    expect(OPERATION_OFFER_BLOCK).toContain('どれか曖昧');
  });
});

describe('明確な指示かどうか（決定的な判定）', () => {
  it.each([
    ['経営課題として新規顧客の獲得力強化を追加して', null],
    ['経営課題に新規顧客の獲得力を入れて', null],
    ['それを経営課題に入れておいて', 'stage1.issue'],
    ['論点に入れて', null],
    ['お願いします', 'stage1.issue'],
    ['そうしてください', 'stage1.issue'],
    ['入れておいて', 'stage1.issue'],
  ])('「%s」（提案: %s）は明確な指示', (text, offer) => {
    expect(isClearIssueInstruction(text, offer)).toBe(true);
  });

  it.each([
    ['新規顧客が増えないことを経営課題にした方がいいかな', null],
    ['経営課題に入れたほうがいいですか？', null],
    ['もし新規顧客が増えないなら経営課題に入れて', null],
    ['経営課題にするかどうか考えている', null],
    ['新規顧客の獲得を経営課題にしたい', null],
    ['最近、新規顧客が増えない', null],
    ['お願いします', null],
    ['お願いします', 'other'],
    ['それを経営課題に入れておいて', null],
    ['それを経営課題に入れて', null],
  ])('「%s」（提案: %s）は指示ではない（通常の相談）', (text, offer) => {
    expect(isClearIssueInstruction(text, offer)).toBe(false);
  });
});

describe('サーバーが候補を通してよいか', () => {
  const base = { lastUser: '', priorOffer: null, role: 'admin', enabled: true };

  it('管理職・管理者で、明確な指示なら通す', () => {
    expect(allowConsultCandidate({ ...base, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(true);
    expect(allowConsultCandidate({ ...base, role: 'manager', lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(true);
  });

  it('一般の利用者・機能が無効・役割が不明なら、明確な指示でも通さない（権限の確認）', () => {
    expect(allowConsultCandidate({ ...base, role: 'member', lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
    expect(allowConsultCandidate({ ...base, role: null, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
    expect(allowConsultCandidate({ ...base, enabled: false, lastUser: '経営課題として新規顧客の獲得力を追加して' })).toBe(false);
  });

  it('短い同意は、直前に操作の提案があるときだけ通す（シナリオC）', () => {
    expect(allowConsultCandidate({ ...base, lastUser: 'お願いします', priorOffer: 'stage1.issue' })).toBe(true);
    expect(allowConsultCandidate({ ...base, lastUser: 'お願いします', priorOffer: null })).toBe(false);
  });

  it('仮定・検討は通さない（シナリオD）', () => {
    expect(allowConsultCandidate({ ...base, lastUser: '新規顧客が増えないことを経営課題にした方がいいかな' })).toBe(false);
  });
});

describe('検証シナリオ（人の発言 → 候補の可否）', () => {
  const admin = { role: 'admin', enabled: true };

  it('A 明確な命令：経営課題として〇〇を追加して → 候補', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: '経営課題として新規顧客の獲得力強化を追加して', priorOffer: null })).toBe(true);
  });

  it('B 自然な相談のあとに提案し、「それを経営課題に入れておいて」 → 候補（提案があるとき）', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: 'それを経営課題に入れておいて', priorOffer: 'stage1.issue' })).toBe(true);
    expect(allowConsultCandidate({ ...admin, lastUser: 'それを経営課題に入れておいて', priorOffer: null })).toBe(false);
  });

  it('C 提案のあとの「お願いします」 → 候補（提案がある時だけ）', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: 'お願いします', priorOffer: 'stage1.issue' })).toBe(true);
  });

  it('D 仮定・検討 → 候補にしない（勝手に保存しない）', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: '新規顧客が増えないことを経営課題にした方がいいかな', priorOffer: null })).toBe(false);
  });

  it('E 複数の話題のあとの「それを入れて」 → 直前の提案が無ければ候補にしない（どれか決めない）', () => {
    expect(allowConsultCandidate({ ...admin, lastUser: 'それを経営課題に入れて', priorOffer: null })).toBe(false);
    expect(allowConsultCandidate({ ...admin, lastUser: 'それを経営課題に入れて', priorOffer: 'stage1.issue' })).toBe(true);
    expect(OPERATION_OFFER_BLOCK).toContain('どれか曖昧');
  });
});

describe('否定・保留と、印の不備（安全側）', () => {
  it.each([
    ['はい、でも登録しないで', 'stage1.issue'],
    ['やっぱりやめておく', 'stage1.issue'],
    ['それを経営課題に入れないで', 'stage1.issue'],
    ['経営課題に入れるのは見送りたい', null],
    ['経営課題として追加して、でも後で考える', null],
  ])('「%s」（提案: %s）は指示にしない', (text, offer) => {
    expect(isClearIssueInstruction(text, offer)).toBe(false);
  });

  it('候補が2つ以上なら、候補も提案もすべて捨てる', () => {
    const one = '<<OP {"kind":"stage1.issue","title":"A"}>>';
    const two = '<<OP {"kind":"stage1.issue","title":"B"}>>';
    const r = extractConsultOperation(`本文\n${one}\n${two}`);
    expect(r).toMatchObject({ content: '本文', candidate: null, offer: null, rejected: true });
  });

  it('候補と提案が同時にあれば、候補は残し提案は持たない', () => {
    const r = extractConsultOperation('本文\n<<OP {"kind":"stage1.issue","title":"A"}>>\n<<OFFER stage1.issue>>');
    expect(r).toMatchObject({ content: '本文', candidate: { title: 'A' }, offer: null, rejected: false });
  });

  it('閉じていない印は捨て、本文に残さない', () => {
    const r = extractConsultOperation('本文\n<<OP {"kind":"stage1.issue","title":"A"');
    expect(r).toMatchObject({ content: '本文', candidate: null, rejected: true });
  });
});

describe('提案の紐づけ鍵', () => {
  const base = { userId: 'u1', companyId: 'c1', strategyId: 's1', thread: 'c1|s1|d|p' };

  it('同じ組なら同じ鍵、いずれかが違えば別の鍵', () => {
    const key = consultOfferKeyOf(base);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(consultOfferKeyOf({ ...base })).toBe(key);
    expect(consultOfferKeyOf({ ...base, userId: 'u2' })).not.toBe(key);
    expect(consultOfferKeyOf({ ...base, companyId: 'c2' })).not.toBe(key);
    expect(consultOfferKeyOf({ ...base, strategyId: 's2' })).not.toBe(key);
    expect(consultOfferKeyOf({ ...base, thread: '' })).not.toBe(key);
  });

  it('画面から戻された提案は、種類と鍵の形だけを受け付ける', () => {
    const key = consultOfferKeyOf(base);
    expect(parseConsultOffer({ kind: 'stage1.issue', key })).toEqual({ kind: 'stage1.issue', key });
    expect(parseConsultOffer('stage1.issue')).toBeNull();
    expect(parseConsultOffer({ kind: 'stage1.issue', key: 'xyz' })).toBeNull();
    expect(parseConsultOffer({ kind: 'stage4.plan', key })).toBeNull();
  });
});
