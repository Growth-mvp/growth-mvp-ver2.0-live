
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
