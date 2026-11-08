import {
  openItemsOf,
  provenanceAfterEdit,
  provenanceAfterPreset,
  provenanceConfirm,
  provenanceLabel,
  reasoningFromDraft,
} from './provenance';

const draft = {
  objective: 'x',
  impact: { assumptions: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 } },
  causalChain: { customer: '既存の配送先', problem: '単価の下落', whyUs: '実績', outcome: '単価回復', moneyPath: '売上増分', verifyNumbers: '商談数' },
  assumptionBasis: { targetCustomers: 'HYPOTHESIS', conversionRatePct: 'USER_DATA', averageDealMJPY: 'DERIVED' },
  verificationItems: ['過去12か月の商談数'],
};

describe('AI生成の根拠の保存', () => {
  it('因果関係・確認項目・前提の出所を保存する（AIが実績と書いても仮説にする）', () => {
    const r = reasoningFromDraft(draft, ['targetCustomers', 'conversionRatePct', 'averageDealMJPY']);
    expect(r.causalChain).toMatchObject({ customer: '既存の配送先', moneyPath: '売上増分' });
    expect(r.verificationItems).toEqual(['過去12か月の商談数']);
    expect(r.provenance).toEqual({
      targetCustomers: { source: 'AI_DRAFT', basis: 'HYPOTHESIS' },
      conversionRatePct: { source: 'AI_DRAFT', basis: 'HYPOTHESIS' },
      averageDealMJPY: { source: 'AI_DRAFT', basis: 'DERIVED' },
    });
  });

  it('区分の無い前提は、仮説として保存する（0や実績として扱わない）', () => {
    const r = reasoningFromDraft({ objective: 'x' }, ['targetCustomers']);
    expect(r.provenance?.targetCustomers).toEqual({ source: 'AI_DRAFT', basis: 'HYPOTHESIS' });
    expect(r.causalChain).toBeUndefined();
  });
});

describe('利用者の修正・確認は、元の出所と区別して記録する', () => {
  it('修正しても元の出所（AI仮説）は残り、修正した事実だけが加わる', () => {
    const base = reasoningFromDraft(draft, ['targetCustomers']).provenance!;
    const edited = provenanceAfterEdit(base, ['targetCustomers']);
    expect(edited.targetCustomers).toEqual({ source: 'AI_DRAFT', basis: 'HYPOTHESIS', userEdited: true });
    expect(provenanceLabel(edited.targetCustomers)).toBe('AIの仮説（利用者が修正）');
  });

  it('確認しても、AI仮説が実績に変わることはない', () => {
    const base = reasoningFromDraft(draft, ['targetCustomers']).provenance!;
    const confirmed = provenanceConfirm(base, 'targetCustomers');
    expect(confirmed.targetCustomers.basis).toBe('HYPOTHESIS');
    expect(provenanceLabel(confirmed.targetCustomers)).toBe('AIの仮説（利用者が確認済み）');
    expect(provenanceLabel(confirmed.targetCustomers)).not.toContain('実績');
  });

  it('利用者が新しく入れた前提は、利用者入力として記録する', () => {
    const next = provenanceAfterEdit(undefined, ['peopleCount']);
    expect(next.peopleCount).toEqual({ source: 'USER_INPUT', basis: 'USER_DATA', userEdited: true });
    expect(provenanceLabel(next.peopleCount)).toBe('利用者が入力（利用者が修正）');
  });

  it('プリセットは、固定プリセットとして記録する', () => {
    const next = provenanceAfterPreset(undefined, ['targetCustomers']);
    expect(provenanceLabel(next.targetCustomers)).toBe('固定プリセット（利用者が選択）');
  });

  it('出所が無い前提は、出所不明と表示する', () => {
    expect(provenanceLabel(undefined)).toBe('出所未記録（出所不明）');
  });
});

describe('未確認の前提・今後調べること', () => {
  it('確認項目と、未確認の仮説の根拠を並べる。確認済みの仮説は含めない', () => {
    const r = reasoningFromDraft(draft, ['targetCustomers', 'averageDealMJPY']);
    r.provenance = provenanceConfirm(r.provenance, 'targetCustomers');
    const items = openItemsOf(r);
    expect(items).toContain('過去12か月の商談数');
    expect(items).not.toContain('「対象顧客数（社）」の根拠を確認する');
    expect(items).not.toContain('「平均単価（百万円）」の根拠を確認する');
  });

  it('根拠の無い項目（未算定）は、確認が必要な項目として残す', () => {
    const items = openItemsOf({ provenance: { targetCustomers: { source: 'AI_DRAFT', basis: 'MISSING' } } });
    expect(items).toEqual(['「対象顧客数（社）」の根拠を確認する']);
  });
});
