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
${thought || '（未入力）'}

【MVV】
Mission: ${mvvMission ?? ''} / Vision: ${vision ?? ''} / Value: ${value ?? ''}

【SWOT】
強み: ${strength ?? ''} / 弱み: ${weakness ?? ''} / 機会: ${opportunity ?? ''} / 脅威: ${threat ?? ''}

【業種・規模】
${industryLine}、年商${String(revenue ?? '（不明）')}百万円、従業員${String(employees ?? '（不明）')}人

【財務サマリー（financeSummary）】
${financeSummaryText}

【事業ポートフォリオ（businessPortfolio）】
${portfolioText}

【CSV抜粋（参考）】
${financeCsvText}

【経営戦略ストーリー（要約/抜粋）】
${sanitizeText(storyText || '', 800) || '（ストーリー未入力）'}
要約: ${summary}

【STAGE2 最終ストーリー（Final Story）】
${sanitizeText(finalStoryText || '', 1000) || '（最終ストーリー未入力）'}

【部門文脈（Ver4準拠）】
${deptBlocks}

【STAGE2 価値指標（ValueDriverKPIs）】
${
  valueDriverKPIs && valueDriverKPIs.length > 0
    ? valueDriverKPIs.map((kpi: any) => `- ${kpi.id}: ${kpi.label}${kpi.description ? ` (${kpi.description})` : ''}`).join('\n')
    : '（未設定）'
}

【STAGE2 勝ち筋パターン】
主要: ${winPatternPrimary ?? '（未設定）'} / 副次: ${winPatternSecondary ?? '（未設定）'}

【プロジェクト設計ルール（仮説ベース＋2軸＋Final Story整合）】
- projects は「仮説ベースのプロジェクト」として設計する。
- ★【STAGE2最終ストーリー】の経営戦略方針を反映したプロジェクト案に編成すること。
- 各プロジェクトの reason/hypothesis には【STAGE2最終ストーリー】のキーコンセプト/価値軸との連携を明示すること。
- 各プロジェクトは以下の2軸を必ず持つ：
  - mainLever（何に効かせるか）:
    - 'ACQ'          : 新規顧客数・案件数
    - 'ARPU'         : 単価・LTV・客単価
    - 'CHURN'        : 解約率・離脱率
    - 'COST'         : 固定費・変動費・人件費などコスト全般
    - 'EFFICIENCY'   : 業務効率・時間削減（最終的にコスト/スループットに効く）
    - 'FUTURE'       : 将来の成長余地（新規事業・仕組み・人材など）
  - horizon（いつ効くか）:
    - 'short' : 〜1年
    - 'mid'   : 1〜3年
    - 'long'  : 3年以上
  - kind（種別ラベル）:
    - 'growth'     : 売上・単価アップ中心
    - 'cost'       : コスト削減中心
    - 'efficiency' : 業務効率化中心
    - 'future'     : 将来の種・仕組み・新規事業
- reason は「このプロジェクトを実施する理由」（1文）。【STAGE2最終ストーリー】と整合する根拠を引用で明示すること。
- hypothesis は「もし誰に対して/どの業務に対して◯◯を行えば、行動や体験がこう変わり、その結果 mainLever の指標がこう改善するはず」という形で1〜2文。【STAGE2最終ストーリー】のキーコンセプト/価値軸と連携させること。引用で根拠を示すこと。

【★Final Story整合（全プロジェクト・ミッション必須）】
- missionDraft/missionDescription、全projects の reason/hypothesis は【STAGE2最終ストーリー】の経営戦略方針と整合していなければ不合格。
- 各プロジェクトの実施根拠が【STAGE2最終ストーリー】に明示されている価値軸・キーコンセプト・経営ドメインの何を実装するのかを reason で述べること。
- hypothesis には、そのプロジェクトが実行される際に【STAGE2最終ストーリー】で定義された成功条件/価値指標がどう改善するのかを接続させること。
- 3部門のプロジェクト群全体が、統一された経営戦略ストーリーの「異なる実装アプローチ」として見える設計にすること。

【★STAGE3拡張フィールド（必須）】

【★TASK 1: OKR (Objective & Key Results) は必須】
- 各プロジェクトは okrs フィールドを必ず含める（省略禁止）
- okrs は最低1件、最大3件
- okrs[0].objective は必須（プロジェクトタイトルの実現ターゲット）
- okrs[0].keyResults は string[] で最低3個、最大5個（ラベルのみ）
  - keyResults の各要素は「プロジェクト短縮名 + 指標内容」形式
  - 例: "品質保証強化：不良率低減（ppm）", "受注プロセス：見積LT（営業日）"

【★TASK 1: OKR（KPI）差別化制約】
- 同一部門内で、別プロジェクトの keyResults をコピペしない（重複禁止）
- 各 keyResults には プロジェクト固有の名詞を含める：
  - 工程名（例：「検査」「梱包」「納品」）
  - 製品/サービス名（例：「中型部品」「カスタマイズ」「新型用」）
  - 顧客セグメント（例：「OEM向け」「内製化」「自動化」）
  - 技術領域（例：「IoT」「データ連携」「クラウド」）

【★TASK 4-4: KR（Key Result）は「数値で追える指標」にする】
- KR は「数値で計測できる先行指標」ONLY（例：納期遵守率、検査工数、見積回答時間、歩留、再加工率、試作完了数、商談数、PoC件数…）
- 「改善」「強化」「推進」「推奨」など抽象語だけは厳禁（具体的な測定方法が見えない指標は不合格）
- 各指標に unit を明記（例：%, ppm, 件, 日, 時間, 円, h/月…）
- 同一部門内で、異なるプロジェクト間での KR 被り検出・回避が必須
  - 品質改善系、受注強化系、自動化系で、KR セットが明らかに異なる
  - 「リードタイム」と「リードタイム」はNG。「見積回答時間」と「納期遵守率」に差別化する等

【★TASK D: KPI（OKR）ユニーク制約】
- 各プロジェクトのKPIは、他プロジェクトと同一にならないようにする（完全一致を避ける）
- KPIはプロジェクトの施策内容に直結する先行指標を含める（汎用的な一般指標は避ける）
- 各プロジェクトのOKR：3〜5個。うち最低2つは固有指標（プロジェクト title / hypothesis から具体化した指標）を必ず含める
- 品質改善系 vs 営業強化系 vs 新規事業系等、プロジェクトアーキタイプが異なれば、KPIセットも明らかに異なる必須（同じ指標セットは物理的に避ける）

【★★CRITICAL: KPI生成の多様性強化（テンプレ化防止）】
- 絶対禁止：「生産性向上（%）」「顧客満足度（NPS）」「プロセス改善スコア（1-10）」の3本セット（汎用テンプレ）
- 絶対禁止：各プロジェクトで同一の3本KPI指標セット（部門内の別プロジェクトとの重複）
- 必須制約1：部門・プロジェクト固有の前提（Stage1の事業部情報）を必ず参照し、汎用的な一般化KPIではなくドメイン固有の指標を使用すること
  - 例：品質向上系なら「不良率（ppm）」「初回良品率」など製造業固有指標
  - 例：売上増加系なら「提案件数」「商談化率」など営業固有指標
  - 例：新規開発系なら「試作完了率」「開発リードタイム」など開発固有指標
- 必須制約2：3本のうち最低1本は"ドメイン固有指標"を含める（金融ならLTVや解約率、製造なら歩留まり、流通なら在庫回転数など）
- 必須制約3：3本のKRのうち2本以上は互いに異なるカテゴリに属すること。指標のカテゴリ例：
  - 品質指標（歩留、不良率、再加工率、初回良品率など）
  - 納期・リードタイム指標（納期遵守率、見積回答時間、開発期間など）
  - コスト・効率指標（単位原価、工数、稼働率など）
  - 顧客・営業指標（受注率、提案件数、NPS、顧客単価など）
  - 安全・コンプライアンス指標（ヒヤリハット件数、監査合格率など）

0. okrs: OKR[] - 【★必須】 最低1個以上。各要素に objective と keyResults を含める（上記参照）

1. valueDriverLinks: string[] - STAGE2で定義された価値指標（valueDriverKPIs）の id を最低1つ以上含める。複数選択可。valueDriverKPIs が存在する場合、それ以外の値は禁止（自由記述不可）。
2. skillRequirements: { roleSkills?: string[]; executionSkills?: string[] } - 実行に必要なスキル
   - roleSkills: 職種スキル（例：「営業」「エンジニア」「デザイナー」「マーケター」等）1〜3個
   - executionSkills: 実行スキル（例：「PM」「標準化」「データ活用」「改善運用」「設計力」「交渉力」等）必ず1〜3個
   - ★重要：全プロジェクトで同一のスキルセットは厳禁。各プロジェクトごとに、title/hypothesis/mainLever/kind/valueDriverLinks/departmentName/laneを分析し、プロジェクトのアーキタイプ（品質改善型/自動化型/営業強化型/新規事業型/ITデータ型/組織改革型など）を内部で推定してから、そのアーキタイプに最適なスキルを選択すること。
3. humanInvestments: HumanInvestment[] - 人的投資施策、最低2カテゴリ以上を含める
   - category: 固定5カテゴリのみ使用可能（'TRAINING_OJT' | 'HIRING' | 'ALLOCATION' | 'EXTERNAL' | 'TOOLS_PROCESS'）
   - title: 施策名（短く、5〜15文字）
   - detail: 詳細（任意、1〜2文程度）
   - owner: 担当者（任意）
   - horizon: 実行時期（任意、'0_3M' | '3_6M' | '6_12M' | ''）
   - ★重要：全プロジェクトで同一の人的投資施策は厳禁。各プロジェクトのアーキタイプに基づき、適切なカテゴリと具体的な施策名を選択すること。例：品質改善型なら「品質管理研修」＋「検証ツール導入」、営業強化型なら「提案力研修」＋「CRM導入」など。

--- 出力（日本語のJSONのみ、説明禁止） ---
{
  "strategy": { "summary": "会社全体の経営戦略要約（2〜3文）" },
  "departments": [
    {
      "name": "部門名（入力に存在するもののみ）",
      "missionDraft": "この部門の戦略ミッション案（1〜2文。構造変化/役割も含める）★【STAGE2 最終ストーリー】と整合性を持たせること",
      "missionDescription": "missionDraft の背景・理由・狙い（2〜4文。部門の事業概要/主要顧客/部門別財務/【STAGE2最終ストーリー】に言及すること）",
      "lanes": {
        "existing": {
          "projects": [
            {
              "title": "高付加価値案件の構造変化",
              "reason": "目的（1文、引用あり）",
              "hypothesis": "仮説（1〜2文、引用あり）",
              "mainLever": "ACQ",
              "horizon": "short",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 1,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1", "fact-fin-2"],
              "valueDriverLinks": ["kpi_id_1", "kpi_id_2"],
              "skillRequirements": {
                "roleSkills": ["営業", "マーケター"],
                "executionSkills": ["PM", "データ活用"]
              },
              "humanInvestments": [
                { "category": "TRAINING_OJT", "title": "営業研修プログラム", "detail": "提案力向上のための実践研修" },
                { "category": "TOOLS_PROCESS", "title": "CRM導入", "detail": "顧客データの一元管理" }
              ]
            },
            {
              "title": "商談設計力の強化",
              "reason": "目的（1文、引用あり）",
              "hypothesis": "仮説（1〜2文、引用あり）",
              "mainLever": "ACQ",
              "horizon": "mid",
              "kind": "growth",
              "generatedBy": "ai",
              "generatedSlot": 2,
              "generatedGroup": "cascade_v1",
              "citations": ["fact-cust-1"],
