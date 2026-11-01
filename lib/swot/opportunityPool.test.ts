import {
  BODY_CHECK_MS,
  ANALYSIS_RESERVE_MS,
  EXPANSION_BATCH_MAX,
  MAX_OPPORTUNITIES,
  appendOpportunitySuggestions,
  buildExpansionInstructions,
  mergeOpportunities,
  parseExpansionItems,
  planBodyCheck,
} from './opportunityPool';
import { OPPORTUNITY_GROUPS, type OpportunityGroup } from './opportunityGroups';
import { buildCandidatePool, parseCandidatePool, selectCandidate, selectionOf } from './candidatePool';
import type { OtItem } from './generateOt';

const item = (text: string, group: OpportunityGroup = 'existing_market', over: Partial<OtItem> = {}): OtItem => ({
  text,
  group,
  basis: 'hypothesis',
  evidence: '',
  sourceIndex: null,
  ...over,
});

const TOPICS = [
  '地方の食品工場', '病院の検査室', '大学の研究室', '物流の冷蔵倉庫', '自治体の防災備蓄', '観光地の土産店',
  '保育園の給食室', '農業の集出荷場', '建設現場の仮設事務所', '美術館のミュージアムショップ', '中小の塗装工場', '海外の飲料メーカー',
  '賃貸住宅の管理会社', '介護施設の厨房', '地域の酒蔵', '学校の理科教材室', '鉄道会社の車両基地', '港湾の危険物倉庫',
  '映画館の売店', '化粧品の詰め替え工場', '温浴施設の設備室', '医薬品の物流センター', '再生可能エネルギーの施工会社', '書店の在庫管理',
  '屋外イベントの運営会社', '漁業の加工場', '空港のテナント店舗', '都市部のシェアオフィス', '老舗和菓子店の包装', '災害派遣の物資拠点',
];
const TAILS = [
  '保管の手間を減らす道具に関心が集まる可能性がある。',
  '温度管理の精度を求める声が強まる可能性がある。',
  '小口の発注に応じる仕組みが求められる可能性がある。',
  '廃棄物を減らす包装への要望が増える可能性がある。',
  '地場の原料を使った製品が選ばれる可能性がある。',
  '夜間の作業を減らす設備の導入が進む可能性がある。',
];
const many = (n: number, group: OpportunityGroup = 'existing_market', offset = 0) =>
  Array.from({ length: n }, (_, i) => {
    const k = i + offset;
    return item(`${TOPICS[k % TOPICS.length]}の${TAILS[Math.floor(k / TOPICS.length) % TAILS.length]}`, group);
  });

describe('段階的な生成：時間の予算', () => {
  it('残り時間が、出典確認と分析の両方に足りるときだけ本文を確認する', () => {
    expect(planBodyCheck(BODY_CHECK_MS + ANALYSIS_RESERVE_MS)).toBe(true);
    expect(planBodyCheck(BODY_CHECK_MS + ANALYSIS_RESERVE_MS - 1)).toBe(false);
    expect(planBodyCheck(0)).toBe(false);
  });
});

describe('追加探索の結果の統合（既存を消さず、重複させず、30件を超えない）', () => {
  it('既存の候補は、順番と内容を変えずに残し、新しい候補を後ろに加える', () => {
    const existing = many(3);
    const { items, added, duplicates } = mergeOpportunities(existing, [item('新しい地域の機会が広がる可能性がある。', 'new_region')]);
    expect(items.slice(0, 3)).toEqual(existing);
    expect(items[3].text).toBe('新しい地域の機会が広がる可能性がある。');
    expect(added).toBe(1);
    expect(duplicates).toBe(0);
  });

  it('既存と同じ文、またはほぼ同じ文は重複として捨てる', () => {
    const existing = [item('工場の省人化需要が拡大する可能性がある。')];
    const { items, added, duplicates } = mergeOpportunities(existing, [
      item('工場の省人化需要が拡大する可能性がある。'),
      item('工場の省人化の需要が拡大する可能性がある。'),
      item('病院の検査需要が広がる可能性がある。', 'new_customer_use'),
    ]);
    expect(duplicates).toBe(2);
    expect(added).toBe(1);
    expect(items).toHaveLength(2);
  });

  it('上限（30件）を超える分は捨て、件数を数える。評価で候補を削除しない', () => {
    const existing = many(MAX_OPPORTUNITIES - 2, 'existing_market', 0);
    const incoming = ['アジアの冷凍食品工場', '欧州の医療機器メーカー', '中東の水処理施設', '南米の鉱山会社', '北米の再生素材業者'].map((t, i) =>
      item(`${t}に${TAILS[i]}`, 'new_region')
    );
    const { items, added, capped, duplicates } = mergeOpportunities(existing, incoming);
    expect(items).toHaveLength(MAX_OPPORTUNITIES);
    expect(added).toBe(2);
    expect(capped).toBeGreaterThan(0);
    expect(added + capped + duplicates).toBe(incoming.length);
  });

  it('既存の候補にあるグループや根拠の弱さに関係なく、既存は1件も消えない', () => {
    const existing = [item('根拠の弱い仮説の機会。', 'new_business', { basis: 'hypothesis', sourceIndex: null })];
    const { items } = mergeOpportunities(existing, []);
    expect(items).toEqual(existing);
  });
});

describe('追加探索の指示（既存と重複させず、顧客の未挙出の悩みを重点にする）', () => {
  it('既存の候補の一覧と3つの視点を含み、30件の一括生成を求めない', () => {
    const text = buildExpansionInstructions({ existing: ['既存の機会A。', '既存の機会B。'] });
    expect(text).toContain('- 既存の機会A。');
    expect(text).toContain('同じ市場の言い換え');
    expect(text).toContain('① 世の中の変化');
    expect(text).toContain('② お客様の困りごと・願い');
    expect(text).toContain('③ 業界や競争の変化');
    expect(text).toContain(`最大${EXPANSION_BATCH_MAX}件`);
    expect(text).not.toContain('30件');
  });

  it('顧客の未挙出の悩み・望む成果を重点にし、件数の少なさで探索を誘導しない', () => {
    const text = buildExpansionInstructions({ existing: [] });
    expect(text).toContain('既存の候補にまだ挙がっていない');
    expect(text).toContain('件数の少ない分類を埋めるために探すことはしない');
    expect(text).toContain('（なし）');
  });

  it('社内情報だけでも、具体的な顧客の困りごとは探索仮説として出してよいと指示する', () => {
    const text = buildExpansionInstructions({ existing: [] });
    expect(text).toContain('出典が無くても、社内情報から具体的に考えられる顧客の困りごと');
    expect(text).toContain('架空の出典・数値を作らない');
  });

  it('既存の候補と同じ課題の言い換え、既存サービスの再提案、地域の上限化を避けるよう指示する', () => {
    const text = buildExpansionInstructions({ existing: [] });
    expect(text).toContain('「一貫して支援する」「統合する」');
    expect(text).toContain('既存のサービスをそのまま提供するだけの提案は、新規事業（new_business）や新しい顧客・用途として挙げない');
    expect(text).toContain('現在の事業展開地域は参考情報であり、探索範囲の上限ではない');
    expect(text).toContain('探索対象は既存の顧客・市場に限らない');
  });
});

describe('追加探索の出力の検査', () => {
  it('グループが不明な項目は捨て、出典番号が無効なら出典だけを外して仮説にする', () => {
    const items = parseExpansionItems(
      {
        opportunities: [
          { text: '正しい候補。', group: 'new_region', basis: 'fact', evidence: '[1]', sourceIndex: 1 },
          { text: 'グループ不明。', group: 'E', basis: 'hypothesis', evidence: '', sourceIndex: null },
          { text: '出典番号が無効。', group: 'existing_market', basis: 'fact', evidence: '', sourceIndex: 9 },
          { text: '', group: 'new_business', basis: 'hypothesis', evidence: '', sourceIndex: null },
        ],
      },
      2
    );
    expect(items.map((i) => i.text)).toEqual(['正しい候補。', '出典番号が無効。']);
    expect(items[0]).toMatchObject({ group: 'new_region', basis: 'hypothesis', sourceIndex: 1, origin: 'extension' });
    expect(items[1]).toMatchObject({ basis: 'hypothesis', sourceIndex: null });
  });

  it('1回の追加で増やす件数は上限（8件）まで。一括で大量の候補を受け入れない', () => {
    const raw = { opportunities: Array.from({ length: 20 }, (_, i) => ({ text: `候補${i + 1}。`, group: 'existing_market', basis: 'hypothesis', evidence: '', sourceIndex: null })) };
    expect(parseExpansionItems(raw, 0)).toHaveLength(EXPANSION_BATCH_MAX);
  });

  it('視点の記録は、正しい値だけを残す（不明な値は分類未設定のまま）', () => {
    const items = parseExpansionItems(
      {
        opportunities: [
          { text: '顧客の悩み。', group: 'existing_market', viewpoint: 'customer_need', basis: 'hypothesis', evidence: '', sourceIndex: null },
          { text: '視点が不明。', group: 'new_region', viewpoint: '別物', basis: 'hypothesis', evidence: '', sourceIndex: null },
        ],
      },
      0
    );
    expect(items[0]).toMatchObject({ viewpoint: 'customer_need' });
    expect(items[1].viewpoint).toBeUndefined();
  });

  it('形式が不正な出力は、候補を作らない', () => {
    expect(parseExpansionItems({ nothing: true }, 0)).toEqual([]);
    expect(parseExpansionItems('not an object', 0)).toEqual([]);
  });
});

describe('候補への反映（選択・既存の候補を保つ）', () => {
  it('追加した候補は既存の候補の後ろに加わり、既に選択した候補の選択は残る', () => {
    const prev = {
      generatedAt: '2026-10-31T00:00:00.000Z',
      opportunity: ['既存の機会一。', '既存の機会二。'],
      threat: ['脅威一。'],
      insights: { opportunity: [], threat: [] },
      sources: [],
    };
    const first = buildCandidatePool(prev as never);
    const picked = first.candidates[0];
    const withSelection = { ...prev, selection: selectCandidate(selectionOf({}), picked, '2026-10-31T00:00:00.000Z') };

    const next = appendOpportunitySuggestions(withSelection as never, [item('新しい地域の機会。', 'new_region')]);
    expect(next.opportunity).toEqual(['既存の機会一。', '既存の機会二。', '新しい地域の機会。']);
    const pool = parseCandidatePool((next as { candidatePool?: unknown }).candidatePool);
    expect(pool?.candidates.filter((c) => c.kind === 'opportunity').map((c) => c.text)).toEqual(['既存の機会一。', '既存の機会二。', '新しい地域の機会。']);
    expect(selectionOf(next as never).entries[picked.id]).toMatchObject({ status: 'added' });
    expect(next.threat).toEqual(['脅威一。']);
  });

  it('何も追加されなければ、元の候補をそのまま返す（確定 SWOT の本文には触れない）', () => {
    const prev = { opportunity: ['既存の機会一。'], threat: [], insights: { opportunity: [], threat: [] }, sources: [] };
    expect(appendOpportunitySuggestions(prev as never, [item('既存の機会一。')])).toBe(prev);
  });

  it('グループは候補の保存形式に残り、読み直しても保たれる', () => {
    const pool = buildCandidatePool({
      opportunity: ['B の機会。'],
      insights: { opportunity: [{ text: 'B の機会。', basis: 'hypothesis', evidence: '', sourceIndex: null, group: 'new_customer_use' }], threat: [] },
      sources: [],
    } as never);
    expect(pool.candidates[0].group).toBe('new_customer_use');
    expect(parseCandidatePool(JSON.parse(JSON.stringify(pool)))?.candidates[0].group).toBe('new_customer_use');
  });

  it('視点は候補の保存形式に残り、読み直しても保たれる。視点の記録が無い旧候補は分類未設定のまま', () => {
    const pool = buildCandidatePool({
      opportunity: ['新しい視点の機会。', '旧の機会。'],
      insights: {
        opportunity: [
          { text: '新しい視点の機会。', basis: 'hypothesis', evidence: '', sourceIndex: null, group: 'new_region', viewpoint: 'world_change' },
          { text: '旧の機会。', basis: 'hypothesis', evidence: '', sourceIndex: null },
        ],
        threat: [],
      },
      sources: [],
    } as never);
    const reloaded = parseCandidatePool(JSON.parse(JSON.stringify(pool)));
    expect(reloaded?.candidates[0].viewpoint).toBe('world_change');
    expect(reloaded?.candidates[1].viewpoint).toBeUndefined();
    expect(reloaded?.candidates[1].group).toBeUndefined();
  });

  it('グループの定義は4つだけ', () => {
    expect(OPPORTUNITY_GROUPS).toEqual(['existing_market', 'new_customer_use', 'new_region', 'new_business']);
  });
});
