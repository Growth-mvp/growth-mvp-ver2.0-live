          project.valueDriverLinks = availableKPIs
            .slice(0, 2)
            .map((kpi: any) => kpi.id)
            .filter(Boolean);
        } else {
          project.valueDriverLinks = [];
        }
      }

      const archetype = inferProjectArchetype(project, deptName, lane);
      const template = getSkillsAndInvestmentsByArchetype(archetype);

      // 2. skillRequirements の補完
      if (!project.skillRequirements) project.skillRequirements = {};
      if (!project.skillRequirements.executionSkills || project.skillRequirements.executionSkills.length === 0) {
        project.skillRequirements.executionSkills = template.executionSkills.slice(0, 2);
      }
      if (!project.skillRequirements.roleSkills) {
        project.skillRequirements.roleSkills = template.roleSkills;
      }

      // 3. humanInvestments の補完
      if (!project.humanInvestments || project.humanInvestments.length === 0) {
        project.humanInvestments = template.investments;
      }
    }

    if (Array.isArray(normalized?.departments)) {
      for (const dept of normalized.departments) {
        const deptName = dept?.name ?? '';

        if (dept?.lanes?.existing?.projects) {
          for (const proj of dept.lanes.existing.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, 'existing');
        }
        if (dept?.lanes?.new?.projects) {
          for (const proj of dept.lanes.new.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, 'new');
        }
        if (Array.isArray(dept?.projects)) {
          for (const proj of dept.projects) fillMissingStage3Fields(proj, valueDriverKPIs, deptName, '');
        }
      }
    }

    const inputNames = new Set(onlyDeptNames(departments));

    const deptInputByName = new Map<string, any>();
    for (const d of departments) {
      const name = pickName(d);
      if (!name) continue;
      deptInputByName.set(name, d);
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
