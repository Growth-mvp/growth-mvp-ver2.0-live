'use client';

/* STAGE5 のプロジェクトモーダルに、STAGE4で実行開始した計画を読み取り専用で表示する。
 * 計画の内容（目的・KPI・実施事項）は変えない。実施事項の進捗・成果・課題・次の行動・紐づくKRだけを記録する。
 * 同じIDのプロジェクトが複数ある場合は、どの計画か特定できないため表示しない。 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { currentPlanStoreKind, planStoreFor } from '@/components/okr/execution-plan/planStores';
import { ActionProgressEditor, type LinkableKr } from '@/components/stage5/ActionProgressEditor';
import { findProjectPositionById } from '@/lib/stage4/planView/financeBridgeStore';
import type { Edits } from '@/lib/stage4/planView/documentModel';
import { isStage4DocumentScreenEnabled } from '@/lib/stage4/plan/documentScreenFlag';
import type { PlanDocActor, PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import { downloadProjectPlanPdf } from '@/lib/stage4/plan/projectPlanPdf';
import { progressOf, type ActionProgressRecord } from '@/lib/stage5/actionProgress';
import { startedPlanView, type StartedPlanView } from '@/lib/stage5/startedPlans';
import { findDuplicateProjectIds } from '@/lib/strategy/projectIds';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

type Status =
  | { kind: 'idle' }
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'failed' }
  | { kind: 'ready'; view: StartedPlanView; record: PlanDocRecord };

export type ProjectPlanSectionProps = {
  companyId: string;
  strategyId: string;
  projectId: string;
  departmentName: string;
  projectTitle: string;
  userId: string;
  onLoaded?: (view: StartedPlanView | null) => void;
  children?: ReactNode;
};

function progressFor(departments: unknown, projectId: string): { progress: Record<string, ActionProgressRecord>; krs: LinkableKr[] } {
  const found = findProjectPositionById(departments, projectId);
  const project = found?.project as Record<string, unknown> | undefined;
  const okrs = Array.isArray(project?.okrsV2) ? (project?.okrsV2 as Array<Record<string, unknown>>) : [];
  const krs: LinkableKr[] = okrs
    .filter((k) => typeof k.id === 'string' && k.id !== '')
    .map((k) => {
      const actual = k.actual as { value?: unknown; asOf?: unknown } | undefined;
      return {
        id: k.id as string,
        label: typeof k.label === 'string' ? k.label : '',
        target: typeof k.target === 'number' && Number.isFinite(k.target) ? k.target : null,
        unit: typeof k.unit === 'string' ? k.unit : '',
        due: typeof k.due === 'string' ? k.due : null,
        actual: typeof actual?.value === 'number' ? actual.value : null,
        asOf: typeof actual?.asOf === 'string' ? actual.asOf : null,
      };
    });
  return { progress: progressOf(project), krs };
}

export function ProjectPlanSection(props: ProjectPlanSectionProps) {
  const { companyId, strategyId, projectId, departmentName, projectTitle, userId, children } = props;
  const departments = useStrategyStore((st) => (st as unknown as { departments?: unknown }).departments);
  const companyName = useStrategyStore((st) => (st as unknown as { companyName?: string }).companyName ?? '');
  const role = useUserStore((st) => st.role ?? '');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const onLoadedRef = useRef(props.onLoaded);
  onLoadedRef.current = props.onLoaded;

  const duplicated = findDuplicateProjectIds((Array.isArray(departments) ? departments : []) as Array<Record<string, unknown>>).some(
    (d) => d.id === projectId,
  );

  useEffect(() => {
    if (currentPlanStoreKind() !== 'remote' || !isStage4DocumentScreenEnabled() || !companyId || !strategyId || !projectId || !userId || !role) {
      setStatus({ kind: 'off' });
      onLoadedRef.current?.(null);
      return;
    }
    if (duplicated) {
      setStatus({ kind: 'off' });
      onLoadedRef.current?.(null);
      return;
    }
    let cancelled = false;
    const key: PlanDocKey = { companyId, strategyId, projectId };
    const actor: PlanDocActor = { userId, memberships: [{ companyId, role }] };
    planStoreFor('remote')
      .load(actor, key)
      .then((out) => {
        if (cancelled) return;
        if (out.status === 'FOUND') {
          const view = startedPlanView({ expected: key, departmentName, projectTitle, record: out.record });
          setStatus(view ? { kind: 'ready', view, record: out.record } : { kind: 'none' });
          onLoadedRef.current?.(view);
          return;
        }
        if (out.status === 'NONE') setStatus({ kind: 'none' });
        else if (out.status === 'DISABLED') setStatus({ kind: 'off' });
        else setStatus({ kind: 'failed' });
        onLoadedRef.current?.(null);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
    // 表示名は読み込みの対象（企業・戦略・プロジェクト）に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, strategyId, projectId, userId, role, duplicated]);

  if (duplicated) {
    return (
      <>
      <section aria-label="実行計画" className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        同じIDのプロジェクトがあるため、どの計画か特定できず表示していません（STAGE3で確認してください）。
      </section>
      {children}
      </>
    );
  }

  if (status.kind === 'off' || status.kind === 'idle') return <>{children}</>;

  if (status.kind === 'none') {
    return (
      <>
      <section aria-label="実行計画" className="rounded-3xl border border-black/10 bg-white p-4 text-sm text-gray-600">
        実行開始済みの計画はまだありません。STAGE4で実行を開始すると、ここに計画の内容が表示されます。
      </section>
      {children}
      </>
    );
  }

  if (status.kind === 'failed') {
    return (
      <>
      <section aria-label="実行計画" className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        計画を読み込めませんでした。画面を開き直してください。
      </section>
      {children}
      </>
    );
  }

  const { view, record } = status;
  const progress = progressFor(departments, projectId);

  const openPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await downloadProjectPlanPdf({
        aiDraft: record.aiDraft,
        userEdits: record.userEdits as Edits,
        startInfo: record.startInfo ? { at: record.startInfo.at, version: record.startInfo.version } : null,
        companyName,
        generatedAt: new Date().toISOString(),
      });
    } catch {
      setPdfError('PDFを作成できませんでした。もう一度お試しください。');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <section aria-label="実行計画" className="space-y-4 rounded-3xl border border-black/10 bg-white p-5 shadow-sm">
      <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-1 text-xs font-medium tracking-wide text-gray-500">実行計画（STAGE4・実行開始済み）</div>
          <p className="text-xs text-gray-600">
            計画は読み取り専用です。
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 md:items-end">
          <button
            type="button"
            onClick={openPdf}
            disabled={pdfBusy}
            className="rounded-2xl border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {pdfBusy ? 'PDFを作成中…' : '実行計画書をPDFで開く'}
          </button>
          {pdfError && (
            <span role="alert" className="text-xs text-rose-700">
              {pdfError}
            </span>
          )}
        </div>
      </header>

      <p className="text-xs text-gray-600">責任者：{view.responsible || '未定'}</p>
      {children}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800">実施事項と進捗</h3>
        <ActionProgressEditor
          companyId={companyId}
          strategyId={strategyId}
          projectId={projectId}
          userId={userId}
          actions={view.actions}
          allowedKeys={view.actions.map((a) => a.actionKey).filter((k) => k !== '')}
          progress={progress.progress}
          krs={progress.krs}
        />
      </div>
    </section>
  );
}

export default ProjectPlanSection;
