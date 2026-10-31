import {
  EXTEND_BATCH,
  OPPORTUNITY_CAP,
  detailRowsOf,
  evidenceViewOf,
  extendPlanOf,
  groupOpportunityCandidates,
  isSameScope,
  opportunityCandidatesOf,
} from './candidateView';
import { buildCandidatePool, type PoolCandidate } from './candidatePool';

const cand = (over: Partial<PoolCandidate> & { text: string }): PoolCandidate => ({
  id: `opp_${over.text.length}`,
  kind: 'opportunity',
  marketCategoryIds: null,
  basis: 'hypothesis',
  grounding: 'needs_research',
  evidence: '',
  sourceIndex: null,
  sourceUrl: null,
  sourceLink: 'none',
  unverified: [],
  generatedAt: '2026-10-31T00:00:00.000Z',
  ...over,
});

describe('4グループの表示', () => {
  it('グループごとに分け、分類の記録が無い過去の候補は A に入れず、分類未設定として分ける', () => {
    const grouped = groupOpportunityCandidates([
      cand({ text: 'a', group: 'existing_market' }),
      cand({ text: 'b', group: 'new_customer_use' }),
      cand({ text: 'c', group: 'new_region' }),
      cand({ text: 'd', group: 'new_business' }),
      cand({ text: 'legacy' }),
    ]);
    expect(grouped.existing_market.map((c) => c.text)).toEqual(['a']);
    expect(grouped.new_customer_use.map((c) => c.text)).toEqual(['b']);
    expect(grouped.new_region.map((c) => c.text)).toEqual(['c']);
    expect(grouped.new_business.map((c) => c.text)).toEqual(['d']);
    expect(grouped.unclassified.map((c) => c.text)).toEqual(['legacy']);
  });

  it('脅威は機会のグループに入れない', () => {
    const grouped = groupOpportunityCandidates([cand({ text: 'x', kind: 'threat' })]);
    expect(Object.values(grouped).flat()).toHaveLength(0);
  });
});

describe('根拠の表示（確認済みと言えるのは、本文と対象が確認された場合だけ）', () => {
  it('対象が一致した出典だけを「確認済み」とする', () => {
    expect(evidenceViewOf(cand({ text: 'x', evidenceUse: 'fact', sourceUrl: 'https://e.example/a' })).kind).toBe('confirmed');
  });

  it('追加探索の候補は、既存の出典があっても確認済みにしない（参考どまり）', () => {
    const view = evidenceViewOf(cand({ text: 'x', origin: 'extension', sourceUrl: 'https://e.example/a', sourceIndex: 1 }));
    expect(view.kind).toBe('reference');
    expect(view.label).toContain('裏付けは未確認');
  });

  it('対象不一致の出典は根拠にしないと表示する', () => {
    expect(evidenceViewOf(cand({ text: 'x', evidenceUse: 'mismatch', sourceUrl: 'https://e.example/a' })).kind).toBe('mismatch');
  });

  it('出典が無く根拠の記述も無い候補は、根拠のない探索仮説として示す', () => {
    const view = evidenceViewOf(cand({ text: 'x' }));
    expect(view.kind).toBe('hypothesis');
    expect(view.label).toContain('根拠は示していない');
  });
});

describe('詳細（記録のある項目だけを表示し、無い項目は記録なしにする）', () => {
  it('市場動向から生まれた候補は、顧客課題の項目を勝手に埋めない', () => {
    const rows = detailRowsOf(cand({ text: 'x' }), []);
    const value = (label: string) => rows.find((r) => r.label === label)?.value ?? null;
    expect(value('対象顧客・利用者')).toBeNull();
    expect(value('顧客が実現したい成果')).toBeNull();
    expect(value('自社の能力との接点')).toBeNull();
  });

  it('顧客課題の候補は、対象事業・対象顧客・課題・成果・価値・接点を記録どおり表示する', () => {
    const rows = detailRowsOf(
      cand({
        text: 'x',
        segmentName: '美術缶事業',
        whoLabel: '食品メーカーの購買担当',
        payer: 'direct_customer',
        targetNeed: '限定品の包装が訴求に十分でない',
        desiredOutcome: '限定性を伝えたい',
        valueShift: '価格から体験へ',
        purchaseImpact: '包装仕様の採用',
        companyLink: '装飾技術',
        unverified: ['breadth', 'payer'],
      }),
      []
    );
    const value = (label: string) => rows.find((r) => r.label === label)?.value ?? null;
    expect(value('対象事業')).toBe('美術缶事業');
    expect(value('対象顧客・利用者')).toBe('食品メーカーの購買担当');
    expect(value('対価を払う主体')).toBe('直接顧客');
    expect(value('顧客が実現したい成果')).toBe('限定性を伝えたい');
    expect(value('自社の能力との接点')).toBe('装飾技術');
    expect(value('未確認事項')).toContain('課題が広く観察されるかは未確認');
  });

  it('出典は、番号に対応する出典のタイトルと URL を示す', () => {
    const rows = detailRowsOf(
      cand({ text: 'x', sourceIndex: 2, sourceUrl: 'https://e.example/b', evidence: '根拠の文' }),
      [{ index: 2, title: '調査B', url: 'https://e.example/b' }]
    );
    const value = rows.find((r) => r.label === '出典・参考情報')?.value ?? '';
    expect(value).toContain('調査B');
    expect(value).toContain('https://e.example/b');
    expect(value).toContain('根拠の文');
  });
});

describe('「さらに探索」を押せるか（上限・二重実行・閲覧のみ・根拠）', () => {
  const base = { count: 10, busy: false, locked: false };

  it('通常は、最大8件の追加を許可する', () => {
    expect(extendPlanOf(base)).toEqual({ enabled: true, batch: EXTEND_BATCH, reason: null });
  });

  it('残りが8件未満なら、残りの件数だけを追加する', () => {
    expect(extendPlanOf({ ...base, count: OPPORTUNITY_CAP - 3 }).batch).toBe(3);
  });

  it('30件に到達したら無効にし、理由を示す', () => {
    const plan = extendPlanOf({ ...base, count: OPPORTUNITY_CAP });
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toContain('上限');
  });

  it('実行中は無効にする（二重送信を防ぐ）', () => {
    expect(extendPlanOf({ ...base, busy: true }).enabled).toBe(false);
  });

  it('閲覧のみのユーザーには無効にする', () => {
    expect(extendPlanOf({ ...base, locked: true }).enabled).toBe(false);
  });

  it('外部の根拠が無くても、社内情報と既存の候補から追加探索できる', () => {
    expect(extendPlanOf(base).enabled).toBe(true);
  });
});

describe('会社・戦略の一致（古い応答が別の候補を上書きしない）', () => {
  it('同じ会社・同じ戦略なら反映してよい', () => {
    expect(isSameScope({ companyId: 'c1', strategyId: 's1' }, { companyId: 'c1', strategyId: 's1' })).toBe(true);
  });

  it('会社または戦略が変わっていたら反映しない', () => {
    expect(isSameScope({ companyId: 'c1', strategyId: 's1' }, { companyId: 'c2', strategyId: 's1' })).toBe(false);
    expect(isSameScope({ companyId: 'c1', strategyId: 's1' }, { companyId: 'c1', strategyId: 's2' })).toBe(false);
  });

  it('会社が未設定のときは反映しない', () => {
    expect(isSameScope({ companyId: null, strategyId: null }, { companyId: null, strategyId: null })).toBe(false);
  });
});

describe('過去の保存データ（候補プールが無い場合）', () => {
  it('機会の一覧だけの古いデータも、機会の候補として読める', () => {
    const list = opportunityCandidatesOf({ opportunity: ['古い機会。'], threat: [], insights: { opportunity: [], threat: [] } });
    expect(list.map((c) => c.text)).toEqual(['古い機会。']);
    expect(buildCandidatePool({ opportunity: ['古い機会。'] } as never).candidates).toHaveLength(1);
  });
});
