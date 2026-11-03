/* STAGE4 の財務効果入力と STAGE6 の条件付き試算を、同じ架空の店舗ストアで接続して描画する（評価専用）。 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useStrategyStore } from '@/store/strategyStore';
import { FinanceEffectSection } from '@/components/okr/FinanceEffectSection';
import { FinancePlanSection } from '@/components/stage6/FinancePlanSection';
import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';

const TITLE = '新規顧客開拓';
const w = window as any;
w.__getStrategyState = () => useStrategyStore.getState();

function locate(): { d: number; p: number } | null {
  const st: any = useStrategyStore.getState();
  for (let d = 0; d < st.departments.length; d++) {
    const p = (st.departments[d].projects ?? []).findIndex((x: any) => x.title === TITLE);
    if (p >= 0) return { d, p };
  }
  return null;
}

function patchProject(patch: Record<string, unknown>) {
  const loc = locate();
  if (!loc) return;
  const next: any = applyProjectImpactPatch(useStrategyStore.getState(), loc.d, loc.p, patch);
  useStrategyStore.setState({ departments: next.departments });
}

function Stage4Panel() {
  const st: any = useStrategyStore((s: any) => s);
  const loc = locate();
  const project = loc ? st.departments[loc.d].projects[loc.p] : undefined;
  return (
    <section id="s-stage4" aria-label="STAGE4 財務効果">
      <h3>STAGE4：{TITLE}</h3>
      {project && (
        <FinanceEffectSection
          effect={project.financeEffect}
          legacy={{ revenueMJPY: project.impactRevenueMJPY, opIncomeMJPY: project.impactOpIncomeMJPY }}
          disabled={false}
          overlapCandidates={[]}
          onChange={(next: any) => patchProject({ financeEffect: next })}
        />
      )}
    </section>
  );
}

function App() {
  return (
    <div>
      <Stage4Panel />
      <section id="s-stage6" aria-label="STAGE6 財務計画">
        <FinancePlanSection />
      </section>
    </div>
  );
}

/* 旧来の北極星の金額（50百万円）を同じ施策に入れておき、条件付き試算と区別できるかを確認する */
if (locate()) patchProject({ impactRevenueMJPY: 50 });

/* STAGE2の経営目標に期限年を入れ、統一PLの目標差額を確認できるようにする（架空） */
useStrategyStore.setState({
  companyTargets: (useStrategyStore.getState().companyTargets ?? []).map((t: any) => ({ ...t, dueYear: t.label === '営業利益' ? 2026 : 2028 })),
});

/* 条件付きCFの検査用に、基準年度の支払利息を入れる（架空：借入計画の利息の代わり） */
useStrategyStore.setState({
  financePL: (useStrategyStore.getState().financePL ?? []).map((r: any) => (r.year === 2025 ? { ...r, interest: 2_000_000 } : r)),
});

createRoot(document.getElementById('root')!).render(<App />);
