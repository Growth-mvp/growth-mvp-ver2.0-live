'use client';

import { Fragment, type ReactNode } from 'react';
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
  /** 正式データのプロジェクトのID（編集・計画から外す操作に使う） */
  id?: string;
  /** 作業版では計画から外す予定。確定すると正式データから外れる */
  removed?: boolean;
  /** 編集中だけ渡す編集欄。渡すと、通常の説明の代わりに表示する */
  editor?: ReactNode;
  /** 編集中だけ渡す操作（計画から外す・元に戻す など） */
  action?: ReactNode;
};

/** 戦略書の文章として編集できる項目（再生成の項目と同じ名前） */
export type TextItemKey =
  | 'mission'
  | 'missionDescription'
  | 'currentPosition'
  | 'strategicRole'
  | 'keyIssues'
  | 'intraCollab'
  | 'interCollab'
  | 'alignmentRiskPoints'
  | 'reviewSummary'
  | 'stopList'
  | 'riskNotes';

export type SectionEdit = { action: ReactNode; editor: ReactNode | null };

export type StrategyDocumentProps = {
  departmentName: string;
  versionLabel: string;
  /** 項目ごとの表示内容。空の項目は表示しない（補完しない）。 */
  texts: Partial<Record<TextItemKey, string[]>>;
  projects: DocProject[];
  /** 編集できる項目だけ渡す。 */
  edit?: Partial<Record<TextItemKey, SectionEdit>>;
};

type ChapterItem = { key: TextItemKey; label?: string; list: boolean };
type Chapter = { title: string; items: ChapterItem[] } | { title: string; projects: true };

/** 章の順序。STAGE4以降が参照する項目も、必ずどこかの章に出す。 */
const CHAPTERS: Chapter[] = [
  {
    title: '事業・部門の使命',
    items: [
      { key: 'mission', list: false },
      { key: 'missionDescription', label: '概要・仮説', list: false },
      { key: 'currentPosition', label: '現在の位置づけ', list: false },
    ],
  },
  { title: '全社戦略における役割', items: [{ key: 'strategicRole', list: false }] },
  { title: '重点課題と勝ち筋', items: [{ key: 'keyIssues', list: true }] },
  { title: '重点プロジェクト', projects: true },
  { title: '事業内・部門内の連携', items: [{ key: 'intraCollab', list: true }] },
  { title: '他の事業・部門との連携', items: [{ key: 'interCollab', list: true }] },
  {
    title: '注意点・再考ポイント',
    items: [
      { key: 'alignmentRiskPoints', label: '認識のズレが起きやすいポイント', list: true },
      { key: 'reviewSummary', label: '再考ポイント・部門横断論点', list: true },
      { key: 'stopList', label: '停止事項', list: true },
      { key: 'riskNotes', label: 'リスク注記', list: true },
    ],
  },
];

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

function Chapter2({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-section space-y-4">
      <h4 className="border-l-4 border-zinc-800 pl-3 text-base font-bold text-zinc-900">{title}</h4>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function TextBlock({ item, lines, edit }: { item: ChapterItem; lines: string[]; edit?: SectionEdit }) {
  return (
    <div className="report-text space-y-2">
      {item.label && <p className="text-xs font-semibold text-zinc-500">{item.label}</p>}
      {edit?.editor ? (
        edit.editor
      ) : (
        <>
          {item.list ? (
            <ul className="list-disc space-y-1 pl-5 text-[15px] leading-7">
              {lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="whitespace-pre-wrap text-[15px] leading-7">{lines.join('\n')}</p>
          )}
          {edit?.action && <div className="flex justify-end">{edit.action}</div>}
        </>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: DocProject }) {
  const label = project.removed ? '計画から外す予定（確定すると外れます）' : ORIGIN_LABEL[project.origin];
  const badgeClass = project.removed || project.origin === 'candidate'
    ? 'rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800'
    : 'rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700';
  return (
    <div className={`report-card space-y-2 border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0 ${project.removed ? 'opacity-80' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {!project.editor && <h5 className="font-semibold text-zinc-900">{project.title}</h5>}
        {label && <span className={badgeClass}>{label}</span>}
        {project.group !== 'other' && <span className="text-xs text-zinc-500">{GROUP_LABEL[project.group]}</span>}
      </div>
      {project.editor ? (
        project.editor
      ) : (
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
      )}
      {project.action && <div className="flex flex-wrap justify-end gap-2">{project.action}</div>}
    </div>
  );
}

/**
 * 事業・部門戦略書の読み物。STAGE4の計画書と同じく、章ごとに文章を読み、直したい項目だけ編集する。
 * 内容のある項目だけを表示する（無い項目を補完しない）。編集中の項目は編集欄に置き換える。
 */
export function StrategyBookDocument(props: StrategyDocumentProps) {
  const { departmentName, versionLabel, texts, projects, edit } = props;
  return (
    <article className="mx-auto max-w-[72ch] space-y-8 text-zinc-900">
      <header className="space-y-1 border-b border-zinc-200 pb-4">
        <p className="text-xs text-zinc-500">{versionLabel}</p>
        <h3 className="text-xl font-bold">{departmentName}の戦略書</h3>
        <p className="text-sm text-zinc-600">AIたたき台</p>
      </header>

      {CHAPTERS.map((chapter) => {
        if ('projects' in chapter) {
          const active = projects.filter((p) => !p.removed);
          const removed = projects.filter((p) => p.removed);
          return (
            <Fragment key={chapter.title}>
              {active.length > 0 && (
                <Chapter2 title={chapter.title}>
                  {active.map((p, i) => (
                    <ProjectCard key={`${p.title}-${i}`} project={p} />
                  ))}
                </Chapter2>
              )}
              {removed.length > 0 && (
                <Chapter2 title="計画から外す予定">
                  {removed.map((p, i) => (
                    <ProjectCard key={`removed-${p.title}-${i}`} project={p} />
                  ))}
                </Chapter2>
              )}
            </Fragment>
          );
        }
        const shown = chapter.items.filter((item) => (texts[item.key]?.length ?? 0) > 0 || edit?.[item.key]?.editor);
        if (shown.length === 0) return null;
        return (
          <Chapter2 key={chapter.title} title={chapter.title}>
            {shown.map((item) => (
              <TextBlock key={item.key} item={item} lines={texts[item.key] ?? []} edit={edit?.[item.key]} />
            ))}
          </Chapter2>
        );
      })}
    </article>
  );
}
