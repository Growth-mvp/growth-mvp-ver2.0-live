'use client';

import type { ReactNode } from 'react';
import {
  projectDetailOf,
  PROJECT_GROUPS,
  type DraftProjectInput,
  type ProjectDetail,
  type ProjectOrigin,
} from '@/lib/cascade/stage3ProjectDetail';

type AnyRecord = Record<string, unknown>;

export type DraftProjectItem = DraftProjectInput;

type Props = {
  projects: DraftProjectItem[];
  official: AnyRecord[];
  candidates: AnyRecord[];
};

const ORIGIN_LABEL: Record<ProjectOrigin, string | null> = {
  official: '既存（正式データ）',
  candidate: '新規候補（採用前）',
  unmatched: null,
};

const ORIGIN_CLASS: Record<ProjectOrigin, string> = {
  official: 'border-zinc-300 bg-zinc-50 text-zinc-700',
  candidate: 'border-amber-300 bg-amber-50 text-amber-800',
  unmatched: '',
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
  const officialCount = details.filter((d) => d.origin === 'official').length;
  const candidateCount = details.filter((d) => d.origin === 'candidate').length;
  return (
    <div className="space-y-5">
      <p className="text-xs text-zinc-600">
        既存のプロジェクト {officialCount}件・新規候補 {candidateCount}件（新規候補は採用するまで正式な計画に入りません）
      </p>
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
              {items.map((detail, idx) => {
                const originLabel = ORIGIN_LABEL[detail.origin];
                return (
                  <details key={`${group.key}-${idx}-${detail.title}`}>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium leading-6 text-zinc-900 hover:bg-zinc-50">
                      <span>{detail.title}</span>
                      {originLabel && (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-normal ${ORIGIN_CLASS[detail.origin]}`}>
                          {originLabel}
                        </span>
                      )}
                    </summary>
                    <ProjectBody detail={detail} />
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
