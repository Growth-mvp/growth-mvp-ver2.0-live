      '高付加価値', '付加価値', '強化', '改善', '推進', '最適化', '効率化', '省力化', '標準化',
      '商談', '案件', '受注', '獲得', '拡大', '新規開拓', '顧客開拓',
      '次世代', '仮説', '検証', '実証', 'poc', 'PoC', 'パイロット',
      'dx', 'DX', 'デジタル', 'データ活用', '体制', 'プロセス', '仕組み',
    ]);

    // normalizeForSim: title + reason を対象に類似度計算用に正規化
    const normalizeForSim = (text: string): Set<string> => {
      // stripAiPrefix
      let t = (text ?? '').replace(/^\s*\[ai#\d+\]\s*/i, '').trim();
      // toLowerCase + 記号除去 + 連続スペース除去
      t = t.toLowerCase().replace(/[！！?？。，、、\.,:;；：\-—–~～（）\(\)\[\]【】「」『』《》<>《》・]/g, ' ').replace(/\s+/g, ' ').trim();
      // 日本語/英数字を tokenize（例：text.split(/[^一-龠ぁ-んァ-ヶa-zA-Z0-9]+/)）
      const tokens = t.split(/[^一-龠ぁ-んァ-ヶa-zA-Z0-9]+/).filter(Boolean);
      // 2文字未満 token を除外
      const filtered = tokens.filter((tok: string) => tok.length >= 2);
      // STOP_WORDS を除外
      const result = filtered.filter((tok: string) => !STOP_WORDS_TASK3.has(tok.toLowerCase()));
      return new Set(result);
    };

    // tokenJaccard: token set で Jaccard 距離
    const tokenJaccard = (set1: Set<string>, set2: Set<string>): number => {
      if (set1.size === 0 && set2.size === 0) return 1;
      const intersection = new Set([...set1].filter((x: string) => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      if (union.size === 0) return 1;
      return intersection.size / union.size;
    };

    // 衝突検知＆再生成
    const detectAndFixSimilarProjects = async (depts: any[]): Promise<void> => {
      // 衝突を検知する
      const conflicts: Array<{
        deptAIdx: number;
        deptAName: string;
        laneTypeA: 'existing' | 'new';
        slotA: number;
        projA: any;
        deptBIdx: number;
        deptBName: string;
        laneTypeB: 'existing' | 'new';
        slotB: number;
        projB: any;
        score: number;
      }> = [];

      // 全 dept pair を走査
      for (let i = 0; i < depts.length; i++) {
        for (let j = i + 1; j < depts.length; j++) {
          const deptA = depts[i];
          const deptB = depts[j];
          const deptAName = deptA?.name ?? '';
          const deptBName = deptB?.name ?? '';

          // deptA の projects
          const projectsA: Array<{ laneType: 'existing' | 'new'; slot: number; proj: any }> = [];
          if (deptA?.lanes?.existing?.projects) {
            deptA.lanes.existing.projects.forEach((p: any, idx: number) => {
              projectsA.push({ laneType: 'existing', slot: idx + 1, proj: p });
            });
          }
          if (deptA?.lanes?.new?.projects) {
            deptA.lanes.new.projects.forEach((p: any, idx: number) => {
              projectsA.push({ laneType: 'new', slot: 3 + idx, proj: p });
            });
          }

          // deptB の projects
          const projectsB: Array<{ laneType: 'existing' | 'new'; slot: number; proj: any }> = [];
          if (deptB?.lanes?.existing?.projects) {
            deptB.lanes.existing.projects.forEach((p: any, idx: number) => {
              projectsB.push({ laneType: 'existing', slot: idx + 1, proj: p });
            });
          }
          if (deptB?.lanes?.new?.projects) {
            deptB.lanes.new.projects.forEach((p: any, idx: number) => {
              projectsB.push({ laneType: 'new', slot: 3 + idx, proj: p });
            });
          }

          // 全ペアで類似度計算
          for (const pA of projectsA) {
            for (const pB of projectsB) {
              const textA = `${pA.proj?.title ?? ''} ${pA.proj?.reason ?? ''}`;
              const textB = `${pB.proj?.title ?? ''} ${pB.proj?.reason ?? ''}`;

              const setA = normalizeForSim(textA);
              const setB = normalizeForSim(textB);
              const score = tokenJaccard(setA, setB);

              if (score >= 0.62) {
                conflicts.push({
                  deptAIdx: i,
                  deptAName,
                  laneTypeA: pA.laneType,
                  slotA: pA.slot,
                  projA: pA.proj,
                  deptBIdx: j,
                  deptBName,
                  laneTypeB: pB.laneType,
                  slotB: pB.slot,
                  projB: pB.proj,
                  score,
                });
              }
            }
          }
        }
      }

      if (conflicts.length === 0) return;

      // 衝突ログ
      for (const conflict of conflicts) {
        console.log(
          `[cascade][sim][conflict] deptA=${conflict.deptAName} deptB=${conflict.deptBName} slotA=${conflict.slotA} slotB=${conflict.slotB} score=${(conflict.score * 100).toFixed(1)}`
        );
      }

      // 衝突側（後に出てきた方 = deptB）だけ再生成
      const regen_attempts = new Map<string, number>(); // key: "deptName|laneType|slot"
      let totalRegenAttempts = 0;
      const MAX_REGEN_PER_PROJECT = 2;
      const MAX_TOTAL_REGEN = 6;

      for (const conflict of conflicts) {
        // deptB 側を再生成対象にする
        const key = `${conflict.deptBName}|${conflict.laneTypeB}|${conflict.slotB}`;
        const currentAttempts = regen_attempts.get(key) ?? 0;

        if (currentAttempts >= MAX_REGEN_PER_PROJECT || totalRegenAttempts >= MAX_TOTAL_REGEN) {
          console.log(`[cascade][sim][regen-skip] dept=${conflict.deptBName} slot=${conflict.slotB} reason="max_attempts"`);
          continue;
        }

        const attempt = currentAttempts + 1;
        regen_attempts.set(key, attempt);
        totalRegenAttempts++;

        console.log(`[cascade][sim][regen] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt}`);

        // 再生成prompt
        const factPack = factPackByDept.get(conflict.deptBName);
        const anchorsList = factPack?.anchors ?? [];
        const anchorsText = anchorsList.map((a: any) => `  - ${a.id}: ${a.text}`).join('\n');

        const retryPrompt = `
部門間で同じ内容のプロジェクト案が出現しました：

衝突相手の部門: ${conflict.deptAName}
衝突相手のプロジェクト:
- title: "${conflict.projA?.title ?? ''}"
- reason: "${conflict.projA?.reason ?? ''}"

以下の条件で修正してください：

【修正必須条件】
1. 衝突相手と同じ内容を避けること
2. 衝突相手と異なる固有名詞を使うこと
3. 衝突相手と異なるanchors を引用すること
4. mainLever を変える（可能であれば）
5. citations >= 2 & 「」引用 >= 2（「text」(fact-id) 形式で2回以上） & required fields（title/reason/hypothesis/mainLever/kind/horizon/valueDriverLinks>=1/skillRequirements/humanInvestments>=1）は必須

【このセグメントで利用可能なFACTPACK anchors】
${anchorsText || '（利用可能なanchorsなし）'}
※ citations は上記リストから選択すること、捏造禁止

修正後のプロジェクト案の JSON のみを返してください：

{
  "title": "...",
  "reason": "...",
  "hypothesis": "...",
  "mainLever": "ACQ" | "ARPU" | "CHURN" | "COST" | "EFFICIENCY" | "FUTURE",
  "horizon": "short" | "mid" | "long",
  "kind": "growth" | "cost" | "efficiency" | "future",
  "citations": ["fact-...", "fact-..."],
  "valueDriverLinks": [...],
  "skillRequirements": {...},
  "humanInvestments": [...],
  "generatedBy": "ai",
  "generatedSlot": ${conflict.slotB},
  "generatedGroup": "cascade_v1"
}
`.trim();

        try {
          // ★修正3: OpenAI リトライ機能を使用（fetch failed/UND_ERR_SOCKET 対策）
          const retryRaw = await callOpenAIJsonWithRetry(
            retryPrompt,
            '修正プロジェクト案の JSON のみを返してください。日本語で。',
            `conflict-retry-dept=${conflict.deptBName}`
          );
          const retryParsed = extractJsonObject(retryRaw);

          if (retryParsed) {
            const retrySafe = ProjectSchema.safeParse(retryParsed);
            const retryProject = retrySafe.success ? retrySafe.data : retryParsed;

            // 再検証: grounding + required fields
            if (isProjectGrounded(retryProject) && hasRequiredFields(retryProject)) {
              // 成功：差し替え
              if (conflict.laneTypeB === 'existing') {
                depts[conflict.deptBIdx].lanes.existing.projects[conflict.slotB - 1] = retryProject;
              } else {
                depts[conflict.deptBIdx].lanes.new.projects[conflict.slotB - 3] = retryProject;
              }
              console.log(`[cascade][sim][regen-success] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt}`);
            } else {
              // 再生成でもNGなら fallback
              const failReason = !isProjectGrounded(retryProject) ? 'grounding_ng' : 'required_fields_missing';
              console.warn(`[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="${failReason}"`);
              // ★バグ修正③: conflictFailedDepts に追加
              conflictFailedDepts.add(conflict.deptBName);
            }
          } else {
            // JSON解析失敗
            console.warn(`[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="json_parse_error"`);
            // ★バグ修正③: conflictFailedDepts に追加
            conflictFailedDepts.add(conflict.deptBName);
          }
        } catch (err) {
          console.warn(
            `[cascade][sim][regen-fail] dept=${conflict.deptBName} slot=${conflict.slotB} attempt=${attempt} reason="api_error" error=${err instanceof Error ? err.message : String(err)}`
          );
          // ★バグ修正③: conflictFailedDepts に追加
          conflictFailedDepts.add(conflict.deptBName);
        }
      }
    };

    // ★TASK 3 実行
    await detectAndFixSimilarProjects(Array.isArray(normalized?.departments) ? normalized.departments : []);

    // ★ TASK 2: [AI#] prefix 除去ヘルパー
    const stripAiPrefix = (title: string) => {
      return (title ?? '').replace(/^\s*\[ai#\d+\]\s*/i, '').trim();
    };

    // P0: Prefix強制用関数
    const ensurePrefix = (deptName: string, title: string) => {
      // ★ TASK 2: stripAiPrefix を先に適用
      const stripped = stripAiPrefix(title);
      const t = stripped.trim();
      if (!t) return `${deptName}：（未設定プロジェクト）`;
      return /^[^：:]+[：:]/.test(t) ? t : `${deptName}：${t}`;
    };

    // P1: baseTitle抽出（部門名prefixを剥がして正規化）
    const baseTitle = (deptName: string, title: string) => {
      const t = (title ?? '').trim();
      const dn = (deptName ?? '').trim();
      // "部門名：" を剥がす（: / ： 両対応）
      const re = dn ? new RegExp(`^${dn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]\\s*`) : null;
      const stripped = re ? t.replace(re, '') : t;
      // ★ TASK D: [AI#1]等のprefix を剥がす
      const stripped2 = stripped.replace(/^\[ai#\d+\]\s*/i, '');
      return stripped2
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[：:]/g, ':')
        .trim();
    };

    // テンプレ三種の神器（ロジック的に同一になりやすい）
    const GENERIC_BASE_TITLES = [
      '既存顧客のltv改善',
      '商談設計力の強化',
      '次世代サービス仮説検証',
    ];

    const isGeneric = (bt: string) => GENERIC_BASE_TITLES.some(g => bt.includes(g));

    const collectAllTitles = (depts: any[]) => {
      const titleMap = new Map<string, { deptNames: string[]; baseTitles: string[] }>();

      for (const dept of depts) {
        const deptName = dept?.name ?? '';
        const allProjects = [
          ...(dept?.lanes?.existing?.projects ?? []),
          ...(dept?.lanes?.new?.projects ?? []),
          ...(dept?.projects ?? []),
        ];

        for (const proj of allProjects) {
          const title = proj?.title ?? '';
          const bt = baseTitle(deptName, title);
          if (bt) {
            if (!titleMap.has(bt)) {
              titleMap.set(bt, { deptNames: [], baseTitles: [] });
            }
            const entry = titleMap.get(bt)!;
            if (!entry.deptNames.includes(deptName)) {
              entry.deptNames.push(deptName);
            }
            entry.baseTitles.push(title);
          }
        }
      }

