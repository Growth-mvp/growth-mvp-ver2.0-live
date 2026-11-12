/* 新STAGE3の画面（検証用の入口）。本番のカスケード画面と同じ部品（戦略書パネル・6問の入力部品）を、検証用の状態で表示する。 */
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StrategyBookPanel, type StrategyBookGate, type StrategyBookGenerateResult } from '@/components/stage3/StrategyBookPanel';
import DepartmentQuestionStepper from '@/components/guide/QuestionStepper.dept';

type Dept = {
  id?: string;
  name: string;
  mission?: string;
  projects: Array<{ id?: string; title: string }>;
  answers2?: Array<{ steps: unknown[] }>;
};
type HarnessState = { companyId: string; strategyId: string; revision: number; departments: Dept[] };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
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
          void post('/harness/answers', { index, steps: answers }).then(load);
        }}
      />
    );
  };

  return (
    <StrategyBookPanel
      departments={st.departments as never}
      canEdit
      getWriteGate={getWriteGate}
      generateDepartment={generateDepartment}
      renderSixQuestions={renderSixQuestions}
      onConfirmed={async (message) => {
        (window as unknown as { __confirmMessage?: string }).__confirmMessage = message;
        await load();
      }}
      onExportDepartment={async (name) => {
        const r = await post<unknown>('/harness/pdf', { departmentName: name });
        (window as unknown as { __pdf?: unknown }).__pdf = r;
      }}
    />
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
