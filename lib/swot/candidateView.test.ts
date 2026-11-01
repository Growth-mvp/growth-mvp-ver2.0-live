import {
  EXTEND_BATCH,
  OPPORTUNITY_CAP,
  detailRowsOf,
  evidenceViewOf,
  extendPlanOf,
  groupByViewpoint,
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

describe('①②③の分類による表示', () => {
  it('視点ごとに分け、視点の記録が無い過去の候補は推測で振り分けず、分類未設定として分ける', () => {
    const grouped = groupByViewpoint([
      cand({ text: 'w', viewpoint: 'world_change', group: 'new_region' }),
      cand({ text: 'c', viewpoint: 'customer_need', group: 'existing_market' }),
      cand({ text: 'i', viewpoint: 'industry_competition', group: 'new_business' }),
      cand({ text: 'legacy', group: 'existing_market' }),
    ]);
    expect(grouped.world_change.map((c) => c.text)).toEqual(['w']);
    expect(grouped.customer_need.map((c) => c.text)).toEqual(['c']);
    expect(grouped.industry_competition.map((c) => c.text)).toEqual(['i']);
    expect(grouped.unclassified.map((c) => c.text)).toEqual(['legacy']);
  });

  it('内部の探索グループ（A〜D）は、表示の分類に使わない', () => {
    const grouped = groupByViewpoint([cand({ text: 'x', group: 'new_customer_use' })]);
    expect(grouped.customer_need).toHaveLength(0);
    expect(grouped.unclassified.map((c) => c.text)).toEqual(['x']);
  });

  it('詳細には、内部の探索グループを参考として示す', () => {
    const rows = detailRowsOf(cand({ text: 'x', group: 'new_customer_use' }), []);
    expect(rows.find((r) => r.label === '事業展開の方向（内部の探索範囲）')?.value).toContain('B：新しい顧客・用途の可能性');
  });
});

describe('根拠の表示（確認済みと言えるのは、本文と対象が確認された場合だけ）', () => {
  it('対象が一致した出典だけを「確認済み」とする', () => {
    expect(evidenceViewOf(cand({ text: 'x', evidenceUse: 'fact', sourceUrl: 'https://e.example/a' })).kind).toBe('confirmed');
  });

  it('追加探索の候補は、既存の出典があっても確認済みにしない（参考どまり）', () => {
    const view = evidenceViewOf(
      cand({ text: 'x', origin: 'extension', sourceUrl: 'https://e.example/a', sourceIndex: 1, sourceLink: 'linked', unverified: ['source_body_not_checked'] })
    );
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

describe('本文の確認と主張の確認を分けて表示する', () => {
  const URL = 'https://e.example/a';

  it('市場の候補で本文を確認し主張が一致した場合は、未確認とせず、将来の影響を含む仮説と分けて示す', () => {
    const view = evidenceViewOf(cand({ text: 'x', basis: 'fact', sourceUrl: URL, sourceIndex: 1, sourceLink: 'linked', unverified: [] }));
    expect(view.kind).toBe('reference');
    expect(view.label).toContain('出典の本文で事実を確認');
    expect(view.label).toContain('将来の影響を含む仮説');
    expect(view.label).not.toContain('未確認');
  });

  it('本文を確認したが主張が一致しない場合は、確認していないと書かず、一致しなかったと示す', () => {
    const view = evidenceViewOf(
      cand({ text: 'x', sourceUrl: URL, sourceIndex: 1, sourceLink: 'linked', unverified: ['source_body_claim_not_matched'] })
    );
    expect(view.label).toBe('出典の本文は確認したが、主張の一致は確認できず');
  });

  it('顧客課題で課題の事実が確認済みの候補は、機会の文が将来の仮説であることを示す', () => {
    const view = evidenceViewOf(cand({ text: 'x', discoveryPath: 'customer_need', evidenceUse: 'fact', sourceUrl: URL, unverified: [] }));
    expect(view.kind).toBe('confirmed');
    expect(view.label).toContain('課題の事実は出典で確認済み');
    expect(view.label).toContain('機会の文は将来の仮説');
  });

  it('顧客課題で本文は確認済みでも対応が参考どまりなら、対応は参考どまりと示す', () => {
    const view = evidenceViewOf(cand({ text: 'x', discoveryPath: 'customer_need', evidenceUse: 'reference', sourceUrl: URL, unverified: [] }));
    expect(view.label).toBe('出典の本文は確認済み（顧客との対応は参考どまり）');
  });

  it('本文の確認の記録が無い出典は、従来どおり未確認として示す', () => {
    const view = evidenceViewOf(cand({ text: 'x', sourceUrl: URL, sourceIndex: 1, sourceLink: 'linked', unverified: ['source_body_not_checked'] }));
    expect(view.label).toBe('参考情報（出典あり・裏付けは未確認）');
  });
});
