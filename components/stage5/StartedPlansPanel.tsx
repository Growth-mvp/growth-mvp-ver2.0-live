'use client';

/* STAGE5 の実行計画（STAGE4で実行開始済みのもの）を読み取り専用で表示する。
 * 書き込みはしない。プロジェクトIDで照合し、IDが重複しているプロジェクトの計画は表示しない。 */
import { useEffect, useMemo, useState } from 'react';

import { currentPlanStoreKind, planStoreFor } from '@/components/okr/execution-plan/planStores';
import { isStage4DocumentScreenEnabled } from '@/lib/stage4/plan/documentScreenFlag';
import type { PlanStoreKind } from '@/lib/stage4/plan/planClient';
import type { PlanDocActor, PlanDocKey } from '@/lib/stage4/plan/planDocumentStore';
import { loadStartedPlans, type StartedPlanView } from '@/lib/stage5/startedPlans';
import { effectiveProjectId, findDuplicateProjectIds } from '@/lib/strategy/projectIds';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

type Item = { key: PlanDocKey; departmentName: string; projectTitle: string; duplicated: boolean };
type Loaded =
  | { disabled: true }
  | { disabled: false; unavailable: string }
  | { disabled: false; views: StartedPlanView[]; failed: number; duplicated: string[] };

/* 公開前（APIが無効と分かった）後は、このページの表示の間は再び要求しない */
let planApiDisabled = false;

const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('ja-JP') : '';
};

export function StartedPlansPanel() {
  const companyId = useStrategyStore((st) => (st as unknown as { companyId?: string }).companyId ?? '');
  const strategyId = useStrategyStore((st) => (st as unknown as { strategyId?: string }).strategyId ?? '');
  const departments = useStrategyStore((st) => (st as unknown as { departments?: unknown }).departments);
  const userId = useUserStore((st) => st.user?.id ?? '');
  const role = useUserStore((st) => st.role ?? '');

  const itemsJson = useMemo(() => {
    const depts = (Array.isArray(departments) ? departments : []) as Array<{ name?: unknown; projects?: unknown }>;
    const dup = new Set(findDuplicateProjectIds(depts as Array<Record<string, unknown>>).map((d) => d.id));
    const items: Item[] = [];
    for (const d of depts) {
      const projects = Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : [];
      for (const p of projects) {
        const projectId = effectiveProjectId(p);
        if (projectId === null) continue;
        items.push({
          key: { companyId, strategyId, projectId },
          departmentName: typeof d?.name === 'string' ? d.name : '',
          projectTitle: typeof p.title === 'string' ? p.title : '',
          duplicated: dup.has(projectId),
        });
      }
    }
    return JSON.stringify(items);
  }, [departments, companyId, strategyId]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /* 保存先はAPI（remote）のときだけ表示する。既定のブラウザ内の保存先では、既存利用者の画面を変えない */
  const [kind, setKind] = useState<PlanStoreKind | null>(null);
  useEffect(() => setKind(currentPlanStoreKind()), []);

  useEffect(() => {
    if (kind !== 'remote' || !isStage4DocumentScreenEnabled() || !companyId || !strategyId || !userId || !role) {
      setLoaded(null);
      return;
    }
    if (planApiDisabled) {
      setLoaded({ disabled: true });
      return;
    }
    let cancelled = false;
    const items = JSON.parse(itemsJson) as Item[];
    const store = planStoreFor('remote');
    const actor: PlanDocActor = { userId, memberships: [{ companyId, role }] };
    const duplicated = items.filter((i) => i.duplicated).map((i) => i.projectTitle);
    loadStartedPlans({
      items: items.filter((i) => !i.duplicated),
      load: (key) => store.load(actor, key),
    }).then((result) => {
      if (cancelled) return;
      if (result.disabled) planApiDisabled = true;
      if (result.disabled) return setLoaded({ disabled: true });
      if (result.unavailable) return setLoaded({ disabled: false, unavailable: result.unavailable });
      setLoaded({ disabled: false, views: result.views, failed: result.failed, duplicated });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, itemsJson, companyId, strategyId, userId, role]);

  if (kind !== 'remote' || !isStage4DocumentScreenEnabled()) return null;
  if (!companyId || !strategyId) return null;
  if (loaded?.disabled) return null;
  if (loaded && 'unavailable' in loaded) {
    return (
      <section aria-label="実行計画" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">実行計画（STAGE4・実行開始済み）</h2>
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{loaded.unavailable}</p>
      </section>
    );
  }
  const ready = loaded && !loaded.disabled && 'views' in loaded ? loaded : null;

  return (
    <section aria-label="実行計画" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-slate-800">実行計画（STAGE4・実行開始済み）</h2>
        <p className="text-xs text-slate-500">読み取り専用です。この画面から計画や進捗・実績は変更しません。</p>
      </header>

      {ready === null && <p className="text-sm text-slate-500">読み込み中…</p>}

      {ready && ready.duplicated.length > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          同じIDのプロジェクトがあるため、次の計画は表示していません：{ready.duplicated.join('、')}（STAGE3で確認してください）
        </p>
      )}
      {ready && ready.failed > 0 && (
        <p className="mb-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">一部の計画を読み込めませんでした。画面を開き直してください。</p>
      )}
      {ready && ready.views.length === 0 && ready.failed === 0 && (
        <p className="text-sm text-slate-500">実行開始済みの計画はまだありません。</p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {ready?.views.map((v) => (
          <article key={`${v.key.projectId}-${v.startedVersion}`} className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{v.departmentName}</p>
            <h3 className="text-base font-semibold text-slate-800">{v.projectTitle}</h3>
            <p className="mt-1 text-xs text-slate-600">
              開始日：{dateText(v.startedAt)}　担当：{v.responsible || '未定'}
            </p>

            <h4 className="mt-3 text-sm font-semibold text-slate-700">目的</h4>
            <dl className="mt-1 space-y-1 text-sm text-slate-700">
              {v.purpose.map((p) => (
                <div key={p.label}>
                  <dt className="inline text-xs text-slate-500">{p.label}：</dt>
                  <dd className="inline">{p.text}</dd>
                </div>
              ))}
            </dl>

            <h4 className="mt-3 text-sm font-semibold text-slate-700">KPI</h4>
            <div className="mt-1 overflow-x-auto">
              <table className="min-w-full text-left text-xs text-slate-700">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">KPI</th>
                    <th className="py-1 pr-2">目標</th>
                    <th className="py-1 pr-2">期限</th>
                    <th className="py-1 pr-2">担当</th>
                    <th className="py-1">区分</th>
                  </tr>
                </thead>
                <tbody>
                  {v.kpis.map((k, i) => (
                    <tr key={`${k.label}-${i}`} className="border-t border-slate-100">
                      <td className="py-1 pr-2">{k.label}</td>
                      <td className="py-1 pr-2">{k.target}</td>
                      <td className="py-1 pr-2">{k.due}</td>
                      <td className="py-1 pr-2">{k.owner}</td>
                      <td className="py-1">{k.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="mt-3 text-sm font-semibold text-slate-700">実施事項</h4>
            <ol className="mt-1 space-y-1 text-sm text-slate-700">
              {v.actions.map((a) => (
                <li key={a.no}>
                  <span className="font-medium">{a.no}. {a.title}</span>
                  {a.content && <span className="block text-xs text-slate-600">{a.content}</span>}
                  <span className="block text-xs text-slate-500">
                    期限：{a.due}　担当：{a.owner}
                  </span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

export default StartedPlansPanel;
