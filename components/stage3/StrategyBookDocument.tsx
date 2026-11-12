'use client';

import type { ReactNode } from 'react';
import type { ProjectGroupKey, ProjectOrigin } from '@/lib/cascade/stage3ProjectDetail';
import { PROJECT_GROUPS } from '@/lib/cascade/stage3ProjectDetail';

export type DocProject = {
  title: string;
  origin: ProjectOrigin;
  group: ProjectGroupKey;
  objective: string | null;
  purpose: string | null;
  hypothesis: string | null;
  summary: string | null;
  partner: string | null;
  goals: string[];
};

export type StrategyDocumentProps = {
  departmentName: string;
  versionLabel: string;
  mission: string | null;
  strategicRole: string | null;
  keyIssues: string[];
  projects: DocProject[];
  interCollab: string[];
  adjustmentPoints: string[];
};

const ORIGIN_LABEL: Record<ProjectOrigin, string | null> = {
  official: '既存のプロジェクト',
  candidate: '新規候補（採用前）',
  unmatched: null,
};

const GROUP_LABEL = Object.fromEntries(PROJECT_GROUPS.map((g) => [g.key, g.label])) as Record<ProjectGroupKey, string>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-zinc-500">{label}</dt>
      <dd className="text-[15px] leading-7 text-zinc-800">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="border-l-4 border-zinc-800 pl-3 text-base font-bold text-zinc-900">{title}</h4>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ProjectCard({ project }: { project: DocProject }) {
  const label = ORIGIN_LABEL[project.origin];
  return (
    <div className="space-y-2 border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="font-semibold text-zinc-900">{project.title}</h5>
        {label && (
          <span
            className={
              project.origin === 'candidate'
                ? 'rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800'
                : 'rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700'
            }
          >
            {label}
          </span>
        )}
        {project.group !== 'other' && <span className="text-xs text-zinc-500">{GROUP_LABEL[project.group]}</span>}
      </div>
      <dl className="space-y-2">
        {project.objective && <Row label="目的">{project.objective}</Row>}
        {project.purpose && <Row label="選定理由">{project.purpose}</Row>}
        {project.hypothesis && <Row label="成果仮説">{project.hypothesis}</Row>}
        {project.goals.length > 0 && (
          <Row label="目標・指標">
            <ul className="list-disc pl-5">
              {project.goals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </Row>
        )}
        {project.partner && <Row label="連携先">{project.partner}</Row>}
        {!project.purpose && !project.hypothesis && project.summary && <Row label="概要">{project.summary}</Row>}
      </dl>
    </div>
  );
}

/** 事業・部門戦略書の読み物。存在する項目だけを出し、無い項目は補完しない。 */
export function StrategyBookDocument(props: StrategyDocumentProps) {
  const { departmentName, versionLabel, mission, strategicRole, keyIssues, projects, interCollab, adjustmentPoints } = props;
  return (
    <article className="mx-auto max-w-[72ch] space-y-8 text-zinc-900">
      <header className="space-y-1 border-b border-zinc-200 pb-4">
        <p className="text-xs text-zinc-500">{versionLabel}</p>
        <h3 className="text-xl font-bold">{departmentName}の戦略書</h3>
        <p className="text-sm text-zinc-600">AIたたき台</p>
      </header>

      {mission && (
        <Section title="事業・部門の使命">
          <p className="whitespace-pre-wrap">{mission}</p>
        </Section>
      )}

      {strategicRole && (
        <Section title="全社戦略における役割">
          <p className="whitespace-pre-wrap">{strategicRole}</p>
        </Section>
      )}

      {keyIssues.length > 0 && (
        <Section title="重点課題と勝ち筋">
          <ul className="list-disc space-y-1 pl-5">
            {keyIssues.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </Section>
      )}

      {projects.length > 0 && (
        <Section title="重点プロジェクト">
          <div className="space-y-5">
            {projects.map((p, i) => (
              <ProjectCard key={`${p.title}-${i}`} project={p} />
            ))}
          </div>
        </Section>
      )}

      {(interCollab.length > 0 || adjustmentPoints.length > 0) && (
        <Section title="他の事業・部門との連携・調整論点">
          {interCollab.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500">連携</p>
              <ul className="list-disc pl-5">
                {interCollab.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {adjustmentPoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500">調整論点</p>
              <ul className="list-disc pl-5">
                {adjustmentPoints.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}
    </article>
  );
}
