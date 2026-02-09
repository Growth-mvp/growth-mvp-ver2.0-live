     * プロンプト組み立て（2レーン生成：既存進化 / 新規探索）
     * ======================= */
    const summary = strategySummary?.trim() || storyText.slice(0, 160) || '（要約なし）';

    // ★csvFinanceData はオブジェクトで来ても落とさない（抜粋行を抽出）
    const previewRows = extractCsvPreviewRows(csvFinanceData);
    const financeCsvText = previewRows.length > 0 ? toLinesFromCsv(previewRows, 5) : '（CSVベースの財務データなし）';

    const financeSummaryText = summarizeFinanceSummary(financeSummary);
    const portfolioText = summarizeBusinessPortfolio(businessPortfolio);

    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel ? `${industryLabel}${industry ? `（${industry}）` : ''}` : industry ?? '（不明）';
    const industryContext = (industry && (industryTemplates as any)?.[industry]) || '';

    // ★ csvFinanceData から segmentPL / segmentBS を抽出（P3拡張：segmentName マッピング用）
    const segmentPL = (csvFinanceData as any)?.segmentPL ?? {};
    const segmentBS = (csvFinanceData as any)?.segmentBS ?? {};

    // ★ allBusinessSegments 実データ確認ログ（診断用）
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      const names = Array.isArray(allBusinessSegments)
        ? allBusinessSegments.map((s: any) => s?.name).filter(Boolean).slice(0, 10)
        : [];
      console.log('[cascade][segdebug] allBusinessSegments.len=', Array.isArray(allBusinessSegments) ? allBusinessSegments.length : -1);
      console.log('[cascade][segdebug] allBusinessSegments.names(sample)=', names);
    }

    // ★ セグメント名の正規化（ホワイトスペース除去、小文字化、サフィックス除去）
    const normalizeName = (s: string) =>
      (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[・･]/g, '・')
        .replace(/(事業部|本部|部門|部)$/g, '')
        .trim();

    // ★ FactPack 生成（TASK 1: 部門ごとの引用可能な事実セット）
    const factPackByDept = new Map<string, DeptFactPack>();
    for (const d of departments) {
      const name = pickName(d);
      if (!name) continue;
      const factPack = buildDeptFactPack(name, allBusinessSegments, csvFinanceData, financeSummary, businessPortfolio);
      factPackByDept.set(name, factPack);
      if (DEBUG) {
        console.log(`[cascade][factpack] ${name}: ${factPack.anchors.length}anchors, ${factPack.customers.length}customers`);
      }
    }

    const deptBlocks = departments
      .map((d) => {
        const name = pickName(d);
        const segmentName = typeof (d as any)?.segmentName === 'string' ? (d as any).segmentName : name;
        const answers = (d?.answers || []) as Array<{ stepNumber: number; label?: string; answer?: string }>;
        const dir = d?.direction || '';
        const exps = trimList(d?.expectations, 4);
        const focuses = trimList(d?.focusThemes, 4);

        const ansLines = (answers || [])
          .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
          .slice(0, 6)
          .map((a) => `  - Q${a.stepNumber}${a.label ? `（${a.label}）` : ''}: ${sanitizeText(a?.answer || '', 220)}`)
          .join('\n');

        // ★ allBusinessSegments から該当セグメントを検索（正規化マッチング）
        const segKey = (segmentName ?? name ?? '').trim();
        const keyN = normalizeName(segKey);

        // ★ 段階的マッチング：完全一致 → 部分一致（複数は除外） → not_found
        let seg: any = undefined;
        if (Array.isArray(allBusinessSegments)) {
          // 1) 完全一致
          seg = allBusinessSegments.find((s: any) => normalizeName(s?.name ?? '') === keyN);

          // 2) 部分一致（複数ヒットは誤マッチ防止で除外）
          if (!seg && keyN.length >= 4) {
            const hits = allBusinessSegments.filter((s: any) => normalizeName(s?.name ?? '').includes(keyN));
            seg = hits.length === 1 ? hits[0] : undefined;
          }
        }

        // ★ セグメント情報を抽出（P3拡張：prompt注入用）
        const segOverview = seg?.overview ?? '';
        const segCustomers = seg?.mainCustomers ?? seg?.customers ?? '';
        const segPLData = seg?.pl ?? seg?.segmentPL ?? null;
        const segBSData = seg?.bs ?? seg?.segmentBS ?? null;

        // ★ 部門別財務サマリー（seg優先、csvFinanceData は補助）
        const deptFinanceSummaryText = (() => {
          const parts: string[] = [];

          // 1) seg から抽出（優先）
          if (segPLData && typeof segPLData === 'object') {
            const plData = Array.isArray(segPLData) ? segPLData : [segPLData];
            for (const row of plData.slice(-2)) {
              if (!row) continue;
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? `売上${Math.round(row.revenue / 100) / 10}M円` : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? `営業利益${Math.round(row.operatingIncome / 100) / 10}M円` : '';
              const items = [year, revenue, operatingIncome].filter(Boolean).join(' ');
              if (items) parts.push(items);
            }
          }

          // 2) csvFinanceData.segmentPL から抽出（補助）
          if (!seg && segmentPL && segmentPL[segKey]) {
            const segRows = Array.isArray(segmentPL[segKey]) ? segmentPL[segKey].slice(-2) : [];
            for (const row of segRows) {
              const year = row?.year ? `(${row.year})` : '';
              const revenue = typeof row?.revenue === 'number' ? `売上${Math.round(row.revenue / 100) / 10}M円` : '';
              const operatingIncome = typeof row?.operatingIncome === 'number' ? `営業利益${Math.round(row.operatingIncome / 100) / 10}M円` : '';
              const items = [year, revenue, operatingIncome].filter(Boolean).join(' ');
              if (items) parts.push(items);
            }
          }

          // 3) financeSummary から部門マッチで抽出（最終補助）
          if (financeSummary && parts.length === 0) {
            const summaryList = Array.isArray(financeSummary) ? financeSummary : [];
            const deptMatches = summaryList.filter((row: any) => {
              const businessUnit = String(row?.business_unit || row?.unitName || '').toLowerCase();
              return businessUnit.includes(name.toLowerCase()) || name.toLowerCase().includes(businessUnit);
            });
            for (const row of deptMatches.slice(0, 1)) {
              const revenue = typeof row.revenue === 'number' ? `${Math.round(row.revenue / 100) / 10}M円` : row.revenue || '';
              const margin = row.profitMargin ? `利益率${row.profitMargin}` : '';
              const item = [revenue, margin].filter(Boolean).join(', ');
              if (item) parts.push(item);
            }
          }

          return parts.length > 0 ? parts.join(' / ') : '（部門別財務不明）';
        })();

        // ★ 部門別ポートフォリオ位置（businessPortfolio から該当ユニットを抽出）
        const deptPortfolioText = (() => {
          if (!businessPortfolio?.units) return '（ポートフォリオ未設定）';
          const matchedUnits = (businessPortfolio.units as any[]).filter((u: any) => {
            const unitName = String(u?.name || '').toLowerCase();
            const deptNameLower = name.toLowerCase();
            return unitName.includes(deptNameLower) || deptNameLower.includes(unitName);
          });
          if (matchedUnits.length > 0) {
            return matchedUnits.map((u: any) => `${u.name}: ${u.position || 'N/A'}`).join(' / ');
          }
          return '（ポートフォリオ内の位置不明）';
        })();

        // ★projects seed を string[]/object[] 混在から正規化
        const projSeedList = normalizeProjectSeeds(d?.projects);
        const projSeed = projSeedList.map((p) => `  - ${sanitizeText(p, 100)}`).join('\n');

        const okrSeed = (Array.isArray(d?.okrs) ? d!.okrs! : [])
          .slice(0, 2)
          .map((o: any, i: number) => {
            const kr = trimList(o?.keyResults, 3)
              .map((k) => `"${sanitizeText(k, 80)}"`)
              .join(', ');
            return `  - OKR${i + 1}: O="${sanitizeText(o?.objective || '', 100)}" KR=[${kr}]`;
          })
          .join('\n');

        // ★ TASK 2: FACTPACK ブロック生成（anchors付き、引用ベース）
        const factPack = factPackByDept.get(name);
        const factPackBlock = (() => {
          if (!factPack || factPack.anchors.length === 0) {
            return `\n\n[FACTPACK]\n- segment: ${segKey}\n- anchors: （利用可能な事実なし）`;
          }

          const anchorLines = factPack.anchors
            .map((a) => `  - ${a.id}: "${sanitizeText(a.text, 100)}"`)
            .join('\n');

          const customerLines = factPack.customers.length > 0
            ? `\n- customers: ${factPack.customers.map((c) => `"${c}"`).join(', ')}`
            : '';

          return `\n\n[FACTPACK]\n- segment: ${factPack.segmentName}${customerLines}\n- anchors (必ず2つ以上を reason/hypothesis で引用すること):\n${anchorLines}`;
        })();

        // ★ デバッグログ
        if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
          console.log('[cascade][segmap]', name, 'segmentName=', segmentName, 'found=', !!seg, 'key=', segKey);
          if (factPack) {
            console.log('[cascade][factpack]', name, `anchors=${factPack.anchors.length}`);
          }
        }

        // ★ 部門別ユニークネスルール（全部門同一PJ防止の物理的制約）
        const deptName = name;
        const uniquenessRule = `

[UNIQUENESS_CONSTRAINT]
- 生成するプロジェクト案は「他部門と同一/酷似」禁止
- existing lane の各プロジェクト title は必ず "${deptName}：" で始める（例："${deptName}：既存顧客のLTV改善"）
- new lane の各プロジェクト title も必ず "${deptName}：" で始める（例："${deptName}：新規用途開拓の検証"）
- hypothesis と reason には、必ず [SEGMENT] の要素（overview/customers/PL/BS のどれか）を最低1つ"引用"して根拠にする
- 禁止：汎用テンプレ（DX推進/業務効率化/新規開拓 だけの抽象表現）で終わらせること`;

        // ★ STAGE3: A) 部門ごとの6問ブロック生成 + ログ
        const deptAnswers6 = pickDeptAnswers6(d);
        const dept6AnswersBlock = formatDept6Answers(deptAnswers6);
        const dept6Answered = hasAnsweredSteps6(deptAnswers6);

        // ★ STAGE3: C) 証明ログ（6問注入チェック）
        console.log('[cascade][dept6]', {
          dept: name,
          answersLen: Array.isArray(deptAnswers6) ? deptAnswers6.length : null,
          answered6: dept6Answered,
          preview: dept6AnswersBlock.slice(0, 120),
        });

        // ★ STAGE3: TASK 3 - 6問完成時の生成ルール強制（部門ごと）
        const dept6ConstraintsBlock = dept6Answered
          ? `

【★ STAGE3: 6問完成部門への追加制約】
- Step1（役まわり）を mission に必ず反映すること（役割を示す語句を含める）
- Step2（既存貢献）から最低1本を「既存進化」プロジェクトに含めること
- Step3（未来への挑戦）から最低1本を「新規探索」プロジェクトに含めること
- Step4（犠牲）に該当する内容を、プロジェクトの risks / constraints として明記すること
- Step5（協力）を、プロジェクトの dependencies（協力部門・前提）として明記すること
- Step6（撤退）を、scope 除外または非対象として明記すること
`
          : '';

        return `
[部門] ${name}
  direction: ${sanitizeText(dir || '', 140) || '（未設定）'}
  expectations:
${exps.map((e) => `    - ${sanitizeText(e, 120)}`).join('\n') || '    - （未設定）'}
  focusThemes:
${focuses.map((f) => `    - ${sanitizeText(f, 120)}`).join('\n') || '    - （未設定）'}
  ★部門別財務: ${deptFinanceSummaryText}
  ★部門別ポートフォリオ: ${deptPortfolioText}
  answers (1..6): ※この6回答は必ず提案に反映し、矛盾は禁止
${ansLines || '  - （未回答）'}
  ★ STAGE3: 6問の回答（部門戦略ガイド）: ${dept6Answered ? '（6/6完成）' : '（不足あり）'}
${dept6AnswersBlock.split('\n').map((line) => `    ${line}`).join('\n')}${dept6ConstraintsBlock}
  seeds.projects:
${projSeed || '  - （なし）'}
  seeds.okr:
${okrSeed || '  - （なし）'}${factPackBlock}${uniquenessRule}
`.trim();
      })
      .join('\n\n');

    const prompt = `
あなたは世界最高の経営戦略コンサルタントです。以下の情報をもとに、部門ごとの提案を「既存進化（Existing）」「新規探索（New）」の2レーンで返してください。

【★最重要：プロジェクト数と命名規則（STAGE3軽量化版）】
- 各部門の提案は「プロジェクト」のみで構成される（OKRは生成しない）。
- プロジェクト数：合計3個（既存進化 2個 + 新規探索 1個）を厳密に守ること。
- ★★★全部門で異なるプロジェクト案を出すこと（部門AのプロジェクトAが部門Bにも出現することは厳禁）。
- ★★★各部門の【部門別財務】【部門別ポートフォリオ】【主な顧客層】【意思決定権】を参照し、その部門固有の課題と機会に基づいてプロジェクトを立案すること。
- ★TASK 2 引用ベース生成（FACTPACK から必ず根拠を引く）：
  - 各プロジェクトの title は必ず [FACTPACK] の customers または overview から固有名詞を1つ以上含むこと（例：「自動車OEMの〜」「トヨタ向けの〜」）
  - reason と hypothesis には、[FACTPACK] の anchors ID を「」括弧で最低2つ以上引用すること（例：「『主要顧客：トヨタ』（fact-cust-1）」）
  - citations フィールドに、引用した anchor ID を列挙すること（例：["fact-cust-1", "fact-fin-2"]）
- ★対象部門の事業領域から外れる提案は禁止。既存事業と離れすぎた提案や、部門の守備範囲外の分野への展開は避けること。

【部門ミッション記述ルール】
- missionDraft: 1〜2文で、部門の戦略的ミッション（構造変化/役割の再定義を含める）
- missionDescription: 2〜4文で、missionDraft の背景・理由・狙いを説明。部門の事業概要、主要顧客層、部門別財務（売上規模・利益率など）に必ず言及すること。

【レーン定義】
- 既存進化（Existing）：短期〜中期（今年〜3年）でPLに効く改善/強化（主にACQ/ARPU/CHURN/COST/EFFICIENCY）。2個のプロジェクト。
- 新規探索（New）：将来成長の仮説検証（主にFUTURE、ただしACQ/ARPUでも可）。1個のプロジェクト。
- 6つの回答（answers 1..6）に反する提案は禁止（特に Q4:犠牲/やめる、Q6:撤退/停止）。

【業界背景・成功パターン】
${industryContext || '（該当テンプレートなし）'}

【経営者の想い】
