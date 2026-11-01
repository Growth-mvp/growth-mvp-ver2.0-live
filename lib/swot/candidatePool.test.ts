import {
  buildCandidatePool,
  candidateIdOf,
  candidatePoolOf,
  composeSwotSuggestions,
  editSelectedCandidate,
  emptySelection,
  parseCandidatePool,
  parseCandidateSelection,
  reconcileWithConfirmed,
  removeSelectedCandidate,
  selectCandidate,
  selectionOf,
  withoutCandidateState,
  CANDIDATE_LIMITS,
  type PoolCandidate,
} from './candidatePool';
import { appendOpportunitySuggestions } from './opportunityAppend';

const NOW = '2026-10-30T12:00:00.000Z';
const URL_1 = 'https://example.com/metal';
const URL_3 = 'https://example.com/office';

const legacy = () => ({
  opportunity: ['金属容器需要が収益改善につながる可能性がある。', '東京のオフィス賃料が上昇し収益が伸びる可能性がある。'],
  threat: ['18リットル缶の出荷が縮小する可能性がある。'],
  generatedAt: NOW,
  sources: [
    { index: 1, url: URL_1, title: 'Metal', retrievedAt: NOW },
    { index: 3, url: URL_3, title: 'Office', retrievedAt: NOW },
  ],
  insights: {
    opportunity: [
      {
        text: '金属容器需要が収益改善につながる可能性がある。',
        basis: 'fact',
        evidence: '[1]は出荷金額の増加を示している。',
        sourceIndex: 1,
      },
      {
        text: '東京のオフィス賃料が上昇し収益が伸びる可能性がある。',
        basis: 'hypothesis',
        evidence: '[3]は空室率の低下を示している。',
        sourceIndex: null,
      },
    ],
    threat: [{ text: '18リットル缶の出荷が縮小する可能性がある。', basis: 'hypothesis', evidence: '前提', sourceIndex: null }],
  },
});

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}候補${String(i + 1).padStart(2, '0')}の内容`);

describe('過去の SWOT 候補の読み込み', () => {
  it('既存の機会・脅威から候補一覧を作り、basis・evidence・sourceIndex の対応を保つ', () => {
    const pool = buildCandidatePool(legacy());
    expect(pool.candidates).toHaveLength(3);
    const [first, second, threat] = pool.candidates;
    expect(first).toMatchObject({ kind: 'opportunity', basis: 'fact', sourceIndex: 1, sourceUrl: URL_1, sourceLink: 'linked' });
    expect(first.evidence).toBe('[1]は出荷金額の増加を示している。');
    expect(second).toMatchObject({ kind: 'opportunity', basis: 'hypothesis', sourceIndex: null });
    expect(threat).toMatchObject({ kind: 'threat', basis: 'hypothesis' });
  });

  it('出典番号を示す根拠が紐づけを外れていれば cited_but_unlinked とし、確認済みとは扱わない', () => {
    const [, second] = buildCandidatePool(legacy()).candidates;
    expect(second.sourceLink).toBe('cited_but_unlinked');
    expect(second.grounding).toBe('hypothesis_with_rationale');
    expect(second.unverified).toEqual(expect.arrayContaining(['citation_not_linked', 'inference_only']));
    expect(second.unverified).not.toContain('verified');
  });

  it('紐づいた出典は本文未確認として扱う', () => {
    const [first] = buildCandidatePool(legacy()).candidates;
    expect(first.grounding).toBe('source_unverified');
    expect(first.unverified).toContain('source_body_not_checked');
  });

  it('過去形式（candidatePool が無い）でも candidatePoolOf で一覧を得られ、保存データには何も追加しない', () => {
    const old = legacy();
    const pool = candidatePoolOf(old);
    expect(pool.candidates).toHaveLength(3);
    expect(old).not.toHaveProperty('candidatePool');
  });

  it('http の出典 URL は出典として扱わない', () => {
    const src = { ...legacy(), sources: [{ index: 1, url: 'http://example.com/x', title: 'X', retrievedAt: NOW }] };
    expect(buildCandidatePool(src).candidates[0]).toMatchObject({ sourceIndex: null, sourceUrl: null });
  });
});

describe('候補 ID', () => {
  it('同じ内容は同じ ID になり、配列の並びに依存しない', () => {
    const a = buildCandidatePool(legacy());
    const reversed = legacy();
    reversed.opportunity = [...reversed.opportunity].reverse();
    const b = buildCandidatePool({ ...reversed, insights: { ...reversed.insights, opportunity: [...reversed.insights.opportunity].reverse() } });
    const idsA = a.candidates.map((c) => c.id).sort();
    const idsB = b.candidates.map((c) => c.id).sort();
    expect(idsA).toEqual(idsB);
    expect(candidateIdOf('opportunity', ' 金属 容器 ')).toBe(candidateIdOf('opportunity', '金属容器'));
  });

  it('機会と脅威で同じ文でも ID は別になる', () => {
    expect(candidateIdOf('opportunity', '同じ文')).not.toBe(candidateIdOf('threat', '同じ文'));
  });
});

describe('最大件数と重複', () => {
  it('機会30件・脅威10件を保持し、超過分は件数だけ数える', () => {
    const src = { opportunity: many('機会', 32), threat: many('脅威', 11), generatedAt: NOW };
    const pool = buildCandidatePool(src);
    expect(pool.candidates.filter((c) => c.kind === 'opportunity')).toHaveLength(CANDIDATE_LIMITS.opportunity);
    expect(pool.candidates.filter((c) => c.kind === 'threat')).toHaveLength(CANDIDATE_LIMITS.threat);
    expect(pool.dropped).toEqual({ opportunity: 2, threat: 1 });
  });

  it('同じ文は1件にまとめ、重複として数える', () => {
    const pool = buildCandidatePool({ opportunity: ['同じ機会の文です。', '同じ機会の文です。'], threat: [], generatedAt: NOW });
    expect(pool.candidates).toHaveLength(1);
    expect(pool.dropped.opportunity).toBe(1);
  });
});

describe('保存と復元', () => {
  it('新形式の候補一覧を JSON で往復させても同じ内容に戻る', () => {
    const pool = buildCandidatePool(legacy());
    const restored = parseCandidatePool(JSON.parse(JSON.stringify(pool)));
    expect(restored).toEqual(pool);
  });

  it('形式が不正な候補は読み飛ばし、件数だけ残す', () => {
    const pool = buildCandidatePool(legacy());
    const raw = JSON.parse(JSON.stringify(pool));
    raw.candidates.push({ id: 'x', kind: 'opportunity', text: '', basis: 'fact' }, { ...raw.candidates[0], sourceIndex: 'bad' });
    const restored = parseCandidatePool(raw);
    expect(restored?.candidates).toHaveLength(pool.candidates.length);
    expect(restored?.invalid).toBe(2);
  });

  it('保存済みの顧客課題の候補は、事業名（事業への対応）を保ったまま読み戻す', () => {
    const pool = buildCandidatePool(legacy());
    const raw = JSON.parse(JSON.stringify(pool));
    raw.candidates[0].segmentName = '美術缶事業';
    const restored = parseCandidatePool(raw);
    expect(restored?.candidates[0].segmentName).toBe('美術缶事業');
    expect(restored?.invalid ?? 0).toBe(0);
  });

  it('版が違う、または候補一覧が無いものは読まない', () => {
    expect(parseCandidatePool({ version: 2, candidates: [] })).toBeUndefined();
    expect(parseCandidatePool(undefined)).toBeUndefined();
  });

  it('保存済みの一覧が壊れていたら、機会・脅威から作り直して読む', () => {
    const s = { ...legacy(), candidatePool: { version: 99 } };
    expect(candidatePoolOf(s).candidates).toHaveLength(3);
  });

  it('marketCategoryIds が無い保存形式の候補も読める', () => {
    const pool = buildCandidatePool(legacy());
    const raw = JSON.parse(JSON.stringify(pool));
    for (const c of raw.candidates) delete c.marketCategoryIds;
    const restored = parseCandidatePool(raw);
    expect(restored?.candidates).toHaveLength(pool.candidates.length);
    expect(restored?.invalid).toBe(0);
  });

  it('保存済みの候補がすべて読めない場合は、機会・脅威の一覧から候補を作る（画面に何も出ないのを防ぐ）', () => {
    const s = legacy();
    const broken = JSON.parse(JSON.stringify(buildCandidatePool(s)));
    for (const c of broken.candidates) c.sourceIndex = 'bad';
    const pool = candidatePoolOf({ ...s, candidatePool: broken });
    expect(pool.candidates).toHaveLength(3);
    expect(pool.candidates.map((c) => c.text)).toEqual(buildCandidatePool(s).candidates.map((c) => c.text));
  });

  it('意図的に空にした候補一覧（読めて、不正な候補が無い）は、機会・脅威の一覧から復活させない', () => {
    const s = legacy();
    const emptied = { version: 1, generatedAt: NOW, candidates: [], dropped: { opportunity: 0, threat: 0 }, invalid: 0 };
    expect(candidatePoolOf({ ...s, candidatePool: emptied }).candidates).toHaveLength(0);
  });

  it('候補一覧が無い古い保存形式は、機会・脅威の一覧から読む', () => {
    expect(candidatePoolOf(legacy()).candidates).toHaveLength(3);
  });
});

describe('利用者が外した候補は、保存済みの一覧を読み直しても復活しない', () => {
  it('外した記録は選択の記録に残り、形式が壊れた一覧から作り直しても「追加済み」に戻らない', () => {
    const s = legacy();
    const pool = buildCandidatePool(s);
    const target = pool.candidates[0];
    let sel = selectCandidate(emptySelection(), target, NOW);
    sel = removeSelectedCandidate(sel, target.id, NOW);

    const broken = JSON.parse(JSON.stringify(pool));
    for (const c of broken.candidates) c.sourceIndex = 'bad';
    const saved = { ...s, candidatePool: broken, selection: sel };

    const reread = candidatePoolOf(saved);
    expect(reread.candidates.map((c) => c.id)).toContain(target.id);
    expect(selectionOf(saved).entries[target.id]).toMatchObject({ status: 'removed' });
  });

  it('外した候補は、保存と読み直しの後も選択の記録が removed のまま', () => {
    const s = legacy();
    const pool = buildCandidatePool(s);
    const target = pool.candidates[0];
    const sel = removeSelectedCandidate(selectCandidate(emptySelection(), target, NOW), target.id, NOW);
    const withSel = JSON.parse(JSON.stringify({ ...s, candidatePool: pool, selection: sel }));
    expect(selectionOf(withSel).entries[target.id]).toMatchObject({ status: 'removed' });
    expect(candidatePoolOf(withSel).candidates.find((c) => c.id === target.id)).toBeDefined();
  });
});

describe('選択状態（候補 ID 単位）', () => {
  const pool = buildCandidatePool(legacy());
  const [first, second] = pool.candidates as PoolCandidate[];

  it('追加・編集・削除・再追加の状態を追跡し、編集の有無を記録する', () => {
    let sel = selectCandidate(emptySelection(), first, NOW);
    expect(sel.entries[first.id]).toMatchObject({ status: 'added', edited: false, text: first.text, sourceText: first.text });

    sel = editSelectedCandidate(sel, first.id, '金属容器需要の拡大が収益を押し上げる可能性がある。', NOW);
    expect(sel.entries[first.id]).toMatchObject({ status: 'added', edited: true, sourceText: first.text });

    sel = removeSelectedCandidate(sel, first.id, NOW);
    expect(sel.entries[first.id].status).toBe('removed');

    sel = selectCandidate(sel, first, NOW);
    expect(sel.entries[first.id].status).toBe('added');
    expect(sel.entries[first.id].text).toBe(first.text);
  });

  it('未選択の候補には記録が無い。追加していない候補の編集・削除は無視する', () => {
    const sel = selectCandidate(emptySelection(), first, NOW);
    expect(sel.entries[second.id]).toBeUndefined();
    expect(editSelectedCandidate(sel, second.id, '勝手な編集', NOW)).toBe(sel);
    expect(removeSelectedCandidate(sel, second.id, NOW)).toBe(sel);
  });

  it('候補の並べ替えや再表示をしても、選択記録と出典の対応はずれない', () => {
    const sel = selectCandidate(emptySelection(), second, NOW);
    const reordered = { ...pool, candidates: [...pool.candidates].reverse() };
    const again = reordered.candidates.find((c) => c.id === second.id);
    expect(again).toMatchObject({ text: second.text, sourceLink: 'cited_but_unlinked', evidence: second.evidence });
    expect(sel.entries[second.id].text).toBe(second.text);
  });

  it('確定 SWOT の行と照合し、消えた候補は削除と記録し、行だけの文は手入力として返す', () => {
    const sel = selectCandidate(emptySelection(), first, NOW);
    const { selection, manualLines } = reconcileWithConfirmed(sel, 'opportunity', ['自社で書いた機会'], NOW);
    expect(selection.entries[first.id].status).toBe('removed');
    expect(manualLines).toEqual(['自社で書いた機会']);
  });

  it('選択記録は、形式が不正なものや鍵と候補 ID が一致しないものを読まない', () => {
    const parsed = parseCandidateSelection({
      version: 1,
      entries: {
        opp_a: { candidateId: 'opp_b', kind: 'opportunity', status: 'added', text: '文', sourceText: '文', edited: false, updatedAt: NOW },
        opp_c: { candidateId: 'opp_c', kind: 'opportunity', status: 'added', text: '文', sourceText: '文', edited: false, updatedAt: NOW },
      },
    });
    expect(Object.keys(parsed?.entries ?? {})).toEqual(['opp_c']);
  });
});

describe('再生成時の合成', () => {
  it('新しい候補で置き換えても、選択記録は引き継ぐ', () => {
    const prev = { ...legacy(), candidatePool: buildCandidatePool(legacy()) };
    const sel = selectCandidate(emptySelection(), prev.candidatePool.candidates[0], NOW);
    const next = composeSwotSuggestions({ ...prev, selection: sel }, { ...legacy(), opportunity: ['別の新しい機会の文です。'], insights: undefined });
    expect(next.candidatePool.candidates.map((c) => c.text)).toEqual([
      '別の新しい機会の文です。',
      '18リットル缶の出荷が縮小する可能性がある。',
    ]);
    expect(next.selection?.entries[prev.candidatePool.candidates[0].id]).toMatchObject({ status: 'added' });
  });

  it('空の候補で、既存の候補・選択記録を上書きしない', () => {
    const prev = { ...legacy(), selection: selectCandidate(emptySelection(), buildCandidatePool(legacy()).candidates[0], NOW) };
    const kept = composeSwotSuggestions(prev, { opportunity: [], threat: [], generatedAt: NOW });
    expect(kept).toBe(prev);
  });

  it('引き継ぐ選択記録が壊れていれば、空の記録として扱う', () => {
    const next = composeSwotSuggestions({ ...legacy(), selection: { version: 9 } }, legacy());
    expect(next.selection).toBeUndefined();
    expect(selectionOf(next)).toEqual(emptySelection());
  });
});

describe('ペイロード', () => {
  it('候補の一覧と選択記録を取り除き、AI提案の文だけを残す。元のオブジェクトは変えない', () => {
    const src = composeSwotSuggestions(undefined, legacy());
    const payload = withoutCandidateState(src)!;
    expect(payload).not.toHaveProperty('candidatePool');
    expect(payload).not.toHaveProperty('selection');
    expect(payload.opportunity).toEqual(src.opportunity);
    expect(src).toHaveProperty('candidatePool');
  });
});

describe('根拠の対応は本文の一致だけで決まる（位置では対応づけない）', () => {
  const X = '需要Xが拡大する可能性がある。';
  const Y = '需要Yが拡大する可能性がある。';
  const Z = '需要Zが拡大する可能性がある。';
  const insX = { text: X, group: 'existing_market', viewpoint: 'world_change', basis: 'hypothesis', evidence: 'Xの根拠', sourceIndex: null };
  const insY = { text: Y, group: 'new_region', viewpoint: 'customer_need', basis: 'hypothesis', evidence: 'Yの根拠', sourceIndex: null };
  const insZ = { text: Z, group: 'new_business', viewpoint: 'industry_competition', basis: 'hypothesis', evidence: 'Zの根拠', sourceIndex: null };

  /** candidateIdOf が衝突する2つの文（決定的に探す） */
  function findIdCollision(): [string, string] {
    const seen = new Map<string, string>();
    for (let i = 0; i < 2_000_000; i++) {
      const t = `衝突確認の文${i}です。`;
      const id = candidateIdOf('opportunity', t);
      const prev = seen.get(id);
      if (prev !== undefined) return [prev, t];
      seen.set(id, t);
    }
    throw new Error('衝突が見つからなかった');
  }

  it('同一本文の記録が複数あれば、最初のものを使う（候補の本文と同じ順序で対応する）', () => {
    const pool = buildCandidatePool({
      opportunity: [X],
      threat: [],
      insights: {
        opportunity: [
          { ...insX, evidence: '一つ目の根拠' },
          { ...insX, evidence: '二つ目の根拠' },
        ],
        threat: [],
      },
    });
    expect(pool.candidates[0].evidence).toBe('一つ目の根拠');
  });

  it('旧データ（insights が無い）の候補は、根拠の記録なしとして読む（別の候補の属性は付かない）', () => {
    const pool = buildCandidatePool({ opportunity: [X, Y], threat: [] });
    expect(pool.candidates.map((c) => c.evidence)).toEqual(['', '']);
    expect(pool.candidates.every((c) => c.group === undefined && c.origin === undefined)).toBe(true);
  });

  it('新旧が混在しても、本文が一致する記録だけを付ける（記録の並びが本文と違っていても）', () => {
    const pool = buildCandidatePool({ opportunity: [X, Y, Z], threat: [], insights: { opportunity: [insZ, insX], threat: [] } });
    expect(pool.candidates.find((c) => c.text === X)?.evidence).toBe('Xの根拠');
    expect(pool.candidates.find((c) => c.text === Y)?.evidence).toBe('');
    expect(pool.candidates.find((c) => c.text === Z)?.group).toBe('new_business');
  });

  it('候補の本文が変わっていても（記録は元の本文のまま）、元の根拠は別の候補へ付かない', () => {
    const pool = buildCandidatePool({ opportunity: ['編集後の本文です。'], threat: [], insights: { opportunity: [insX], threat: [] } });
    expect(pool.candidates[0]).toMatchObject({ text: '編集後の本文です。', evidence: '' });
    expect(pool.candidates[0].group).toBeUndefined();
  });

  it('確定 SWOT の行を編集しても（選択記録の文が変わっても）、候補の根拠は変わらない', () => {
    const base = { opportunity: [X], threat: [], insights: { opportunity: [insX], threat: [] } };
    const cand = buildCandidatePool(base).candidates[0];
    const sel = editSelectedCandidate(selectCandidate(emptySelection(), cand, NOW), cand.id, '確定後に書き換えた文です。', NOW);
    const s = composeSwotSuggestions({ ...base, selection: sel }, base);
    expect(s.candidatePool.candidates[0]).toMatchObject({ id: cand.id, evidence: 'Xの根拠', group: 'existing_market' });
    expect(parseCandidateSelection(s.selection)?.entries[cand.id].text).toBe('確定後に書き換えた文です。');
  });

  it('候補 ID が衝突する別の文の記録は、流用しない（本文が一致しないため）', () => {
    const [a, b] = findIdCollision();
    expect(candidateIdOf('opportunity', a)).toBe(candidateIdOf('opportunity', b));
    const pool = buildCandidatePool({
      opportunity: [a],
      threat: [],
      insights: { opportunity: [{ ...insX, text: b, evidence: 'bの根拠' }], threat: [] },
    });
    expect(pool.candidates[0]).toMatchObject({ text: a, evidence: '' });
    expect(pool.candidates[0].group).toBeUndefined();
  });

  it('候補 ID が衝突する2件目は、重複として数える（既存の挙動。別の候補の根拠は付けない）', () => {
    const [a, b] = findIdCollision();
    const pool = buildCandidatePool({
      opportunity: [a, b],
      threat: [],
      insights: { opportunity: [{ ...insX, text: a }, { ...insY, text: b }], threat: [] },
    });
    expect(pool.candidates).toHaveLength(1);
    expect(pool.candidates[0].evidence).toBe('Xの根拠');
    expect(pool.dropped.opportunity).toBe(1);
  });

  it('旧データに追加探索した結果は、保存して読み戻しても同じ内容になる', () => {
    const prev = { opportunity: [X], threat: [], generatedAt: NOW, sources: [{ index: 1, url: URL_1, title: 'Metal', retrievedAt: NOW }] };
    const next = appendOpportunitySuggestions(prev, [
      { text: Y, group: 'new_region', viewpoint: 'world_change', basis: 'hypothesis', evidence: 'Yの根拠', sourceIndex: 1, origin: 'extension' },
    ]);
    const restored = parseCandidatePool(JSON.parse(JSON.stringify(next.candidatePool)));
    expect(restored).toEqual(next.candidatePool);
    expect(restored?.candidates.find((c) => c.text === Y)).toMatchObject({ origin: 'extension', group: 'new_region', sourceUrl: URL_1 });
    expect(restored?.candidates.find((c) => c.text === X)).toMatchObject({ evidence: '', sourceUrl: null });
  });

  it('既に保存された誤対応の候補一覧は、読み出しでは自動修復しない', () => {
    const wrong = buildCandidatePool({ opportunity: [X], threat: [], insights: { opportunity: [{ ...insY, text: X }], threat: [] } });
    const stored = { opportunity: [X], threat: [], candidatePool: JSON.parse(JSON.stringify(wrong)), insights: { opportunity: [insX], threat: [] } };
    expect(candidatePoolOf(stored).candidates[0].group).toBe('new_region');
  });

  it('保存のたびの再構成は、本文の一致で根拠を付け直す（根拠の記録に基づく。推測では直さない）', () => {
    const wrong = buildCandidatePool({ opportunity: [X], threat: [], insights: { opportunity: [{ ...insY, text: X }], threat: [] } });
    const s = composeSwotSuggestions({ candidatePool: wrong } as never, { opportunity: [X], threat: [], insights: { opportunity: [insX], threat: [] } });
    expect(s.candidatePool.candidates[0]).toMatchObject({ group: 'existing_market', evidence: 'Xの根拠' });
  });
});

describe('出典の本文の確認状態（確認したこと・一致したこと・確認していないこと）', () => {
  const T = '市場の需要が拡大する可能性がある。';
  const insight = { text: T, group: 'existing_market', viewpoint: 'world_change', basis: 'fact', evidence: '[1]の数値', sourceIndex: 1 };
  const src = (over: Record<string, unknown>) => [{ index: 1, url: URL_1, title: 'Metal', retrievedAt: NOW, ...over }];
  const unverifiedOfWith = (sources: unknown[]) =>
    buildCandidatePool({ opportunity: [T], threat: [], sources, insights: { opportunity: [insight], threat: [] } }).candidates[0].unverified;

  it('本文を確認し主張が一致した出典は、未確認と記録しない', () => {
    expect(unverifiedOfWith(src({ contentVerified: true, bodyCheck: 'matched' }))).not.toContain('source_body_not_checked');
  });

  it('本文を確認したが主張が一致しない出典は、本文は確認済みでも主張は未確認と記録する', () => {
    const u = unverifiedOfWith(src({ contentVerified: false, bodyCheck: 'not_matched' }));
    expect(u).toContain('source_body_claim_not_matched');
    expect(u).not.toContain('source_body_not_checked');
  });

  it('確認の記録が無い旧データの出典は、安全側に本文未確認と記録する', () => {
    expect(unverifiedOfWith(src({}))).toContain('source_body_not_checked');
  });

  it('矛盾する記録（一致と書きつつ確認していない）は、確認済みとしない', () => {
    expect(unverifiedOfWith(src({ contentVerified: false, bodyCheck: 'matched' }))).toContain('source_body_not_checked');
    expect(unverifiedOfWith(src({ contentVerified: true, bodyCheck: 'not_matched' }))).toContain('source_body_claim_not_matched');
  });
});
