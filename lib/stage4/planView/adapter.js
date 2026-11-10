// 実行計画書の表示データへの変換（独立UI試作 design/stage4-plan-prototype/adapter.js を本体向けに移植）。
// 純粋関数のみ。入力（bundle）は変更しない。利用者の編集は edits（キー→値）として重ねる。

const BASIS = {
  STAGE_DATA: { label: '入力どおり', tone: 'src' },
  DERIVED: { label: '入力から計算', tone: 'src' },
  HYPOTHESIS: { label: '仮説', tone: 'hyp' },
  PROPOSAL: { label: 'AI草案', tone: 'ai' },
  UNCONFIRMED: { label: '未確認', tone: 'miss' },
  AI_PROVISIONAL: { label: 'AIの仮の値', tone: 'ai' },
};
const KPI_KIND = {
  CUSTOMER_OUTCOME: '顧客の成果',
  COMPANY_RESULT: '自社の業績',
  LEADING: '途中の確認（先行指標）',
  UNCLASSIFIED: '確定済み',
};
const FIN_DIRECTION = {
  REVENUE_UP: '売上が増える',
  COST_REDUCTION: '費用が減る',
  COST_INCREASE: '費用が増える',
  NOT_FINANCIAL: '財務効果として扱わない（確認事項）',
};
const METHOD_JA = {
  FUNNEL: '商談数 × 受注率 × 平均受注額',
  QUANTITY_UNIT_PRICE: '数量 × 単価',
  DIRECT_AMOUNT: '金額を直接入力する方式',
  FREE: '算定式なし（考え方だけを示す）',
};
const AMOUNT_BASIS_JA = { TOTAL: '期間合計', ANNUAL: '年額', MONTHLY: '月額' };
const SECTION_TITLES = [
  '1. 何を実現するのか',
  '2. 何をするのか',
  '3. どんな成果を目指すのか',
  '4. 売上・利益にどうつながるのか',
  '5. 誰が・どんな条件で進めるのか',
];
const MAX_PRIORITY = 3;
// 障害は件数の上限を持たず（データは最大8件）、画面では重要度の高い3件を優先表示し、残りを詳細に入れる
const PRIMARY_OBSTACLES = 3;

const R = (re, dest, how, note) => ({ re, dest, how, note: note || '' });
// 表示への対応表（上から順に最初に一致したものを使う）。how:
//  SHOWN=本文に表示 / DETAIL=「詳しく見る」に表示 / BADGE=状態の印として表示 / TRANSLATED=ID・記号を人の言葉に変えて表示
//  LINK=他の項目への参照として使う（参照先の内容を表示） / INTERNAL=内部用（利用者には出さない・理由を note に記載） / MEMO=開発確認用メモ
const RULES = [
  R(/^period\.startYm$/, 'ヘッダーの計画期間', 'SHOWN'),
  R(/^period\.endYm$/, 'ヘッダーの計画期間', 'SHOWN'),
  R(/^period\.basis$/, 'ヘッダーの期間の根拠', 'TRANSLATED', 'AI_PROVISIONAL等を日本語の根拠に変換'),
  R(/^section1\.companyResult\.text$/, '4. 売上・利益（自社の業績）', 'SHOWN', '顧客の成果と分けて4に置く'),
  R(/^section1\.(customerProblem|problemCause|ourValue|whyChosen|customerOutcome|goalState)\.text$/, '1. 何を実現するのか', 'SHOWN'),
  R(/^section1\.companyResult\.basis$/, '4. 売上・利益の状態印', 'BADGE'),
  R(/^section1\.(customerProblem|problemCause|ourValue|whyChosen|customerOutcome|companyResult|goalState)\.basis$/, '各項目の状態印', 'TRANSLATED', 'basisを「入力どおり／仮説／AI草案」等に変換'),
  R(/^section1\.obstacles\[\]\.text$/, '1. 妨げている要因', 'SHOWN'),
  R(/^section1\.obstacles\[\]\.basis$/, '妨げている要因の状態印', 'TRANSLATED'),
  R(/^section1\.obstacles\[\]\.verifyBy$/, '妨げている要因の「確かめ方」', 'DETAIL'),
  R(/^section1\.[a-zA-Z]+\.sourceRefs\[\]$/, '各項目の根拠（詳しく見る）', 'TRANSLATED', '参照IDを入力の見出しに変換'),
  R(/^section1\.obstacles\[\]\.sourceRefs\[\]$/, '妨げている要因の根拠（詳しく見る）', 'TRANSLATED'),
  R(/^section2\.actions\[\]\.order$/, '2. 行動の番号', 'SHOWN'),
  R(/^section2\.actions\[\]\.title$/, '2. 行動の見出し', 'SHOWN'),
  R(/^section2\.actions\[\]\.ownerRole$/, '2. 行動の担当', 'SHOWN'),
  R(/^section2\.actions\[\]\.dueYm$/, '2. 行動の期限', 'SHOWN'),
  R(/^section2\.actions\[\]\.dependsOn\[\]$/, '2. 先に行う行動', 'TRANSLATED', '行動番号を「N番目の後」に変換'),
  R(/^section2\.actions\[\]\.basis$/, '2. 行動の状態印', 'TRANSLATED'),
  R(/^section2\.actions\[\]\.sourceRefs\[\]$/, '2. 根拠（詳しく見る）', 'TRANSLATED', '参照IDを入力の見出しに変換'),
  R(/^section2\.actions\[\]\.supportsKpiKeys\[\]$/, '2. 測る指標（KPI名に変換）', 'LINK'),
  R(/^section2\.actions\[\]\.mechanism$/, '2. 行動の仕組み', 'SHOWN', 'null の場合は表示上「仕組みの記載なし」'),
  R(/^section2\.actions\[\]\.mechanism\.stateChange$/, '2. 何が変わるか', 'SHOWN'),
  R(/^section2\.actions\[\]\.mechanism\.whyItMatters$/, '2. なぜ価値につながるか（詳しく見る）', 'DETAIL'),
  R(/^section2\.actions\[\]\.mechanism\.obstacleRefs\[\]$/, '2. 対応する要因（要因の内容に変換）', 'LINK'),
  R(/^section3\.protectedKpis\[\]\.key$/, 'KPIの参照キー', 'INTERNAL', '表示には使わない。KPI名で参照する'),
  R(/^section3\.protectedKpis\[\]\.stage3KpiId$/, 'KPIの内部ID', 'INTERNAL', '利用者には出さない'),
  R(/^section3\.protectedKpis\[\]\.origin$/, '確定済みの表示', 'INTERNAL', '常に「確定済み（STAGE3）」と表示するため不要'),
  R(/^section3\.protectedKpis\[\]\.kind$/, '確定済みの表示', 'INTERNAL', '確定KPIは種類を付けない（UNCLASSIFIEDのまま）'),
  R(/^section3\.protectedKpis\[\]\.label$/, '3. 指標名（確定済み）', 'SHOWN'),
  R(/^section3\.protectedKpis\[\]\.target$/, '3. 目標（確定済み）', 'SHOWN', 'null は「未設定」'),
  R(/^section3\.protectedKpis\[\]\.unit$/, '3. 目標の単位', 'SHOWN'),
  R(/^section3\.protectedKpis\[\]\.targetBasis$/, '3. 目標の根拠', 'INTERNAL', '確定KPIは常に入力どおり'),
  R(/^section3\.protectedKpis\[\]\.due$/, '3. 期限（確定済み）', 'SHOWN', 'null の場合は判定時期の入力欄を出す'),
  R(/^section3\.protectedKpis\[\]\.owner$/, '3. 担当（確定済み）', 'SHOWN'),
  R(/^section3\.protectedKpis\[\]\.measurement$/, '3. 測り方（確定済み）', 'DETAIL'),
  R(/^section3\.protectedKpis\[\]\.supportsActionOrders\[\]$/, '3. 支える行動', 'LINK'),
  R(/^section3\.proposedKpis\[\]\.key$/, 'KPIの参照キー', 'INTERNAL', '表示には使わない。行動からの参照に使う'),
  R(/^section3\.proposedKpis\[\]\.kind$/, '3. 指標の種類', 'TRANSLATED', 'CUSTOMER_OUTCOME等を日本語に変換'),
  R(/^section3\.proposedKpis\[\]\.label$/, '3. 指標名（AI提案）', 'SHOWN'),
  R(/^section3\.proposedKpis\[\]\.target$/, '3. 目標（AI提案）', 'SHOWN', 'null は「未設定」で入力欄を出す'),
  R(/^section3\.proposedKpis\[\]\.unit$/, '3. 目標の単位', 'SHOWN'),
  R(/^section3\.proposedKpis\[\]\.targetBasis$/, '3. 目標の状態印', 'TRANSLATED', 'AI_PROVISIONAL → 「AIの仮の値」'),
  R(/^section3\.proposedKpis\[\]\.due$/, '3. 期限（AI提案）', 'SHOWN'),
  R(/^section3\.proposedKpis\[\]\.owner$/, '3. 担当（AI提案）', 'SHOWN'),
  R(/^section3\.proposedKpis\[\]\.measurement$/, '3. 測り方（詳しく見る）', 'DETAIL'),
  R(/^section3\.proposedKpis\[\]\.supportsActionOrders\[\]$/, '3. 支える行動', 'LINK'),
  R(/^section3\.stage3Review\[\]\.stage3KpiId$/, '3. 確定KPIへの注意（指標名に変換）', 'LINK'),
  R(/^section3\.stage3Review\[\]\.concern$/, '3. 確定KPIへの注意', 'SHOWN'),
  R(/^section3\.stage3Review\[\]\.sourceRefs\[\]$/, '3. 注意の根拠（詳しく見る）', 'TRANSLATED'),
  R(/^section4\.financeItems\[\]\.key$/, '4. 財務項目の参照キー', 'INTERNAL', '表示には使わない'),
  R(/^section4\.financeItems\[\]\.label$/, '4. 財務項目の名前', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.kind$/, '4. 増減の向き', 'TRANSLATED', 'REVENUE_UP等を「売上が増える」等に変換'),
  R(/^section4\.financeItems\[\]\.method$/, '4. 算定の方式', 'TRANSLATED', 'FREE等を日本語の式に変換'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.role$/, '4. 必要な入力の名前', 'TRANSLATED'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.label$/, '4. 必要な入力の名前', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.value$/, '4. 入力値（未入力は「未入力」）', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.unit$/, '4. 入力の単位', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.basis$/, '4. 入力の状態印', 'TRANSLATED'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.confirmState$/, '4. 確認の状態（AI側の値はUNCONFIRMEDのみ）', 'INTERNAL', '表示は basis の状態印に統合'),
  R(/^section4\.financeItems\[\]\.inputs\[\]\.sourceRefs\[\]$/, '4. 入力の根拠（詳しく見る）', 'TRANSLATED'),
  R(/^section4\.financeItems\[\]\.amountBasis$/, '4. 金額の単位（期間合計・年額・月額）', 'TRANSLATED'),
  R(/^section4\.financeItems\[\]\.startYm$/, '4. 効果の開始', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.endYm$/, '4. 効果の終了', 'SHOWN'),
  R(/^section4\.financeItems\[\]\.sourceNote$/, '4. 根拠の説明（詳しく見る）', 'DETAIL'),
  R(/^section4\.financeItems\[\]\.basedOnKpiKeys\[\]$/, '4. 根拠にした指標（指標名に変換）', 'LINK'),
  R(/^section4\.financeItems\[\]\.freeNote$/, '4. 算定の考え方', 'SHOWN'),
  R(/^responsibleSuggestion$/, '5. 責任者の候補（入力の担当候補）', 'SHOWN', 'AIが決めなかった場合の候補。確定ではない'),
  R(/^section3\.protectedKpis\[\]\.judgeCandidateYm$/, '3. 判定時期の候補（計画期間の終わり）', 'SHOWN', '入力に期限が無い確定KPIの判定時期の候補'),
  R(/^section5\.responsible\.name$/, '5. 責任者', 'SHOWN'),
  R(/^section5\.responsible\.basis$/, '5. 責任者の状態印', 'TRANSLATED'),
  R(/^section5\.responsible\.note$/, '5. 責任者の注記（詳しく見る）', 'DETAIL'),
  R(/^section5\.roles\[\]\.unit$/, '5. 担当部門', 'SHOWN'),
  R(/^section5\.roles\[\]\.role$/, '5. 担当の役割', 'SHOWN'),
  R(/^section5\.roles\[\]\.actionOrders\[\]$/, '5. 担当する行動', 'LINK'),
  R(/^section5\.budget$/, '5. 予算', 'SHOWN', 'null は「入力にないため未設定」'),
  R(/^section5\.risks\[\]\.risk$/, '5. 想定されるリスク', 'SHOWN'),
  R(/^section5\.risks\[\]\.countermeasure$/, '5. 対策', 'SHOWN'),
  R(/^section5\.risks\[\]\.confirmBy$/, '5. リスクの確認時期', 'SHOWN'),
  R(/^section5\.risks\[\]\.basis$/, '5. リスクの状態印', 'TRANSLATED'),
  R(/^section5\.risks\[\]\.sourceRefs\[\]$/, '5. リスクの根拠（詳しく見る）', 'TRANSLATED'),
  R(/^section5\.preconditions\[\]$/, '5. 開始前の条件（詳しく見る）', 'DETAIL', '確認事項と内容が重なるため、通常表示では出さない'),
  R(/^verificationItems\[\]\.item$/, '確認事項の本文', 'SHOWN'),
  R(/^verificationItems\[\]\.priority$/, '確認事項の優先度', 'TRANSLATED', 'BEFORE_START は「開始前に必要」'),
  R(/^verificationItems\[\]\.confirmBy$/, '確認事項の期限', 'SHOWN'),
  R(/^verificationItems\[\]\.sourceRefs\[\]$/, '確認事項の根拠（詳しく見る）', 'TRANSLATED'),
  R(/^estimates\[\]\.itemKey$/, '4. 財務項目との対応', 'LINK'),
  R(/^estimates\[\]\.status$/, '4. 金額の状態（AI参考試算／未算定）', 'TRANSLATED'),
  R(/^estimates\[\]\.amountYen$/, '4. AI参考試算の金額（円→百万円に変換して表示）', 'TRANSLATED'),
  R(/^estimates\[\]\.formula$/, '4. 試算の式（詳しく見る）', 'DETAIL'),
  R(/^estimates\[\]\.missing\[\]$/, '4. 未算定の理由', 'TRANSLATED'),
  R(/^issues\[\]\.severity$/, '開発確認メモ（重要度）', 'MEMO'),
  R(/^issues\[\]\.code$/, '開発確認メモ（コード）', 'MEMO', '利用者には出さない'),
  R(/^issues\[\]\.path$/, '開発確認メモ（位置）', 'MEMO'),
  R(/^issues\[\]\.message$/, '開発確認メモ（原文）', 'MEMO'),
  R(/^context\.sources\[\]\.ref$/, '根拠の参照キー', 'INTERNAL', '利用者には出さない。根拠の見出しに変換'),
  R(/^context\.sources\[\]\.stage$/, '根拠の出所（STAGE）', 'INTERNAL', '見出しに含めない'),
  R(/^context\.sources\[\]\.role$/, '根拠の重要度', 'INTERNAL', '表示順の判断にのみ使う'),
  R(/^context\.sources\[\]\.label$/, '根拠の見出し', 'DETAIL'),
  R(/^context\.sources\[\]\.text$/, '根拠の内容', 'DETAIL'),
  R(/^rawOutput$/, 'AI生成の元データ（表示なし・変更なし）', 'INTERNAL', 'sha256 で改変のないことを確認する'),
  R(/^rawOutputSha256$/, '元データの指紋', 'INTERNAL', '改変がないことの確認に使う（画面には出さない）'),
  R(/^section3\.stage3Review\[\]$/, '3. 確定KPIへの注意（該当なし）', 'SHOWN', '空の配列は「注意なし」として扱う'),
  R(/^issues\[\]$/, '開発確認メモ（該当なし）', 'MEMO', '空の配列は「検証の指摘なし」'),
];

function leafPaths(obj, path, out) {
  if (Array.isArray(obj)) {
    if (obj.length === 0) out.push(path + '[]');
    else obj.forEach((v) => leafPaths(v, path + '[]', out));
  } else if (obj !== null && typeof obj === 'object') {
    Object.keys(obj).forEach((k) => leafPaths(obj[k], path ? path + '.' + k : k, out));
  } else {
    out.push(path);
  }
  return out;
}

function ruleFor(path) {
  return RULES.find((r) => r.re.test(path)) || null;
}

// 元データの全ての葉（値）が、表示・詳細・内部・開発メモのいずれかに対応づけられていることを確認する
function auditMapping(bundle) {
  const sources = [
    ['plan', bundle.plan, ''],
    ['issues', bundle.issues, 'issues'],
    ['estimates', bundle.estimates, 'estimates'],
    ['context', { sources: bundle.context.sources }, 'context'],
    ['rawOutput', bundle.rawOutput, 'rawOutput'],
    ['rawOutputSha256', bundle.rawOutputSha256, 'rawOutputSha256'],
  ];
  const entries = [];
  for (const [source, value, prefix] of sources) {
    for (const leaf of leafPaths(value, prefix, [])) {
      const normalized = leaf.replace(/\[\d+\]/g, '[]');
      const rule = ruleFor(normalized);
      entries.push({
        source,
        path: leaf,
        dest: rule ? rule.dest : null,
        how: rule ? rule.how : null,
        note: rule ? rule.note : '',
      });
    }
  }
  return { entries, unmatched: entries.filter((e) => e.how === null).map((e) => e.path) };
}

// 内部の参照（S1、qg-kpi-… など）を、指標の名前に置き換える。元の文字列は変えない
function humanize(text, idLabel) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\[(S\d+-[A-Z0-9-]+)\]/g, '')
    .replace(/KPI\s?(S\d+)/g, (m, k) => (idLabel[k] ? `「${idLabel[k]}」` : m))
    .replace(/\b(S\d+)\b/g, (m, k) => (idLabel[k] ? `「${idLabel[k]}」` : m))
    .replace(/\b([qcp][gp]?-kpi-[a-z]+)\b/g, (m, id) => (idLabel[id] ? `「${idLabel[id]}」` : m))
    .replace(/勝ち筋：retention/g, '勝ち筋：定着の重視')
    .replace(/勝ち筋：new-market/g, '勝ち筋：新市場の開拓')
    .replace(/勝ち筋：existing-tech/g, '勝ち筋：既存技術の転用')
    .replace(/勝ち筋：cost-leadership/g, '勝ち筋：原価の優位性');
}

const NOT_TEXT_KEYS = new Set(['key', 'original', 'id', 'code', 'path', 'severity', 'category', 'caseId', 'ref', 'basis', 'tone', 'type', 'multiline', 'hint', 'locked', 'edited', 'readonly', 'provisional', 'outOfPeriod', 'checked', 'untargeted', 'status', 'amountYen', 'confirmedTotalYen', 'confirmedCount', 'stage', 'role']);
function humanizeDeep(value, idLabel) {
  if (Array.isArray(value)) return value.map((v) => humanizeDeep(v, idLabel));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = NOT_TEXT_KEYS.has(k) ? v : humanizeDeep(v, idLabel);
    }
    return out;
  }
  return typeof value === 'string' ? humanize(value, idLabel) : value;
}

function formatTarget(target, unit) {
  if (target === null || target === undefined) return null;
  return unit === '%' ? `${target}%` : `${target}${unit || ''}`;
}

function monthOk(ym, startYm, endYm) {
  return !!ym && ym >= startYm && ym <= endYm;
}

function toDisplayPlan(bundle, edits) {
  const plan = bundle.plan;
  const ctx = bundle.context;
  const ed = edits || {};
  const ev = (key, def) => (Object.prototype.hasOwnProperty.call(ed, key) ? ed[key] : def);
  const edited = (key) => Object.prototype.hasOwnProperty.call(ed, key);
  const evidence = (refs) =>
    (refs || [])
      .map((r) => ctx.sources.find((s) => s.ref === r))
      .filter(Boolean)
      .map((s) => ({ label: s.label, text: s.text }));
  const basisOf = (b) => BASIS[b] || { label: '未分類', tone: 'miss' };
  const kpiLabelByKey = new Map();
  plan.section3.protectedKpis.forEach((k) => kpiLabelByKey.set(k.key, k.label));
  plan.section3.proposedKpis.forEach((k) => kpiLabelByKey.set(k.key, k.label));
  const stage3LabelById = new Map(ctx.stage3Kpis.map((k) => [k.id, k.label]));
  const obstacles = plan.section1.obstacles;
  const period = plan.period;
  const periodLabel = `${period.startYm} 〜 ${period.endYm}`;
  const periodBasisLabel =
    period.basis === 'AI_PROVISIONAL'
      ? 'AIが仮の期間を提案（入力に期限の根拠なし）'
      : '入力にある期限から設定';

  const text = (key, label, value, basis, refs, opts) => {
    const o = opts || {};
    return {
      key,
      label,
      value: ev(key, value),
      original: value,
      edited: edited(key),
      basis: basisOf(basis),
      evidence: evidence(refs),
      type: o.type || 'text',
      multiline: !!o.multiline,
      hint: o.hint || '',
    };
  };

  const s1 = plan.section1;
  const section1 = {
    title: SECTION_TITLES[0],
    blocks: [
      text('goal', '目指す状態', s1.goalState.text, s1.goalState.basis, s1.goalState.sourceRefs, { multiline: true }),
      text('customerProblem', '顧客の困りごと', s1.customerProblem.text, s1.customerProblem.basis, s1.customerProblem.sourceRefs, { multiline: true }),
      text('customerOutcome', '顧客が得る効果', s1.customerOutcome.text, s1.customerOutcome.basis, s1.customerOutcome.sourceRefs, { multiline: true }),
      text('ourValue', '自社の強み・提供する価値', s1.ourValue.text, s1.ourValue.basis, s1.ourValue.sourceRefs, { multiline: true }),
      text('whyChosen', '選ばれる理由', s1.whyChosen.text, s1.whyChosen.basis, s1.whyChosen.sourceRefs, { multiline: true }),
      text('problemCause', 'なぜ起きているか', s1.problemCause.text, s1.problemCause.basis, s1.problemCause.sourceRefs, { multiline: true }),
      (() => {
        const linked = obstacles.map((_, i) => plan.section2.actions.filter((a) => a.mechanism && a.mechanism.obstacleRefs.includes(i + 1)).length);
        const items = obstacles.map((o, i) => ({
          ...text(`obstacle:${i + 1}`, `妨げている要因 ${i + 1}`, o.text, o.basis, o.sourceRefs, { multiline: true }),
          verifyBy: o.verifyBy,
          readonly: true,
          number: i + 1,
          regulatory: REGULATORY.test(o.text),
          linkedActions: linked[i],
        }));
        const score = (f) => (f.regulatory ? 100 : 0) + f.linkedActions * 10 + (f.basis.label === BASIS.STAGE_DATA.label ? 1 : 0);
        const ranked = items
          .map((f, idx) => ({ f, idx }))
          .sort((a, b) => score(b.f) - score(a.f) || a.idx - b.idx)
          .map((x) => x.f);
        return { kind: 'obstacles', primary: ranked.slice(0, PRIMARY_OBSTACLES), more: ranked.slice(PRIMARY_OBSTACLES), total: items.length };
      })(),
    ],
  };

  const actions = plan.section2.actions.map((a) => {
    const linkedObstacles = (a.mechanism ? a.mechanism.obstacleRefs : [])
      .map((n) => obstacles[n - 1])
      .filter(Boolean)
      .map((o) => o.text);
    return {
      order: a.order,
      title: text(`action:${a.order}:title`, '行動の内容', a.title, a.basis, a.sourceRefs),
      due: {
        key: `action:${a.order}:due`,
        label: '期限',
        value: ev(`action:${a.order}:due`, a.dueYm),
        original: a.dueYm,
        edited: edited(`action:${a.order}:due`),
        type: 'month',
        outOfPeriod: !monthOk(ev(`action:${a.order}:due`, a.dueYm), period.startYm, period.endYm),
      },
      ownerRole: a.ownerRole,
      after: a.dependsOn.map((d) => `${d}番目の行動の後`),
      stateChange: a.mechanism ? a.mechanism.stateChange : '（仕組みの記載なし）',
      whyItMatters: a.mechanism ? a.mechanism.whyItMatters : '',
      linkedObstacles,
      linkedKpis: a.supportsKpiKeys.map((k) => kpiLabelByKey.get(k) || k),
      evidence: evidence(a.sourceRefs),
      basis: basisOf(a.basis),
    };
  });
  const section2 = { title: SECTION_TITLES[1], blocks: [{ kind: 'actions', items: actions }] };

  const protectedRows = plan.section3.protectedKpis.map((k) => {
    const dueKey = `judge:${k.key}`;
    const confirmed = k.confirmation === 'USER_CONFIRMED';
    return {
      key: k.key,
      locked: true,
      confirmed,
      label: k.label,
      kindLabel: confirmed ? '確定済み（STAGE3）' : '入力済み（確定の印なし）',
      target: formatTarget(k.target, k.unit) || '未設定',
      due: k.due || null,
      judge: k.due === null
        ? {
            key: dueKey,
            label: '判定する時期',
            value: ev(dueKey, k.judgeCandidateYm ?? ''),
            edited: edited(dueKey),
            candidate: k.judgeCandidateYm !== null && !edited(dueKey),
            type: 'month',
          }
        : null,
      owner: k.owner || '未設定',
      measurement: k.measurement,
      basis: BASIS.STAGE_DATA,
    };
  });
  const proposedRows = plan.section3.proposedKpis.map((k) => {
    const tKey = `kpi:${k.key}:target`;
    const dKey = `kpi:${k.key}:due`;
    const oKey = `kpi:${k.key}:owner`;
    const uKey = `kpi:${k.key}:untargeted`;
    const targetValue = ev(tKey, k.target);
    return {
      key: k.key,
      locked: false,
      label: k.label,
      kindLabel: KPI_KIND[k.kind] || k.kind,
      target: { key: tKey, value: targetValue, unit: k.unit, original: k.target, edited: edited(tKey), type: 'number' },
      untargeted: { key: uKey, value: ev(uKey, false) === true },
      due: { key: dKey, value: ev(dKey, k.due), original: k.due, edited: edited(dKey), type: 'month' },
      owner: { key: oKey, value: ev(oKey, k.owner), original: k.owner, edited: edited(oKey), type: 'owner' },
      measurement: k.measurement,
      basis: basisOf(k.targetBasis === 'AI_PROVISIONAL' ? 'AI_PROVISIONAL' : 'PROPOSAL'),
    };
  });
  const stage3Notes = plan.section3.stage3Review.map((r) => ({
    kpiLabel: stage3LabelById.get(r.stage3KpiId) || '確定KPI',
    concern: r.concern,
    evidence: evidence(r.sourceRefs),
  }));
  const section3 = { title: SECTION_TITLES[2], blocks: [{ kind: 'kpis', protected: protectedRows, proposed: proposedRows, stage3Notes }] };

  const financeEffects = plan.section4.financeItems.map((f) => {
    const est = bundle.estimates.find((e) => e.itemKey === f.key) || null;
    const confirmKey = `finance:${f.key}:amountYen`;
    const checkKey = `finance:${f.key}:confirmed`;
    const confirmedYen = ev(confirmKey, null);
    const confirmedOk = confirmedYen !== null && confirmedYen !== '' && ev(checkKey, false) === true;
    let status;
    let amountYen = null;
    const reasons = [];
    if (confirmedOk) {
      status = 'CONFIRMED';
      amountYen = Number(confirmedYen);
    } else if (est && est.status === 'AI_ESTIMATE_UNCONFIRMED') {
      status = 'AI_ESTIMATE';
      amountYen = est.amountYen;
    } else {
      status = 'NOT_CALCULATED';
      if (f.method === 'FREE') {
        reasons.push('算定式がないため金額は作らない');
      } else if (est && est.status === 'INPUT_MISSING') {
        est.missing.forEach((m) => reasons.push(`${m}が未入力`));
      } else {
        reasons.push('入力が不足している');
      }
    }
    return {
      key: f.key,
      label: f.label,
      direction: FIN_DIRECTION[f.kind] || f.kind,
      method: METHOD_JA[f.method] || f.method,
      status,
      amountYen,
      amountDisplay:
        amountYen === null || Number.isNaN(amountYen)
          ? null
          : `${(amountYen / 1_000_000).toFixed(1)} 百万円（${Math.round(amountYen).toLocaleString('ja-JP')} 円）`,
      reasons,
      formula: est ? est.formula : null,
      freeNote: f.freeNote,
      sourceNote: f.sourceNote,
      period: `${f.startYm} 〜 ${f.endYm || '（期間の終わりは未設定）'}`,
      amountBasis: AMOUNT_BASIS_JA[f.amountBasis] || f.amountBasis,
      basedOn: f.basedOnKpiKeys.map((k) => kpiLabelByKey.get(k) || k),
      inputEdit: { key: confirmKey, value: confirmedYen, checkKey, checked: ev(checkKey, false) === true, edited: edited(confirmKey) },
      evidence: f.inputs.flatMap((i) => evidence(i.sourceRefs)),
      inputs: f.inputs.map((i) => ({
        label: i.label,
        value: i.value === null ? '未入力' : `${i.value}${i.unit && i.unit !== '%' ? ' ' + i.unit : i.unit || ''}`,
        basis: basisOf(i.basis),
      })),
    };
  });
  const section4 = {
    title: SECTION_TITLES[3],
    blocks: [
      {
        kind: 'finance',
        companyResult: text('companyResult', '自社の売上・利益への影響', s1.companyResult.text, s1.companyResult.basis, s1.companyResult.sourceRefs, { multiline: true }),
        effects: financeEffects,
        confirmedTotalYen: financeEffects.reduce((sum, e) => (e.status === 'CONFIRMED' ? sum + e.amountYen : sum), 0),
        confirmedCount: financeEffects.filter((e) => e.status === 'CONFIRMED').length,
      },
    ],
  };

  const s5 = plan.section5;
  const ownerKey = 'responsible';
  const section5 = {
    title: SECTION_TITLES[4],
    blocks: [
      {
        kind: 'people',
        responsible: {
          key: ownerKey,
          value: ev(ownerKey, s5.responsible.name ?? plan.responsibleSuggestion),
          original: s5.responsible.name,
          edited: edited(ownerKey),
          basis:
            s5.responsible.name === null && plan.responsibleSuggestion !== null
              ? { label: '入力の担当候補（仮）', tone: 'ai' }
              : basisOf(s5.responsible.basis),
          note: s5.responsible.note,
          suggestion: s5.responsible.name ?? plan.responsibleSuggestion,
          candidates: ctx.ownerCandidates,
        },
        roles: s5.roles.map((r) => ({ unit: r.unit, role: r.role, actions: r.actionOrders.map((o) => `行動${o}`) })),
        risks: s5.risks.map((r, i) => ({
          risk: r.risk,
          countermeasure: text(`risk:${i + 1}:countermeasure`, '対策', r.countermeasure, r.basis, r.sourceRefs, { multiline: true }),
          confirmBy: r.confirmBy,
        })),
        preconditions: s5.preconditions,
        budget: s5.budget === null ? '入力情報にないため未設定（AIは金額を作らない）' : s5.budget,
      },
    ],
  };

  const sections = [section1, section2, section3, section4, section5];

  const tasks = buildTasks(bundle, ev, edited);
  const startTasks = tasks.filter((t) => t.gate === 'START');
  const startOpen = startTasks.filter((t) => !t.done);
  const laterOpen = tasks.filter((t) => t.gate === 'LATER' && !t.done);
  const handover = handoverChecks(plan, ev, edited, tasks);
  const memo = devMemo(bundle);
  const machineErrors = memo.filter((m) => m.severity === 'error');

  const idLabel = {};
  plan.section3.protectedKpis.forEach((k) => (idLabel[k.key] = k.label));
  plan.section3.proposedKpis.forEach((k) => (idLabel[k.key] = k.label));
  ctx.stage3Kpis.forEach((k) => (idLabel[k.id] = k.label));
  const view = humanizeDeep(
    {
      sections,
      tasks,
      priority: startOpen.slice(0, MAX_PRIORITY),
      moreRequired: startOpen.slice(MAX_PRIORITY),
      optionalOpen: laterOpen,
      goalSummary: ev('goal', s1.goalState.text),
      firstAction: actions.find((a) => a.order === 1) || null,
    },
    idLabel
  );

  return {
    caseId: bundle.caseId,
    title: ctx.projectTitle,
    departmentName: ctx.departmentName,
    companyName: bundle.inputSummary.companyName,
    period: { label: periodLabel, basisLabel: periodBasisLabel, provisional: period.basis === 'AI_PROVISIONAL' },
    goalSummary: view.goalSummary,
    firstAction: view.firstAction,
    sections: view.sections,
    tasks: view.tasks,
    priority: view.priority,
    moreRequired: view.moreRequired,
    optionalOpen: view.optionalOpen,
    progress: { startTotal: startTasks.length, startDone: startTasks.length - startOpen.length },
    adoption: {
      adoptable: machineErrors.length === 0,
      blockers: machineErrors.map((m) => blockerText(m.code)),
    },
    start: {
      startable: startOpen.length === 0 && handover.every((h) => h.ok),
      openCount: startOpen.length,
      handover,
    },
    financeTotals: { confirmedCount: view.sections[3].blocks[0].confirmedCount, confirmedTotalYen: view.sections[3].blocks[0].confirmedTotalYen },
    devMemo: devMemo(bundle),
    idLabel,
  };
}

// 採用（計画案の保存）に必要なのは、AI出力に検証エラーが無いこと。未確認事項は残してよい。
// 実行開始（gate: START）に必要なのは、実行責任者の確定と、開始前の確認（規制・安全を含む）だけ。
// それ以外（KPI目標、判定時期、財務の金額、詳細の確認）は、採用後に必要な箇所だけ確認する（gate: LATER）。
const REGULATORY = /規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/;

function buildTasks(bundle, ev, edited) {
  const plan = bundle.plan;
  const tasks = [];
  const add = (t) => tasks.push(t);
  const ownerName = ev('responsible', plan.section5.responsible.name ?? plan.responsibleSuggestion);
  add({
    id: 'owner',
    gate: 'START',
    required: true,
    type: 'DECIDE',
    section: 5,
    title: '実行責任者を決める',
    detail: plan.section5.responsible.name ?? plan.responsibleSuggestion
      ? '候補をそのまま決めるか、別の人を入れる'
      : '入力に候補がないため、名前を入力する',
    done: edited('responsible') && !!ownerName,
    aiFixable: null,
    aiNote: '候補の提示はAI。決定は利用者が行う',
  });
  plan.section3.proposedKpis.forEach((k) => {
    const tKey = `kpi:${k.key}:target`;
    const uKey = `kpi:${k.key}:untargeted`;
    const value = ev(tKey, k.target);
    const targetSet = value !== null && value !== '' && value !== undefined;
    add({
      id: `kpi-target-${k.key}`,
      gate: 'LATER',
      required: false,
      type: 'DECIDE',
      section: 3,
      title: `「${k.label}」の目標値を決める（後で決めてもよい）`,
      detail: '数値を入れるか、「目標は後で決める」を選ぶ',
      done: targetSet || ev(uKey, false) === true,
      aiFixable: k.target === null ? 'A' : null,
      aiNote: k.target === null ? 'AIが仮の目標値（AI_PROVISIONAL）を出せば、確認だけになる' : '',
    });
  });
  plan.section3.protectedKpis
    .filter((k) => k.due === null)
    .forEach((k) => {
      const judgeKey = `judge:${k.key}`;
      add({
        id: `judge-${k.key}`,
        gate: 'LATER',
        required: false,
        type: 'CONFIRM',
        section: 3,
        title: `「${k.label}」の判定時期を確認する`,
        detail: `STAGE3の期限は未設定。候補（${k.judgeCandidateYm ?? '未設定'}）のまま、またはこの計画の中で変える`,
        done: edited(judgeKey) && !!ev(judgeKey, ''),
        aiFixable: 'B',
        aiNote: '候補をAIが出している。確認だけで済む',
      });
    });
  plan.verificationItems.forEach((v, i) => {
    const isBefore = v.priority === 'BEFORE_START';
    const regulatory = REGULATORY.test(v.item);
    const dup = /責任者/.test(v.item);
    add({
      id: `verify-${i + 1}`,
      gate: isBefore || regulatory ? 'START' : 'LATER',
      required: isBefore || regulatory,
      type: 'CONFIRM',
      section: 0,
      title: v.item,
      detail: regulatory
        ? '規制・安全に関わる事項。確認するまで実行を開始できない'
        : isBefore
        ? '実行開始の前に確認する'
        : '実行中に確認する（後で可）',
      done: ev(`task:verify-${i + 1}`, false) === true,
      hold: regulatory,
      aiFixable: dup ? 'A' : null,
      aiNote: dup ? '責任者の決定と重複している可能性（AIが一方にまとめるべき）' : '',
    });
  });
  // 規制・安全に関わる障害があるのに、開始前の確認に規制の項目が無い場合は、確認を必須として補う（黙って省かない）
  const regulatoryObstacles = plan.section1.obstacles.map((o, i) => ({ o, i })).filter(({ o }) => REGULATORY.test(o.text));
  const regulatoryStart = plan.verificationItems.some((v) => v.priority === 'BEFORE_START' && REGULATORY.test(v.item));
  if (regulatoryObstacles.length > 0 && !regulatoryStart) {
    add({
      id: 'hold-regulatory',
      gate: 'START',
      required: true,
      type: 'CONFIRM',
      section: 1,
      title: `規制・安全に関する要因の確認（要因${regulatoryObstacles.map(({ i }) => i + 1).join('・')}）`,
      detail: '規制・安全に関わる要因。確認するまで実行を開始できない',
      done: ev('task:hold-regulatory', false) === true,
      hold: true,
      aiFixable: null,
      aiNote: '',
    });
  }
  plan.section4.financeItems.forEach((f) => {
    const confirmKey = `finance:${f.key}:amountYen`;
    const checkKey = `finance:${f.key}:confirmed`;
    add({
      id: `finance-${f.key}`,
      gate: 'LATER',
      required: false,
      type: 'INPUT',
      section: 4,
      title: `「${f.label}」の金額を確認して入れる（任意）`,
      detail: '計画の採用・開始には不要。投資や予算に使う前に入れる',
      done: ev(confirmKey, null) !== null && ev(confirmKey, null) !== '' && ev(checkKey, false) === true,
      aiFixable: 'A',
      aiNote: 'AIが仮説（HYPOTHESIS）の値と式を出せば、確認だけになる',
    });
  });
  return tasks;
}

// STAGE5へ引き継ぐ最小限の情報が揃っているかを確かめる
function handoverChecks(plan, ev, edited, tasks) {
  const judgeOk = plan.section3.protectedKpis
    .filter((k) => k.due === null)
    .every((k) => !!ev(`judge:${k.key}`, k.judgeCandidateYm));
  return [
    { label: '実行責任者（利用者が確定）', ok: edited('responsible') && !!ev('responsible', null) },
    { label: '行動の順序・担当・期限', ok: plan.section2.actions.every((a) => !!a.dueYm) },
    { label: '追加KPIの期限（目標値は後で決めてよい）', ok: plan.section3.proposedKpis.every((k) => !!k.due) },
    { label: '確定KPIの判定時期', ok: judgeOk },
    {
      label: '開始前の確認（規制・安全を含む）',
      ok: tasks.filter((t) => t.gate === 'START' && t.id !== 'owner').every((t) => t.done),
    },
  ];
}

function blockerText(code) {
  if (code === 'REGULATORY_CONSTRAINT_NOT_ADDRESSED') {
    return '入力の規制・安全に関する制約が、計画に反映されていない（AIによる再生成が必要）';
  }
  return 'AI出力の検証エラー（AIによる再生成が必要）';
}

// 開発確認用メモ：検証結果を、利用者向けの文言と切り分けて示す
const DEV_RULES = {
  REF_NORMALIZED: { cat: '表示しない', note: '参照IDの書式の修正。利用者には出さない' },
  STAGE3_KPI_TIMING_CONFLICT: {
    cat: 'A',
    note: '行動3（試験導入の実施）を、S1（合意）を支える行動として紐づけている。AIの紐づけの誤り。紐づけを直せば解消する',
  },
  OWNER_UNSET: { cat: 'C', note: '責任者は利用者が決める。候補の提示はAIが行う' },
  KPI_CLASS_UNCERTAIN: { cat: 'B', note: '分類器が「割合」などの表記を判定できず、確認に回している' },
  REGULATORY_CONSTRAINT_NOT_ADDRESSED: { cat: 'A', note: '入力の規制の論点（脅威）が計画に入っていない。AIが反映すべき（採用は不可）' },
  OTHER_DEPARTMENT_KPI_ADOPTED: { cat: 'A', note: '他部門の指標を、この計画の追加KPIにしている。参照に戻す（採用は不可）' },
  ACTIVITY_KPI_AS_OUTCOME: { cat: 'A', note: '記録・完了の指標を成果として書いている。先行指標にするか、成果の指標に置き換える（採用は不可）' },
  KPI_DUPLICATE: { cat: 'A', note: '同じ目標値で、測るものが重なっている。統合する（利用者の確認は不要）' },
  VERIFICATION_DUPLICATE: { cat: 'A', note: '同じ内容の確認事項が2回ある（採用は不可）' },
  LEADING_PROCESS_KPI: { cat: 'A', note: '途中の確認として記録・算出の完了を測っている。成果への道筋を書く' },
};
function devMemo(bundle) {
  return bundle.issues.map((i) => {
    const rule = DEV_RULES[i.code];
    return {
      severity: i.severity,
      code: i.code,
      path: i.path,
      message: i.message,
      category: rule ? rule.cat : '未分類',
      note: rule ? rule.note : '',
    };
  });
}

export {
BASIS,
RULES,
toDisplayPlan,
auditMapping,
humanize,
buildTasks,
formatTarget,
SECTION_TITLES,
MAX_PRIORITY,
};
