'use client';

import type { Department, MidtermStrategy } from '@/types/strategy';

/**
 * UI内部用：KPI体系ツリーの表示用データ構造
 * 保存対象ではなく、画面表示のみに使用
 */
type KpiTreeViewModel = {
  hasMidtermStrategy: boolean;
  companyThemes: string[];
  companyDecisionCriteria: string[];
  units: Array<{
    departmentId: string;
    departmentName: string;
    strategicRole?: string;
    keyIssues?: string[];
    kpis: Array<{
      label: string;
      source: 'okr' | 'project' | 'lane' | 'unknown';
    }>;
    risks?: string[];
  }>;
};

/**
 * KPI体系パネル：STAGE2の全社戦略・中計設計とSTAGE3の事業・部門別戦略から、
 * KPIのつながりを読み取り専用で表示する
 */
export function KpiTreePanel({
  departments,
  midtermStrategy,
}: {
  departments?: Department[];
  midtermStrategy?: MidtermStrategy;
}) {
  // KPI体系ビューモデルを組み立て
  const viewModel = buildKpiTreeViewModel(departments, midtermStrategy);

  // STAGE2/STAGE3がない場合のプレースホルダー
  if (!viewModel.hasMidtermStrategy && (!departments || departments.length === 0)) {
    return (
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/20 p-6">
        <h3 className="text-lg font-semibold text-indigo-800 dark:text-indigo-200">KPI体系：全社戦略から事業・部門KPIへ</h3>
        <p className="mt-1 text-sm text-indigo-700/80 dark:text-indigo-300/80">
          STAGE2の全社戦略とSTAGE3の事業・部門別戦略をもとに、KPIのつながりを確認します。
        </p>
        <div className="mt-4 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white/50 dark:bg-white/5 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            STAGE2の全社戦略・中計設計、またはSTAGE3の事業・部門別戦略がまだ生成されていません。
          </p>
        </div>
      </div>
    );
  }

  // 全社テーマ・判断基準がない場合のプレースホルダー
  if (!viewModel.hasMidtermStrategy) {
    return (
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/20 p-6">
        <h3 className="text-lg font-semibold text-indigo-800 dark:text-indigo-200">KPI体系：全社戦略から事業・部門KPIへ</h3>
        <p className="mt-1 text-sm text-indigo-700/80 dark:text-indigo-300/80">
          STAGE2の全社戦略とSTAGE3の事業・部門別戦略をもとに、KPIのつながりを確認します。
        </p>
        <div className="mt-4 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white/50 dark:bg-white/5 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            STAGE2の全社戦略・中計設計がまだ生成されていません。STAGE2で最終ストーリーを生成すると、ここにKPI体系が表示されます。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/20 p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-indigo-800 dark:text-indigo-200">KPI体系：全社戦略から事業・部門KPIへ</h3>
        <p className="mt-1 text-sm text-indigo-700/80 dark:text-indigo-300/80">
          STAGE2の全社戦略とSTAGE3の事業・部門別戦略をもとに、KPIのつながりを確認します。
        </p>
      </div>

      {/* 全社レベル */}
      {viewModel.companyThemes.length > 0 && (
        <div className="rounded-lg border border-indigo-300/50 dark:border-indigo-700/50 bg-white/60 dark:bg-white/5 p-4">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">全社の重点戦略テーマ</h4>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {viewModel.companyThemes.map((theme, i) => (
              <li key={`theme-${i}`} className="text-sm text-gray-700 dark:text-gray-300">
                {theme}
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewModel.companyDecisionCriteria.length > 0 && (
        <div className="rounded-lg border border-indigo-300/50 dark:border-indigo-700/50 bg-white/60 dark:bg-white/5 p-4">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">全社共通の判断基準</h4>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {viewModel.companyDecisionCriteria.map((criterion, i) => (
              <li key={`criterion-${i}`} className="text-sm text-gray-700 dark:text-gray-300">
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 事業・部門レベル */}
      {viewModel.units.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">事業・部門別KPI</h4>
          {viewModel.units.map((unit, unitIdx) => (
            <div key={`unit-${unitIdx}`} className="rounded-lg border border-gray-300/50 dark:border-gray-700/50 bg-white/60 dark:bg-white/5 p-4">
              <div className="font-medium text-gray-900 dark:text-gray-100">{unit.departmentName}</div>

              {unit.strategicRole && (
                <div className="mt-2 text-sm">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">中計上の役割：</span>
                  <span className="text-gray-700 dark:text-gray-300">{unit.strategicRole}</span>
                </div>
              )}

              {unit.keyIssues && unit.keyIssues.length > 0 && (
                <div className="mt-2 text-sm">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">主要課題：</span>
                  <ul className="mt-1 list-disc pl-5">
                    {unit.keyIssues.map((issue, i) => (
                      <li key={`issue-${unitIdx}-${i}`} className="text-gray-700 dark:text-gray-300">
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {unit.kpis.length > 0 ? (
                <div className="mt-2 text-sm">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">KPI候補：</span>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {unit.kpis.slice(0, 5).map((kpi, i) => (
                      <li key={`kpi-${unitIdx}-${i}`} className="text-gray-600 dark:text-gray-400">
                        {kpi.label} <span className="text-xs text-gray-500 dark:text-gray-500">({kpi.source})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-2 text-sm text-gray-500 dark:text-gray-500">KPI候補はまだ生成されていません。</div>
              )}

              {unit.risks && unit.risks.length > 0 && (
                <div className="mt-2 text-sm">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">実行リスク：</span>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {unit.risks.slice(0, 3).map((risk, i) => (
                      <li key={`risk-${unitIdx}-${i}`} className="text-gray-600 dark:text-gray-400 text-xs">
                        {risk}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {viewModel.units.length === 0 && viewModel.hasMidtermStrategy && (
        <div className="rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 bg-white/50 dark:bg-white/5 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            STAGE3の事業・部門別戦略がまだ生成されていません。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * KPI体系ビューモデルを構築する
 */
function buildKpiTreeViewModel(
  departments?: Department[],
  midtermStrategy?: MidtermStrategy,
): KpiTreeViewModel {
  const hasMidtermStrategy = !!(
    midtermStrategy &&
    typeof midtermStrategy === 'object' &&
    (midtermStrategy.priorityStrategicThemes?.length ||
      midtermStrategy.companyWideDecisionCriteria?.length ||
      Object.values(midtermStrategy).some((v) => v))
  );

  const companyThemes = Array.isArray(midtermStrategy?.priorityStrategicThemes)
    ? midtermStrategy.priorityStrategicThemes.filter((t) => typeof t === 'string' && t.trim())
    : [];

  const companyDecisionCriteria = Array.isArray(midtermStrategy?.companyWideDecisionCriteria)
    ? midtermStrategy.companyWideDecisionCriteria.filter((c) => typeof c === 'string' && c.trim())
    : [];

  const units: KpiTreeViewModel['units'] = [];

  if (Array.isArray(departments)) {
    for (const dept of departments) {
      const kpis: KpiTreeViewModel['units'][number]['kpis'] = [];

      // OKRからKPIを抽出
      if (Array.isArray(dept.okrs)) {
        for (const okr of dept.okrs) {
          if (okr.objective) {
            kpis.push({
              label: `${okr.objective}`,
              source: 'okr',
            });
          }
          if (Array.isArray(okr.keyResults)) {
            for (const kr of okr.keyResults) {
              if (typeof kr === 'string' && kr.trim()) {
                kpis.push({
                  label: kr,
                  source: 'okr',
                });
              }
            }
          }
        }
      }

      // projectsからKPIを抽出
      if (Array.isArray(dept.projects)) {
        for (const proj of dept.projects) {
          if (proj.title) {
            kpis.push({
              label: `${proj.title}`,
              source: 'project',
            });
          }
        }
      }

      const risks = Array.isArray(dept.riskNotes)
        ? dept.riskNotes.filter((r) => typeof r === 'string' && r.trim())
        : [];

      units.push({
        departmentId: String(dept.id || dept.name || ''),
        departmentName: dept.name || '（未命名）',
        strategicRole: typeof dept.strategicRole === 'string' ? dept.strategicRole : undefined,
        keyIssues: Array.isArray(dept.keyIssues)
          ? dept.keyIssues.filter((k) => typeof k === 'string' && k.trim())
          : undefined,
        kpis: kpis.slice(0, 10),
        risks: risks.slice(0, 3),
      });
    }
  }

  return {
    hasMidtermStrategy,
    companyThemes,
    companyDecisionCriteria,
    units,
  };
}
