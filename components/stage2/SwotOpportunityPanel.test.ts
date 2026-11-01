import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SwotOpportunityPanel, type SwotOpportunityPanelProps } from './SwotOpportunityPanel';
import { buildCandidatePool, candidateIdOf, emptySelection, selectCandidate, type PoolCandidate } from '@/lib/swot/candidatePool';
import { GROUP_LABEL_JA, VIEWPOINT_LABEL_JA, type DiscoveryViewpoint, type OpportunityGroup } from '@/lib/swot/opportunityGroups';

type Opp = {
  text: string;
  group?: OpportunityGroup;
  viewpoint?: DiscoveryViewpoint;
  origin?: 'initial' | 'extension';
  sourceIndex?: number | null;
};

/** 画面に渡す形（候補プール・選択・根拠を含む）を、実際の保存形式で組み立てる */
function suggestionsOf(opps: Opp[], selectedTexts: string[] = [], sources: { index: number; url: string; title: string }[] = []) {
  const insights = opps.map((o) => ({
    text: o.text,
    basis: 'hypothesis' as const,
    evidence: '',
    sourceIndex: o.sourceIndex ?? null,
    ...(o.group ? { group: o.group } : {}),
    ...(o.viewpoint ? { viewpoint: o.viewpoint } : {}),
    ...(o.origin ? { origin: o.origin } : {}),
  }));
  const pool = buildCandidatePool({
    opportunity: opps.map((o) => o.text),
    threat: [],
    insights: { opportunity: insights, threat: [] },
    sources: sources.map((x) => ({ ...x, retrievedAt: '2026-10-31T00:00:00.000Z' })),
  } as never);
  let selection = emptySelection();
  const now = '2026-10-31T00:00:00.000Z';
  for (const text of selectedTexts) {
    const c = pool.candidates.find((x: PoolCandidate) => x.text === text);
    if (c) selection = selectCandidate(selection, c, now);
  }
  return { opportunity: opps.map((o) => o.text), threat: [], sources, candidatePool: pool, selection };
}

function render(overrides: Partial<SwotOpportunityPanelProps> & { opps: Opp[]; selected?: string[]; sources?: { index: number; url: string; title: string }[] }) {
  const { opps, selected, sources, ...rest } = overrides;
  const props: SwotOpportunityPanelProps = {
    suggestions: suggestionsOf(opps, selected, sources),
    locked: false,
    extending: false,
    extendMessage: null,
    extendError: null,
    onExtend: () => undefined,
    onAdd: () => undefined,
    onRemove: () => undefined,
    onEdit: () => undefined,
    ...rest,
  };
  return renderToStaticMarkup(createElement(SwotOpportunityPanel, props));
}

const many = (n: number, group: OpportunityGroup | undefined, prefix: string, viewpoint?: DiscoveryViewpoint): Opp[] =>
  Array.from({ length: n }, (_, i) => ({ text: `${prefix}${i + 1}の機会が広がる可能性がある。`, group, viewpoint }));

describe('SWOT画面のパネル（モック応答による表示確認）', () => {
  it('機会を①②③の見出しで表示し、件数を数える（視点の記録が無い候補は分類未設定に分ける）', () => {
    const html = render({
      opps: [
        ...many(2, 'existing_market', 'W', 'world_change'),
        ...many(1, 'new_customer_use', 'C', 'customer_need'),
        ...many(3, 'new_region', 'I', 'industry_competition'),
        ...many(2, undefined, '過去'),
      ],
    });
    expect(html).toContain(`${VIEWPOINT_LABEL_JA.world_change}（2件）`);
    expect(html).toContain(`${VIEWPOINT_LABEL_JA.customer_need}（1件）`);
    expect(html).toContain(`${VIEWPOINT_LABEL_JA.industry_competition}（3件）`);
    expect(html).toContain('分類未設定の候補（2件）');
    expect(html).toContain('機会 8 / 30件');
  });

  it('A〜Dの内部分類は主見出しに出さない', () => {
    const html = render({ opps: many(2, 'existing_market', 'A', 'world_change') });
    expect(html).not.toContain(GROUP_LABEL_JA.existing_market);
    expect(html).not.toContain('A〜Dの件数');
    expect(html).not.toContain('PEST');
    expect(html).not.toContain('Customer');
  });

  it('脅威も①②③の分類で表示する', () => {
    const html = renderToStaticMarkup(
      createElement(SwotOpportunityPanel, {
        suggestions: {
          opportunity: ['機会が広がる可能性がある。'],
          threat: ['競合が参入する可能性がある。'],
          sources: [],
          candidatePool: buildCandidatePool({
            opportunity: ['機会が広がる可能性がある。'],
            threat: ['競合が参入する可能性がある。'],
            insights: {
              opportunity: [{ text: '機会が広がる可能性がある。', basis: 'hypothesis', evidence: '', sourceIndex: null, viewpoint: 'world_change' }],
              threat: [{ text: '競合が参入する可能性がある。', basis: 'hypothesis', evidence: '', sourceIndex: null, viewpoint: 'industry_competition' }],
            },
            sources: [],
          } as never),
        },
        locked: false,
        extending: false,
        extendMessage: null,
        extendError: null,
        onExtend: () => undefined,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined,
      })
    );
    expect(html).toContain('提案された脅威');
    expect(html).toContain(`${VIEWPOINT_LABEL_JA.industry_competition}（1件）`);
    expect(html).toContain('競合が参入する可能性がある。');
  });

  it('候補の件数が 30 件に達したら「さらに探索」を無効にし、上限を示す', () => {
    const html = render({ opps: many(30, 'existing_market', 'A', 'customer_need') });
    expect(html).toContain('機会 30 / 30件');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>さらに探索<\/button>/);
    expect(html).toContain('候補は上限（30件）に達しています');
  });

  it('候補が少ないときは「さらに探索（最大8件）」を押せる', () => {
    const html = render({ opps: many(5, 'existing_market', 'A', 'customer_need') });
    expect(html).toContain('さらに探索（最大8件）');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>さらに探索/);
  });

  it('外部の根拠が無い（過去の保存データを含む）場合も、「さらに探索」を押せる', () => {
    const html = render({ opps: many(3, 'existing_market', 'A') });
    expect(html).not.toContain('追加探索の根拠がありません');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>さらに探索/);
  });

  it('閲覧のみの場合は、追加・編集・外す・さらに探索をすべて無効にする', () => {
    const html = render({ opps: many(2, 'existing_market', 'A', 'world_change'), locked: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>追加<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>さらに探索/);
    expect(html).toContain('閲覧のみのため追加できません');
  });

  it('追加探索の結果と、失敗の表示を見せる（既存の候補は画面に残る）', () => {
    const html = render({
      opps: many(3, 'existing_market', 'A', 'world_change'),
      extendMessage: '2件を追加しました。',
      extendError: '追加探索に失敗しました。既存の候補はそのまま残っています。',
    });
    expect(html).toContain('2件を追加しました。');
    expect(html).toContain('既存の候補はそのまま残っています');
    expect(html).toContain('A1の機会が広がる可能性がある。');
  });

  it('追加探索で得た候補は「追加探索」と表示し、既存の出典があっても「参考」にとどめる', () => {
    const html = render({
      opps: [{ text: '新しい地域の機会が広がる可能性がある。', group: 'new_region', viewpoint: 'world_change', origin: 'extension', sourceIndex: 1 }],
      sources: [{ index: 1, url: 'https://e.example/a', title: '既存の調査' }],
    });
    expect(html).toContain('追加探索');
    expect(html).toContain('参考出典あり（この候補の裏付けは未確認）');
    expect(html).not.toContain('出典で確認済み');
  });

  it('SWOTに追加済みの候補は「編集」「外す」を、未追加の候補は「追加」を表示する', () => {
    const texts = ['追加済みの機会が広がる可能性がある。', '未追加の機会が広がる可能性がある。'];
    const html = render({
      opps: [
        { text: texts[0], group: 'existing_market', viewpoint: 'world_change' },
        { text: texts[1], group: 'existing_market', viewpoint: 'world_change' },
      ],
      selected: [texts[0]],
    });
    expect(html).toContain('SWOTに追加済み');
    expect(html).toContain('>編集<');
    expect(html).toContain('>外す<');
    expect(html).toContain('>追加<');
    expect(candidateIdOf('opportunity', texts[0])).toMatch(/^opp_/);
  });

  it('既存データ（候補プールなし）も、機会の一覧として正しく表示する', () => {
    const html = renderToStaticMarkup(
      createElement(SwotOpportunityPanel, {
        suggestions: { opportunity: ['古い機会が広がる可能性がある。'], threat: ['古い脅威。'], sources: [] },
        locked: false,
        extending: false,
        extendMessage: null,
        extendError: null,
        onExtend: () => undefined,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onEdit: () => undefined,
      })
    );
    expect(html).toContain('古い機会が広がる可能性がある。');
    expect(html).toContain('分類未設定の候補（1件）');
    expect(html).toContain('古い脅威。');
  });
});
