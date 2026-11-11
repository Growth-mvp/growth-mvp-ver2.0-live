/* STAGE2 全社戦略書の実機検証用の架空データ（評価専用。DB・外部APIには接続しない） */

const body = (tag: string, n: number) =>
  `${tag}の本文です。架空の製造会社として、既存の保守サービスを軸に顧客との関係を深め、成長領域へ経営資源を集中します。`.repeat(n);

const chapters = (tag: string, n = 6) => [
  { title: '第1章：なぜ今、変わる必要があるのか', body: body(`${tag}・第1章`, n) },
  { title: '第2章：どこで、どう勝つのか', body: body(`${tag}・第2章`, n) },
  { title: '第3章：どんな未来を実現するのか', body: body(`${tag}・第3章`, n) },
  { title: '第4章：その実現に向けてどう行動するのか', body: body(`${tag}・第4章`, n) },
];

const midterm = {
  midtermConcept: '保守サービスの知見を、点検の高付加価値化へつなげる',
  targetVisionForMidterm: '顧客の設備を止めない、点検で選ばれる専門企業',
  priorityStrategicThemes: ['点検サービスの高付加価値化', '新規顧客の開拓', '原価構造の見直し'],
  companyWideDecisionCriteria: ['顧客の稼働率を高める投資を優先する', '利益を伴わない売上拡大は採らない'],
  deploymentPrinciplesForUnits: ['部門KPIは全社の目標から展開する', '現場の判断基準を全社で揃える'],
  portfolioPolicy: '保守事業は収益を維持し、点検事業へ経営資源を重点配分する',
};

const issues = [
  { title: '保守契約の解約が増えている', description: '既存顧客の保守契約の継続率が下がっている', linkedMetrics: ['継続率'], scope: 'company' as const },
];

const targets = [
  { id: 'rev', label: '売上', unit: '百万円', base: 12000, low: 11000, high: 13000, dueYear: 2029 },
  { id: 'op', label: '営業利益', unit: '百万円', base: 1500, low: 1300, high: 1700, dueYear: 2029 },
];

/** 旧データ：確定スナップショットも下書きの印も無い、従来の確定済み戦略 */
export function seedLegacyConfirmed(store: any): void {
  store.setState({
    companyName: '架空製作所株式会社',
    companyTargets: targets,
    stage1Issues: issues,
    finalStoryFinal: chapters('確定版', 6),
    finalStoryEdited: chapters('旧の編集', 2),
    finalStoryDraft: chapters('AIたたき台', 2),
    finalStory: chapters('確定版', 6),
    stage2FinalGeneratedConclusion: 'AI生成の結論（旧データ）',
    stage2FinalDocumentEdits: { conclusion: '旧データで保存済みの結論（確定時の値）' },
    midtermStrategy: midterm,
  });
}

/** 確定後に下書きを保存した直後（再読み込み相当）：確定版は旧のまま、未確定の本文と結論が保存されている */
export function seedAfterDraftSave(store: any): void {
  store.setState({
    companyName: '架空製作所株式会社',
    companyTargets: targets,
    stage1Issues: issues,
    finalStoryFinal: chapters('確定版', 6),
    finalStoryEdited: chapters('下書き本文', 2),
    finalStoryDraft: chapters('AIたたき台', 2),
    finalStory: chapters('確定版', 6),
    stage2FinalGeneratedConclusion: 'AI生成の結論（旧データ）',
    stage2FinalDocumentEdits: {
      conclusion: '下書きの結論（未確定）',
      midtermStrategy: { ...midterm, companyWideDecisionCriteria: ['下書きの判断基準（未確定）'] },
      draftChangedAt: '2026-11-11T01:00:00.000Z',
    },
    midtermStrategy: midterm,
  });
}

/** 初回確定前：確定版は無く、AIたたき台と保存済みの編集だけがある */
export function seedDraftOnly(store: any): void {
  store.setState({
    companyName: '架空製作所株式会社',
    companyTargets: targets,
    stage1Issues: issues,
    finalStoryFinal: [],
    finalStoryEdited: [],
    finalStoryDraft: chapters('AIたたき台', 2),
    finalStory: [],
    stage2FinalGeneratedConclusion: 'AI生成の結論（ドラフト）',
    stage2FinalDocumentEdits: { conclusion: '未確定の下書き結論' },
    midtermStrategy: midterm,
  });
}

/** 本文の数値が登録目標と一致せず、社内の工程名も含む（確定前の検査で知らせるべき状態） */
export function seedMismatch(store: any): void {
  const mismatchChapters = chapters('確定版', 6).map((c, i) =>
    i === 0 ? { ...c, body: `2030年度の売上130億円、営業利益5億円を目指す。STAGE3では事業別の役割を定義する。${c.body}` } : c,
  );
  store.setState({
    companyName: '架空製作所株式会社',
    companyTargets: targets,
    stage1Issues: issues,
    finalStoryFinal: [],
    finalStoryEdited: mismatchChapters,
    finalStoryDraft: chapters('AIたたき台', 2),
    finalStory: [],
    stage2FinalGeneratedConclusion: 'AI生成の結論（ドラフト）',
    stage2FinalDocumentEdits: {},
    midtermStrategy: midterm,
  });
}

/** 中計設計が生成されていない（第2パスの省略）状態。確定版はあり、中計の項目は無い */
export function seedMidtermMissing(store: any): void {
  store.setState({
    companyName: '架空製作所株式会社',
    companyTargets: targets,
    finalStoryFinal: chapters('確定版', 6),
    finalStoryEdited: chapters('確定版', 6),
    finalStoryDraft: chapters('AIたたき台', 2),
    finalStory: chapters('確定版', 6),
    stage2FinalGeneratedConclusion: 'AI生成の結論（旧データ）',
    stage2FinalDocumentEdits: { conclusion: '保存済みの結論' },
    midtermStrategy: undefined,
  });
}
