    }

    const result = {
      strategy: {
        summary:
          typeof normalized?.strategy?.summary === 'string' && normalized.strategy.summary.trim()
            ? normalized.strategy.summary.trim()
            : summary,
      },
      departments: Array.isArray(normalized?.departments)
        ? normalized.departments
            .map((d: any) => {
              const name = typeof d?.name === 'string' ? d.name.trim() : '';
              if (!name || !inputNames.has(name)) return null;

              const missionDraft = typeof d?.missionDraft === 'string' ? d.missionDraft.trim() : '';
              const lanesRaw = d?.lanes;

              const deptInput = deptInputByName.get(name);
              const answers = (deptInput?.answers || []) as Array<{ stepNumber: number; answer?: string; label?: string }>;
              const answersText = (answers || [])
                .sort((a, b) => (a?.stepNumber || 0) - (b?.stepNumber || 0))
                .slice(0, 6)
                .map((a) => `Q${a.stepNumber}${a.label ? `(${a.label})` : ''}: ${String(a.answer || '')}`)
                .join('\n');

              // ★STAGE3軽量化：OKR生成を削除、プロジェクトのみ返す
              // existing lane (2プロジェクト)
              const existingProjects = normalizeProjects(lanesRaw?.existing?.projects ?? d?.projects).slice(0, 2);

              // new lane (1プロジェクト)
              const newProjects = normalizeProjects(lanesRaw?.new?.projects ?? []).slice(0, 1);

              // ★致命修正: fallback anchors ヘルパー関数
              const pickFallbackAnchors = () => {
                const fp = factPackByDept.get(name);
                const anchors = Array.isArray(fp?.anchors) ? fp.anchors : [];
                return anchors.slice(0, 2);
              };

              const buildFallbackGroundedText = (base: string) => {
                const a = pickFallbackAnchors();
                if (a.length >= 2) {
                  return `${base}。「${a[0].text}」(${a[0].id}) と「${a[1].text}」(${a[1].id}) を根拠に、短期で実行可能な打ち手に落とし込む。`;
                }
                if (a.length === 1) {
                  return `${base}。「${a[0].text}」(${a[0].id}) を根拠に、短期で実行可能な打ち手に落とし込む。`;
                }
                return base;
              };

              const buildFallbackCitations = () => {
                const a = pickFallbackAnchors();
                return a.map((x: any) => x.id).filter(Boolean).slice(0, 2);
              };

              // ★ フォールバック：プロジェクトが不足する場合（required fields と citations を含める）
              const safeExistingProjects = existingProjects.length >= 2
                ? existingProjects
                : [
                    ...(existingProjects ?? []),
                    {
                      title: `[AI#2] ${name}の既存進化・収益性改善`,
                      reason: buildFallbackGroundedText('既存事業からPLに効く改善'),
                      hypothesis: buildFallbackGroundedText('既存顧客基盤から生まれる改善提案を構造化し実装する。'),
                      mainLever: 'ARPU',
                      horizon: 'short',
                      kind: 'growth',
                      // ★致命修正: required fields を追加
                      citations: buildFallbackCitations(),
                      valueDriverLinks: (valueDriverKPIs ?? []).slice(0, 2).map((k:any)=>k.id).filter(Boolean),
                      skillRequirements: {},
                      humanInvestments: [],
                    } as NormProject,
                  ].slice(0, 2);

              const safeNewProjects = newProjects.length >= 1
                ? newProjects
                : [
                    {
                      title: `[AI#3] ${name}の新規探索・新サービス検証`,
                      reason: buildFallbackGroundedText('将来成長の可能性を検証する'),
                      hypothesis: buildFallbackGroundedText('特定の顧客課題に対し小さく提供すれば、反応が得られ、スケールの条件が見えるはず。'),
                      mainLever: 'FUTURE',
                      horizon: 'mid',
                      kind: 'future',
                      // ★致命修正: required fields を追加
                      citations: buildFallbackCitations(),
                      valueDriverLinks: (valueDriverKPIs ?? []).slice(0, 2).map((k:any)=>k.id).filter(Boolean),
                      skillRequirements: {},
                      humanInvestments: [],
                    } as NormProject,
                  ];

              const allProjects = [...safeExistingProjects, ...safeNewProjects];

              // ★ missionDescription のフォールバック（API から空の場合は簡易生成）
              let missionDescription = typeof d?.missionDescription === 'string' ? d.missionDescription.trim() : '';
              if (!missionDescription && missionDraft) {
                // 最低限の説明をロジックで生成
                const focusThemesText = (d?.focusThemes ?? []).slice(0, 2).join('、') || '事業成長';
                const directionText = d?.direction ? `（${d.direction}）` : '';
                missionDescription = `${missionDraft}を実現するために、${focusThemesText}に注力します${directionText}。`;
              }

              // ★ TASK 6: [AI#] prefix を完全除去（返却前処理）
              const stripAllAiPrefixes = (proj: any) => {
                const stripped = stripAiPrefix(proj?.title ?? '');
                return { ...proj, title: ensurePrefix(name, stripped) };
              };

              const cleanedMissionDraft = stripAiPrefix(missionDraft);
              const cleanedMissionDescription = stripAiPrefix(missionDescription);

              // ★ P0: 全プロジェクトに部門名prefix強制（[AI#]除去後）
              const prefixedExistingProjects = safeExistingProjects.map(stripAllAiPrefixes);
              const prefixedNewProjects = safeNewProjects.map(stripAllAiPrefixes);

              return {
                name,
                missionDraft: cleanedMissionDraft,
                missionDescription: cleanedMissionDescription,

                lanes: {
                  existing: {
                    projects: prefixedExistingProjects,
                  },
                  new: {
                    projects: prefixedNewProjects,
                  },
                },

                // ★ API安全策：lanes が返せるなら projects は空（重複防止）
                // 後方互換は x-cascade-shape ヘッダで判定して UI側が切り分ける
                projects: [],

                needsCollab: trimList(d?.needsCollab, 6),
                stopList: trimList(d?.stopList, 6),
                first90Days: trimList(d?.first90Days, 8),
                riskNotes: trimList(d?.riskNotes, 6),
              };
            })
            .filter(Boolean)
        : [],
    };

    // ★ TASK 4-1: 返却直前ログ（LLMのKRが潰れていないか確認）
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        if (!dept) continue;
        console.log('[proof][before_ensure]', {
          dept: dept.name,
          existing: dept?.lanes?.existing?.projects?.map((p: any) => ({
            title: p?.title,
            okrsLen: p?.okrs?.length ?? 0,
            kr0: p?.okrs?.[0]?.keyResults?.[0],
            kr1: p?.okrs?.[0]?.keyResults?.[1],
          })) ?? [],
          new: dept?.lanes?.new?.projects?.map((p: any) => ({
            title: p?.title,
            okrsLen: p?.okrs?.length ?? 0,
            kr0: p?.okrs?.[0]?.keyResults?.[0],
            kr1: p?.okrs?.[0]?.keyResults?.[1],
          })) ?? [],
        });
      }
    }

    // ★ STAGE3: TASK 2 - 反映度スコアリング（デバッグログ）
    if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' && Array.isArray(result?.departments)) {
      for (const d of result.departments) {
        const deptName = pickName(d);
        const deptInput = deptInputByName.get(deptName);
        const deptAnswers6 = pickDeptAnswers6(deptInput);

        // ★修正: okrs も含める
        const allOkrs = [
          ...(d?.lanes?.existing?.projects || []).flatMap((p: any) =>
            (p.okrs || []).map((okr: any) => `${okr.objective || ''} ${(okr.keyResults || []).join(' ')}`)
          ),
          ...(d?.lanes?.new?.projects || []).flatMap((p: any) =>
            (p.okrs || []).map((okr: any) => `${okr.objective || ''} ${(okr.keyResults || []).join(' ')}`)
          ),
        ];

        const generatedText = [
          d?.missionDraft || '',
          d?.missionDescription || '',
          ...(d?.lanes?.existing?.projects || []).map((p: any) => `${p.title} ${p.reason || ''} ${p.hypothesis || ''}`),
          ...(d?.lanes?.new?.projects || []).map((p: any) => `${p.title} ${p.reason || ''} ${p.hypothesis || ''}`),
          ...allOkrs,
        ].join(' ');

        const { topTokens, coveragePct, hitTokens } = scoreDept6Impact(deptAnswers6, generatedText);
        console.log('[cascade][dept6][impact]', {
          dept: deptName,
          topTokens: topTokens.slice(0, 10),
          coveragePct,
          hitTokens,
        });
      }
    }

    // ★ TASK C: AI keyResults が空のプロジェクトを検出 & ログ出力
    // 実際の retry は複雑なため、ここではログ出力のみ。ensureKeyResults() がテンプレ補完
    const emptyKrProjects: {deptName: string; projectTitle: string; lane?: string}[] = [];
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        const deptName = dept?.name ?? '';
        const checkProject = (p: any, lane?: string) => {
          const krLen = p?.okrs?.[0]?.keyResults?.length ?? 0;
          if (krLen === 0) {
            emptyKrProjects.push({deptName, projectTitle: p?.title, lane});
          }
        };
        dept?.lanes?.existing?.projects?.forEach((p: any) => checkProject(p, 'existing'));
        dept?.lanes?.new?.projects?.forEach((p: any) => checkProject(p, 'new'));
        dept?.projects?.forEach((p: any) => checkProject(p));
      }

      // ログ出力：retry 対象となるプロジェクト
      for (const item of emptyKrProjects) {
        console.log(
          `[cascade][kpi][retry] project="${item.projectTitle}" dept="${item.deptName}" ` +
          `attempt=2 reason=ai_empty`
        );
      }
    }

    // ★ TASK 2-2: 返却前に全プロジェクトに okrs を保証（LLMの漏れ補完 + AI再生成）
    if (Array.isArray(result?.departments)) {
      result.departments = await ensureOkrsForAllDepts(result.departments);
    }

    // ★ TASK 5: AI成功率ログ（部門ごとに集計）
    if (Array.isArray(result?.departments)) {
      for (const dept of result.departments) {
        if (!dept?.name) continue;

        let totalProjects = 0;
        let aiProjects = 0;
        let templateProjects = 0;

        const checkProjects = (projects: any[]) => {
          if (!Array.isArray(projects)) return;
          for (const p of projects) {
            totalProjects++;
            const krSource = (p as any)?._krSource;
            if (krSource === 'AI') aiProjects++;
            else if (krSource === 'TEMPLATE') templateProjects++;
          }
        };

        // lanes.existing.projects と lanes.new.projects をチェック
        checkProjects(dept?.lanes?.existing?.projects);
        checkProjects(dept?.lanes?.new?.projects);
        // 旧形式も確認
        checkProjects(dept?.projects);

        if (totalProjects > 0) {
          console.log(
            `[generate-cascade][ai-rate] dept="${dept.name}" total=${totalProjects} ai=${aiProjects} template=${templateProjects} success_rate=${((aiProjects / totalProjects) * 100).toFixed(1)}%`
          );
        }
      }
    }

    // ★ TASK C: サーバ返却直前ログ（final段階：テンプレ注入後の確認）
    // [proof][final] に改名し、メタ情報も併記
    const ex0 = result?.departments?.[0]?.lanes?.existing?.projects?.[0] ?? result?.departments?.[0]?.projects?.[0];
    const ex0_krSource = (ex0 as any)?._krSource ?? '不明';
    const ex0_krReason = (ex0 as any)?._krReason ?? '情報なし';
    const ex0_krSourceDetail = (ex0 as any)?._krSourceDetail ?? '情報なし';
    const ex0_rawType = (ex0 as any)?._rawType ?? '不明';
    const ex0_rawLen = (ex0 as any)?._rawLen ?? 'N/A';

