/* 新STAGE3の画面（検証用の入口）。本番のカスケード画面と同じ部品（戦略書パネル・6問の入力部品）を、検証用の状態で表示する。 */
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrategyBookDesk, type StrategyBookGate, type StrategyBookGenerateResult } from '@/components/stage3/StrategyBookDesk';
import DepartmentQuestionStepper from '@/components/guide/QuestionStepper.dept';
import { useStage3PdfExport } from '@/hooks/useStage3PdfExport';
import { buildStage3ReportData } from '@/utils/export/buildStage3ReportData';

type Dept = {
  id?: string;
  name: string;
  mission?: string;
  projects: Array<{ id?: string; title: string }>;
  answers2?: Array<{ steps: unknown[] }>;
};
type HarnessState = {
  companyId: string;
  strategyId: string;
  companyName: string;
  revision: number;
  departments: Dept[];
  finalStoryFinal: unknown;
};

/* 既存のPDF出力フック（useStage3PdfExport）を、検証用の確定版の内容で動かす */
function PdfHost({ state }: { state: Record<string, unknown> }) {
  (globalThis as unknown as { __harnessStore?: unknown }).__harnessStore = state;
  const { exportDepartmentStrategyBookPdf } = useStage3PdfExport();
  useEffect(() => {
    (window as unknown as { __exportPdf?: unknown }).__exportPdf = exportDepartmentStrategyBookPdf;
    (window as unknown as { __reportFor?: unknown }).__reportFor = (departmentName: string) => {
      const departments = ((state.departments as Array<{ name: string }>) ?? []).filter((d) => d.name === departmentName);
      return buildStage3ReportData({ ...state, departments } as never);
    };
  }, [exportDepartmentStrategyBookPdf, state]);
  return null;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

/* 6問の回答の保存（カスケード画面と同じ考え方）：未保存の回答を保存する関数と、進行中の保存の結果 */
const answerFlushes: Record<number, () => void> = {};
const latestSteps: Record<number, unknown[]> = {};

async function saveAnswers(index: number, steps: unknown[]): Promise<boolean> {
  const res = await fetch('/harness/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ index, steps }) });
  return res.ok;
}

function App() {
  const [st, setSt] = useState<HarnessState | null>(null);

  const load = useCallback(async () => {
    setSt((await fetch('/harness/state').then((r) => r.json())) as HarnessState);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!st) return <p>読み込み中…</p>;

  const getWriteGate = (): StrategyBookGate => ({
    ok: true,
    companyId: st.companyId,
    strategyId: st.strategyId,
    revision: st.revision,
  });

  const generateDepartment = async (index: number, mode: 'draft' | 'regen'): Promise<StrategyBookGenerateResult> =>
    post<StrategyBookGenerateResult>('/harness/generate', { index, mode });

  const prepareRegeneration = async (index: number): Promise<{ ok: true } | { ok: false; message: string }> => {
    answerFlushes[index]?.();
    const steps = latestSteps[index] ?? (st.departments[index].answers2?.[0]?.steps ?? []);
    const saved = await saveAnswers(index, steps);
    if (saved) return { ok: true };
    return { ok: false, message: '回答の保存に失敗したため、再生成していません。もう一度保存してから、お試しください。' };
  };

  const renderSixQuestions = (index: number) => {
    const dept = st.departments[index];
    return (
      <DepartmentQuestionStepper
        departmentName={dept.name}
        mission={dept.mission}
        projects={dept.projects.map((p) => p.title)}
        okrs={[]}
        initialStep={1}
        initialAnswers={(dept.answers2?.[0]?.steps ?? []) as never}
        onChange={({ answers }: { answers: unknown[] }) => {
          const current = dept.answers2?.[0]?.steps ?? [];
          if (JSON.stringify(current) === JSON.stringify(answers)) return;
          latestSteps[index] = answers;
          void saveAnswers(index, answers).then(load);
        }}
        onRegisterFlush={(flush) => {
          if (flush) answerFlushes[index] = flush;
          else delete answerFlushes[index];
        }}
      />
    );
  };

  return (
    <>
      <PdfHost
        state={{
          companyName: st.companyName,
          departments: st.departments,
          finalStoryFinal: st.finalStoryFinal,
          finalStoryEdited: undefined,
          finalStoryDraft: undefined,
          finalStory: undefined,
        }}
      />
      <StrategyBookDesk
        departments={st.departments as never}
        canEdit
        canManageDepartments
        getWriteGate={getWriteGate}
        readCompanyId={st.companyId}
        readStrategyId={st.strategyId}
        generateDepartment={generateDepartment}
        prepareRegeneration={prepareRegeneration}
        renderSixQuestions={renderSixQuestions}
        onConfirmed={async (message) => {
          (window as unknown as { __confirmMessage?: string }).__confirmMessage = message;
          await load();
        }}
        onExportDepartment={async (name, confirmedAt) => {
          const exporter = (window as unknown as { __exportPdf?: (o: { departmentName: string; confirmedAt?: string }) => Promise<void> }).__exportPdf;
          if (!exporter) throw new Error('PDF exporter is not ready');
          await exporter({ departmentName: name, confirmedAt });
        }}
        onAddDepartment={async (name, mission) => {
          await post('/harness/department', { op: 'add', name, mission });
          await load();
          return true;
        }}
        onRenameDepartment={async (index, name) => {
          await post('/harness/department', { op: 'rename', index, name });
          await load();
          return true;
        }}
        onDeleteDepartment={async (index) => {
          const res = await fetch('/harness/department', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'delete', index }) });
          await load();
          return res.ok;
        }}
      />
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
