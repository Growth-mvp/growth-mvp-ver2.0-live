import {
  canAdoptCandidate,
  collectProjectIds,
  currentItemValues,
  buildDeptProposals,
  displayProposalValue,
  isSafeProposalValue,
  isSameCandidateScope,
  isSimilarTitle,
  prepareAdoptedProject,
  sameItemValues,
  pickAdoptableProject,
  stripOkrIdentity,
  validateAdoptableProject,
  validateProposalRequest,
  withoutCandidate,
} from './stage3Candidates';

describe('採用できる権限', () => {
  it('admin と manager は採用できる', () => {
    expect(canAdoptCandidate('admin')).toBe(true);
    expect(canAdoptCandidate('manager')).toBe(true);
    expect(canAdoptCandidate('ADMIN')).toBe(true);
  });

  it('member・未所属・不明な役割は採用できない', () => {
    expect(canAdoptCandidate('member')).toBe(false);
    expect(canAdoptCandidate(null)).toBe(false);
    expect(canAdoptCandidate(undefined)).toBe(false);
    expect(canAdoptCandidate('')).toBe(false);
  });
});

describe('重複の可能性の表示（自動統合はしない）', () => {
  it('表記（空白・大小文字）の違いだけを同じ名称として扱う', () => {
    expect(isSimilarTitle('新規 顧客開拓', '新規顧客開拓')).toBe(true);
    expect(isSimilarTitle('ABC', 'abc')).toBe(true);
  });

  it('名称が違えば別物として扱う。空の名称は一致させない', () => {
    expect(isSimilarTitle('新規顧客開拓', '既存顧客深耕')).toBe(false);
    expect(isSimilarTitle('', '')).toBe(false);
  });
});

describe('OKRの旧IDを持ち込まない', () => {
  it('id・dbOkrId・okrId を取り除き、内容は残す', () => {
    const out = stripOkrIdentity([
      { id: 'o-1', dbOkrId: 'db-1', okrId: 'x', objective: '売上を伸ばす', keyResults: [{ id: 'kr-1', title: 'KR' }] },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]).toEqual({ objective: '売上を伸ばす', keyResults: [{ title: 'KR' }] });
  });

  it('配列でない値は空配列にする', () => {
    expect(stripOkrIdentity(undefined)).toEqual([]);
    expect(stripOkrIdentity('x')).toEqual([]);
  });
});

describe('新規採用のID発行', () => {
  const candidate = { id: 'proj-candidate-1', title: '新規顧客開拓', okrs: [{ id: 'old', objective: 'o' }] };

  it('既存のどのIDとも衝突しない新しいIDを発行し、候補の元データは変えない', () => {
    const taken = new Set(['proj-existing-1', 'proj-existing-2']);
    const result = prepareAdoptedProject(candidate, () => 'proj-new-1', taken);
    expect(result).toEqual({
      ok: true,
      project: { id: 'proj-new-1', title: '新規顧客開拓', okrs: [{ objective: 'o' }] },
    });
    expect(candidate.id).toBe('proj-candidate-1');
    expect(candidate.okrs[0]).toEqual({ id: 'old', objective: 'o' });
  });

  it('発行したIDが既存と衝突したら、取り直す', () => {
    const ids = ['proj-existing-1', 'proj-new-2'];
    const result = prepareAdoptedProject(candidate, () => ids.shift() ?? 'proj-fallback', new Set(['proj-existing-1']));
    expect(result.ok && result.project.id).toBe('proj-new-2');
  });

  it('何度試しても衝突する場合は追加しない', () => {
    const result = prepareAdoptedProject(candidate, () => 'proj-same', new Set(['proj-same']));
    expect(result).toEqual({ ok: false, reason: 'no_unique_id' });
  });

  it('既存の全部門のIDを集める。形式が不正な項目は無視する', () => {
    const ids = collectProjectIds([
      { name: '営業部', projects: [{ id: 'a' }, { title: 'no id' }] },
      { name: '開発部', projects: [{ id: 'b' }] },
      { name: '総務部' },
      null,
    ]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});

describe('会社切替・戦略切替の判定', () => {
  const base = { companyId: 'company-a', strategyId: 'strategy-a', userId: 'user-1' };

  it('会社・戦略・ユーザーが同じなら同じ範囲', () => {
    expect(isSameCandidateScope(base, { ...base })).toBe(true);
  });

  it('会社・戦略・ユーザーのどれかが違えば別の範囲', () => {
    expect(isSameCandidateScope(base, { ...base, companyId: 'company-b' })).toBe(false);
    expect(isSameCandidateScope(base, { ...base, strategyId: 'strategy-b' })).toBe(false);
    expect(isSameCandidateScope(base, { ...base, strategyId: null })).toBe(false);
    expect(isSameCandidateScope(base, { ...base, userId: 'user-2' })).toBe(false);
  });
});

describe('未採用の案の取り除き（見送り・採用後）', () => {
  it('指定した案だけを取り除き、他の案は残す', () => {
    const idOf = (p: Record<string, unknown>) => String(p.id);
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(withoutCandidate(list, 'b', idOf)).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(list).toHaveLength(3);
  });
});

describe('部門戦略の変更案', () => {
  const dept = {
    name: '営業部',
    mission: '既存のミッション',
    missionDescription: '',
    keyIssues: ['既存の課題'],
    intraDeptCollab: ['既存の連携'],
    interDeptCollab: [],
    needsCollab: ['既存の連携'],
    reviewSummary: { correctedItems: ['既存の修正'] },
    projects: [{ id: 'proj-1', title: '既存' }],
  };

  it('生成結果が既存と違う項目だけを変更案にする（同じ値・空の値は出さない）', () => {
    const proposals = buildDeptProposals(dept, {
      mission: '新しいミッション案',
      missionDescription: '',
      keyIssues: ['既存の課題'],
      strategicRole: '全社の成長を支える',
    });
    expect(proposals.map((p) => p.item)).toEqual(['mission', 'strategicRole']);
  });

  it('変更案は既存の値を保持したまま（base に既存値を入れる）、既存の値を書き換えない', () => {
    const [proposal] = buildDeptProposals(dept, { mission: '新しいミッション案' });
    expect(proposal.base).toEqual({ mission: '既存のミッション' });
    expect(proposal.proposed).toEqual({ mission: '新しいミッション案' });
    expect(dept.mission).toBe('既存のミッション');
  });

  it('連携案は、部門内・部門横断・従来の連携候補をまとめて1項目にする', () => {
    const proposals = buildDeptProposals(dept, {
      intraDeptCollab: ['新しい部門内連携'],
      interDeptCollab: ['新しい横断連携'],
      needsCollab: ['新しい部門内連携', '新しい横断連携'],
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].item).toBe('collab');
    expect(Object.keys(proposals[0].base).sort()).toEqual(['interDeptCollab', 'intraDeptCollab', 'needsCollab']);
  });

  it('既存の値と同じ案は出さない（比較のうえで差がない）', () => {
    expect(buildDeptProposals(dept, { mission: '既存のミッション', keyIssues: ['既存の課題'] })).toEqual([]);
  });

  it('要求の項目・キーが一致しなければ拒否する', () => {
    expect(validateProposalRequest('mission', { mission: 'a' }, { mission: 'b' })).toEqual({ ok: true, item: 'mission' });
    expect(validateProposalRequest('stage4Plans', { stage4Plans: 'a' }, { stage4Plans: 'b' })).toEqual({ ok: false, error: 'invalid_item' });
    expect(validateProposalRequest('collab', { intraDeptCollab: [] }, { intraDeptCollab: [] })).toEqual({ ok: false, error: 'invalid_value' });
    expect(validateProposalRequest('mission', { mission: 'a' }, { missionDescription: 'b' })).toEqual({ ok: false, error: 'invalid_base' });
  });

  it('安全でない形（深すぎる入れ子・過大な長さ）と空の案を拒否する', () => {
    expect(isSafeProposalValue({ a: { b: { c: { d: { e: 'x' } } } } })).toBe(false);
    expect(isSafeProposalValue('x'.repeat(5001))).toBe(false);
    expect(isSafeProposalValue(() => 1)).toBe(false);
    expect(isSafeProposalValue(Number.NaN)).toBe(false);
    expect(validateProposalRequest('mission', { mission: '  ' }, { mission: null })).toEqual({ ok: false, error: 'empty_value' });
  });

  it('既存値の比較は、未設定（undefined）と null を同じとして扱う', () => {
    expect(sameItemValues({ mission: null }, currentItemValues({}, 'mission'))).toBe(true);
    expect(sameItemValues({ mission: 'a' }, currentItemValues({ mission: 'b' }, 'mission'))).toBe(false);
  });

  it('画面の表示文字列を作る（連携案は部門内・部門横断に分けて表示）', () => {
    expect(displayProposalValue('keyIssues', { keyIssues: ['課題A', '課題B'] })).toBe('・課題A\n・課題B');
    expect(displayProposalValue('mission', {})).toBe('');
    expect(
      displayProposalValue('collab', { intraDeptCollab: ['A'], interDeptCollab: ['B'] }),
    ).toBe('部門内:\n・A\n\n部門横断:\n・B');
    expect(displayProposalValue('reviewSummary', { reviewSummary: { correctedItems: ['修正'] } })).toBe('correctedItems: ・修正');
  });
});

describe('採用できる項目（許可リスト）', () => {
  it('承認・実績・STAGE4 の情報は、本文に含まれていれば拒否する', () => {
    for (const key of ['planStatus', 'approvedAt', 'approvedBy', 'executionHumanInvestments', 'skillPlans', 'humanInvestments', 'skillRequirements', 'okrsV2', 'ownerUserId']) {
      expect(validateAdoptableProject({ id: 'p', title: 't', [key]: 'x' })).toEqual({ ok: false, error: 'forbidden_project_field' });
    }
  });

  it('許可されていない項目は拒否する', () => {
    expect(validateAdoptableProject({ id: 'p', title: 't', somethingElse: 1 })).toEqual({ ok: false, error: 'unknown_project_field' });
  });

  it('許可された項目だけなら通す', () => {
    expect(validateAdoptableProject({ id: 'p', title: 't', hypothesis: 'h', okrs: [], kpis: ['k'] })).toEqual({ ok: true });
  });

  it('候補から許可された項目だけを取り出す（承認・人的投資などは落とす）', () => {
    const picked = pickAdoptableProject({ id: 'p', title: 't', planStatus: 'approved', executionHumanInvestments: [{ id: 'h' }], hypothesis: 'h' });
    expect(picked).toEqual({ id: 'p', title: 't', hypothesis: 'h' });
  });

  it('採用するプロジェクトは、承認・人的投資・スキル計画を持たない', () => {
    const result = prepareAdoptedProject(
      { id: 'c', title: 'x', planStatus: 'approved', skillPlans: [{ id: 's' }], okrs: [{ id: 'o', keyResults: [{ id: 'k' }] }] },
      () => 'proj-new-9',
      new Set(),
    );
    expect(result).toEqual({
      ok: true,
      project: { id: 'proj-new-9', title: 'x', okrs: [{ keyResults: [{}] }] },
    });
  });
});
