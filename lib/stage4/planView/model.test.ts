import {
  EMPTY_REGULATORY,
  financeAmountText,
  isRegulatoryTask,
  regulatoryComplete,
  regulatoryHeld,
  startGate,
  type RegulatoryRecord,
} from './model';

const complete: RegulatoryRecord = {
  decision: 'NOT_APPLICABLE',
  judgement: '医療機器の届出は不要と確認した',
  confirmer: '法務 担当（仮）',
  confirmedOn: '2026-11-09',
  basis: '所管部署の回答',
};

describe('規制・安全の記録', () => {
  it('判断内容・確認者・確認日が揃えば、完了とみなす', () => {
    expect(regulatoryComplete(complete)).toBe(true);
  });

  it('「未確認」は、他が揃っていても完了としない（開始を保留する）', () => {
    expect(regulatoryComplete({ ...complete, decision: 'UNCONFIRMED' })).toBe(false);
  });

  it('確認日の形式が不正なら完了としない', () => {
    expect(regulatoryComplete({ ...complete, confirmedOn: '2026/11/09' })).toBe(false);
  });

  it('判断根拠が空なら完了としない', () => {
    expect(regulatoryComplete({ ...complete, basis: '' })).toBe(false);
  });

  it('空の記録は完了しない', () => {
    expect(regulatoryComplete(EMPTY_REGULATORY)).toBe(false);
  });
});

describe('実行開始の条件', () => {
  const base = {
    adopted: true,
    responsibleConfirmed: true,
    regulatory: complete,
  };

  it('すべて揃えば開始できる', () => {
    expect(startGate(base)).toEqual({ startable: true, blockers: [] });
  });

  it('採用していなければ開始できない', () => {
    const r = startGate({ ...base, adopted: false });
    expect(r.startable).toBe(false);
    expect(r.blockers).toContain('先に計画案を採用してください');
  });

  it('責任者が未確定なら開始できない', () => {
    expect(startGate({ ...base, responsibleConfirmed: false }).blockers).toContain('実行責任者を確定してください');
  });

  it('規制・安全の記録が「未確認」と明示されていれば、開始を保留する', () => {
    const r = startGate({ ...base, regulatory: { ...complete, decision: 'UNCONFIRMED' } });
    expect(r.startable).toBe(false);
    expect(r.blockers.join(' ')).toContain('開始を保留');
  });

  it('規制・安全の記録が無くても、語（規制・安全など）では開始を妨げない（準備活動として開始できる）', () => {
    expect(startGate({ ...base, regulatory: EMPTY_REGULATORY }).startable).toBe(true);
  });

  it('「未確認」の判定だけを保留と扱い、記録が無いことは虚偽の完了として扱わない', () => {
    expect(regulatoryHeld(EMPTY_REGULATORY)).toBe(false);
    expect(regulatoryHeld({ ...EMPTY_REGULATORY, decision: 'UNCONFIRMED' })).toBe(true);
    expect(regulatoryHeld({ ...EMPTY_REGULATORY, decision: 'NOT_APPLICABLE' })).toBe(false);
  });
});

describe('財務効果の表示', () => {
  it('未算定は、金額があっても 0 円にしない', () => {
    expect(financeAmountText('NOT_CALCULATED', null)).toBe('未算定');
    expect(financeAmountText('NOT_CALCULATED', '0.0 百万円（0 円）')).toBe('未算定');
  });

  it('金額が無い試算も、未算定とする', () => {
    expect(financeAmountText('AI_ESTIMATE', null)).toBe('未算定');
  });

  it('金額のある区分は、その表示をそのまま使う', () => {
    expect(financeAmountText('CONFIRMED', '5.0 百万円（5,000,000 円）')).toBe('5.0 百万円（5,000,000 円）');
  });
});

describe('規制に関する確認事項の判定', () => {
  it('規制の語を含む開始前の確認は、規制の確認として扱う', () => {
    expect(isRegulatoryTask({ title: '医療機器としての規制・法令の適用有無を確認する', gate: 'START' })).toBe(true);
  });

  it('保留の印が付いたものは、規制として扱う', () => {
    expect(isRegulatoryTask({ title: '確認する', gate: 'START', hold: true })).toBe(true);
  });

  it('開始前でない確認は、規制の語があっても開始の条件にしない', () => {
    expect(isRegulatoryTask({ title: '規制を確認する', gate: 'LATER' })).toBe(false);
  });
});
