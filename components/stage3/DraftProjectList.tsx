'use client';

import type { ReactNode } from 'react';
import { projectDetailOf, PROJECT_GROUPS, type ProjectDetail } from '@/lib/cascade/stage3ProjectDetail';

type AnyRecord = Record<string, unknown>;

export type DraftProjectItem = { id?: unknown; title: string; description?: string; kpis?: string[] };

type Props = {
  projects: DraftProjectItem[];
  official: AnyRecord[];
  candidates: AnyRecord[];
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-zinc-500">{label}</div>
      <div className="text-sm leading-6 text-zinc-800">{children}</div>
    </div>
  );
}

function ProjectBody({ detail }: { detail: ProjectDetail }) {
  const showSummary = !detail.purpose && !detail.hypothesis && detail.summary;
  const hasGoals = detail.okrs.length > 0 || detail.kpis.length > 0;
  return (
    <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
      {detail.purpose && <Field label="狙い・選定理由">{detail.purpose}</Field>}
      {detail.hypothesis && <Field label="施策と期待成果の仮説">{detail.hypothesis}</Field>}
      {showSummary && <Field label="概要">{detail.summary}</Field>}
      {detail.partnerDepartment && <Field label="関係する部門・連携先">{detail.partnerDepartment}</Field>}
      {hasGoals && (
        <Field label="目標・指標">
          <div className="space-y-2">
            {detail.okrs.map((okr, i) => (
              <div key={i}>
                {okr.objective && <div className="font-medium">{okr.objective}</div>}
                {okr.keyResults.length > 0 && (
                  <ul className="list-disc pl-5">
                    {okr.keyResults.map((kr, j) => (
                      <li key={j}>{kr}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {detail.kpis.length > 0 && (
              <ul className="list-disc pl-5 text-zinc-700">
                {detail.kpis.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      )}
    </div>
  );
}

export function DraftProjectList({ projects, official, candidates }: Props) {
  const details = projects.map((p) => projectDetailOf(p, { official, candidates }));
  return (
    <div className="space-y-5">
      {PROJECT_GROUPS.map((group) => {
        const items = details.filter((d) => d.group === group.key);
        if (items.length === 0) return null;
        return (
          <section key={group.key} className="space-y-2">
            <h5 className="text-sm font-semibold text-zinc-900">
              {group.label}
              <span className="ml-2 text-xs font-normal text-zinc-500">{items.length}件</span>
            </h5>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {items.map((detail, idx) => (
                <details key={`${group.key}-${idx}-${detail.title}`}>
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium leading-6 text-zinc-900 hover:bg-zinc-50">
                    {detail.title}
                  </summary>
                  <ProjectBody detail={detail} />
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
