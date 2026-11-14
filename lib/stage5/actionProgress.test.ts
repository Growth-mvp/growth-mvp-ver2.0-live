import {
  actionKeysFor,
  canonicalJson,
  checkProgressPatch,
  NOTE_MAX,
  nextRecord,
  progressOf,
  sameProgress,
  withActionProgress,
  type ActionProgressRecord,
} from './actionProgress';

const DRAFT = {
  plan: {
    section2: {
      actions: [
        { order: 1, title: '現状の数値と原因を集める', dueYm: '2027-01', ownerRole: '塗料営業責任者', supportsKpiKeys: ['S1'] },
        { order: 2, title: '原因に効く打ち手を一つ試す', dueYm: '2027-03', ownerRole: '塗料営業責任者', supportsKpiKeys: ['S2'] },
      ],
    },
  },
};

const START = '2026-12-01T00:00:00.000Z';

describe('実施事項の安定キー', () => {
  it('同じ開始日時とAI草案なら、キーは同じになる（並び順・保存時の鍵順に依存しない）', () => {
    const reordered = { plan: { section2: { actions: [...DRAFT.plan.section2.actions].reverse() } } };
    const a = actionKeysFor(START, DRAFT);
    const b = actionKeysFor(START, reordered);
    expect(a.map((x) => x.key).sort()).toEqual(b.map((x) => x.key).sort());
    const keyOrder = Object.fromEntries(Object.entries({ title: 'x', order: 1 }).reverse());
    expect(canonicalJson({ order: 1, title: 'x' })).toBe(canonicalJson(keyOrder));
  });

  it('開始し直す（開始日時が変わる）と、キーも変わり、前の記録を引き継がない', () => {
    const first = actionKeysFor(START, DRAFT)[0].key;
    const restarted = actionKeysFor('2027-02-01T00:00:00.000Z', DRAFT)[0].key;
    expect(restarted).not.toBe(first);
  });

  it('行動の内容が違えばキーも違う（別の行動に記録が移らない）', () => {
    const changed = { plan: { section2: { actions: [{ ...DRAFT.plan.section2.actions[0], title: '別の行動' }, DRAFT.plan.section2.actions[1]] } } };
    expect(actionKeysFor(START, changed)[0].key).not.toBe(actionKeysFor(START, DRAFT)[0].key);
  });

  it('AI草案が無い、または行動の順番が無い計画は、キーを作らない', () => {
    expect(actionKeysFor(START, null)).toEqual([]);
    expect(actionKeysFor(START, { plan: {} })).toEqual([]);
  });
});

describe('進捗の読み取り（旧データ・不正な項目）', () => {
  it('進捗の無い案件（旧計画書の案件を含む）は空として読む', () => {
    expect(progressOf({ id: 'p' })).toEqual({});
    expect(progressOf(undefined)).toEqual({});
  });

  it('形の正しい記録だけを読み、不正な状態や配列でない値は捨てる', () => {
    const got = progressOf({
      executionProgress: {
        a: { status: 'DONE', result: '完了した', krIds: ['k1'], updatedAt: 't', updatedBy: 'u' },
        b: { status: 'UNKNOWN', result: 'x', krIds: [] },
        c: 'not-an-object',
      },
    });
    expect(Object.keys(got)).toEqual(['a']);
    expect(got.a.status).toBe('DONE');
  });
});

describe('書き込みの検証', () => {
  const okrIds = ['k1', 'k2'];
  const allowed = actionKeysFor(START, DRAFT).map((x) => x.key);

  it('今の計画の実施事項だけ書ける', () => {
    expect(checkProgressPatch({ actionKey: 'unknown', allowedKeys: allowed, patch: { status: 'DONE' }, okrIds }).ok).toBe(false);
    expect(checkProgressPatch({ actionKey: allowed[0], allowedKeys: allowed, patch: { status: 'DONE' }, okrIds }).ok).toBe(true);
  });

  it('同じ案件にないKRとは紐づけられない（他の案件への混入防止）', () => {
    const r = checkProgressPatch({ actionKey: allowed[0], allowedKeys: allowed, patch: { krIds: ['other-project-kr'] }, okrIds });
    expect(r.ok).toBe(false);
  });

  it('成果は500字まで', () => {
    expect(checkProgressPatch({ actionKey: allowed[0], allowedKeys: allowed, patch: { result: 'あ'.repeat(501) }, okrIds }).ok).toBe(false);
    expect(checkProgressPatch({ actionKey: allowed[0], allowedKeys: allowed, patch: { result: 'あ'.repeat(500) }, okrIds }).ok).toBe(true);
  });

  it('状態は決められた値だけ', () => {
    expect(checkProgressPatch({ actionKey: allowed[0], allowedKeys: allowed, patch: { status: 'MAYBE' as never }, okrIds }).ok).toBe(false);
  });
});

describe('記録の更新', () => {
  const base = { id: 'p-1', title: '案件', okrsV2: [{ id: 'k1', label: 'KR', target: 6, unit: '件' }], financeEffect: { kind: 'REVENUE_UP' } };
  const key = 'K';

  it('一つの実施事項だけを更新し、案件の他の項目（KR・財務効果）は変えない', () => {
    const rec = nextRecord({ existing: undefined, patch: { status: 'IN_PROGRESS', krIds: ['k1'] }, nowIso: '2026-12-10T00:00:00.000Z', userId: 'user-1' });
    const next = withActionProgress(base, key, rec) as Record<string, unknown>;
    expect(next.okrsV2).toEqual(base.okrsV2);
    expect(next.financeEffect).toEqual(base.financeEffect);
    expect(progressOf(next)[key]).toEqual(rec);
  });

  it('既存の値は、指定されなかった項目で残る（成果だけ変えても状態は変わらない）', () => {
    const prev: ActionProgressRecord = { status: 'IN_PROGRESS', result: '途中', issue: '', nextAction: '', krIds: ['k1'], updatedAt: 'a', updatedBy: 'u' };
    const rec = nextRecord({ existing: prev, patch: { result: '完了まで' }, nowIso: 'b', userId: 'u2' });
    expect(rec).toMatchObject({ status: 'IN_PROGRESS', result: '完了まで', krIds: ['k1'], updatedBy: 'u2' });
  });

  it('変更がなければ、保存は不要と判断できる', () => {
    const prev: ActionProgressRecord = { status: 'DONE', result: '', issue: '', nextAction: '', krIds: [], updatedAt: 'a', updatedBy: 'u' };
    expect(sameProgress(prev, { ...prev, updatedAt: 'b' })).toBe(true);
    expect(sameProgress(prev, { ...prev, status: 'IN_PROGRESS' })).toBe(false);
  });
});

describe('課題と次の行動', () => {
  it('未入力の既存記録は、課題・次の行動を空として読む', () => {
    const p = progressOf({ executionProgress: { k: { status: 'IN_PROGRESS', result: '', krIds: [] } } });
    expect(p.k).toMatchObject({ issue: '', nextAction: '' });
  });

  it('課題と次の行動は、部分の更新で他の項目を変えずに残る', () => {
    const prev: ActionProgressRecord = { status: 'IN_PROGRESS', result: '成果', issue: '古い課題', nextAction: '', krIds: [], updatedAt: 'a', updatedBy: 'u' };
    const rec = nextRecord({ existing: prev, patch: { nextAction: '次の一手' }, nowIso: 't', userId: 'u2' });
    expect(rec).toMatchObject({ result: '成果', issue: '古い課題', nextAction: '次の一手' });
  });

  it('課題・次の行動が上限を超えると書き込まない', () => {
    const long = 'あ'.repeat(NOTE_MAX + 1);
    expect(checkProgressPatch({ actionKey: 'k', allowedKeys: ['k'], patch: { issue: long }, okrIds: [] }).ok).toBe(false);
    expect(checkProgressPatch({ actionKey: 'k', allowedKeys: ['k'], patch: { nextAction: long }, okrIds: [] }).ok).toBe(false);
    expect(checkProgressPatch({ actionKey: 'k', allowedKeys: ['k'], patch: { issue: '短い' }, okrIds: [] }).ok).toBe(true);
  });

  it('課題だけの変更も、変更ありとして比べる', () => {
    const prev: ActionProgressRecord = { status: 'DONE', result: '', issue: '', nextAction: '', krIds: [], updatedAt: 'a', updatedBy: 'u' };
    expect(sameProgress(prev, { ...prev, issue: '新しい課題' })).toBe(false);
  });
});
