/* ローカル動作確認用のハーネス（評価専用）。実コンポーネントを、DB・認証・アプリ本体に触れずに描画する。 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FinanceEffectSection } from '@/components/okr/FinanceEffectSection';
import { TargetOverview } from '@/components/stage6/TargetOverview';
import { FinancialExclusionNotice } from '@/components/stage6/FinancialExclusionNotice';
import { TabImpact } from '@/components/stage6/TabImpact';
import { Cell } from '@/components/stage6/CashFlowSection';
import { FinancePlanSection } from '@/components/stage6/FinancePlanSection';

const w = window as any;
w.__calls = [] as any[];

function FinanceHarness(props: { id: string; initial?: any }) {
  const [effect, setEffect] = useState<any>(props.initial);
  return (
    <div id={props.id}>
      <FinanceEffectSection
        effect={effect}
        disabled={false}
        overlapCandidates={[]}
        onChange={(next: any) => {
          w.__calls.push({ id: props.id, next });
          setEffect(next);
        }}
      />
    </div>
  );
}

const summary = {
  revenue: { forecast: 900, target: 1000, gap: 100 },
  op: { forecast: 60, target: 70, gap: 10 },
};

function App() {
  return (
    <div>
      <section id="s-fin-empty"><FinanceHarness id="fin-empty" /></section>
      <section id="s-fin-notfin">
        <FinanceHarness id="fin-notfin" initial={{ kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false }} />
      </section>
      <section id="s-north-star">
        <TargetOverview
          northStarRows={[] as any}
          dashboardSummary={summary as any}
          excludedImpacts={[
            { projectId: '営業部::新規開拓::1', targetId: 'rev', valueMJPY: 10, reason: '同名の施策が複数あり、どれか特定できない' },
            { projectId: 'uid-deleted', targetId: 'rev', valueMJPY: 7, reason: '施策が見つからない（削除された、または未保存の可能性）' },
          ]}
        />
      </section>
      <section id="s-exclusion">
        <FinancialExclusionNotice
          items={[
            { id: 'k1', label: '新規商談数', kind: 'ACQ' as any, reason: '商談数・件数・率を売上増加へ換算する根拠が未設定' },
            { id: 'k2', label: '投資計画', kind: 'INVEST' as any, reason: '投資目標は支出条件（CAPEX・OPEX）から計上するため、KRの金額は営業費用へ加算しない' },
          ]}
        />
      </section>
      <section id="s-tab-impact">
        <TabImpact
          projectContrib={[
            { key: 'p1', proj: '未算定の施策', dept: '営業部', targetRevenueMJPY: 100, targetOpIncomeMJPY: 10, deltaRevenueTotal: 0, deltaOpTotal: 0, krCount: 2, financeExcludedKrCount: 2 } as any,
            { key: 'p2', proj: '算定済みの施策', dept: '営業部', targetRevenueMJPY: 100, targetOpIncomeMJPY: 10, deltaRevenueTotal: 120, deltaOpTotal: 12, krCount: 2, financeExcludedKrCount: 0 } as any,
          ]}
          core={{ deptNames: ['営業部'] }}
          deptFilter="all"
          setDeptFilter={() => {}}
          selectedProjectKeys={[]}
          selectedSet={new Set<string>()}
          selectedSummary={{ deltaRev: 0, deltaOp: 0, invest: 0 }}
          toggleProject={() => {}}
          selectAllFiltered={() => {}}
          clearAllFiltered={() => {}}
          revenueGapMJPY={80}
          opGapMJPY={8}
        />
      </section>
      <section id="s-finance-plan">
        <FinancePlanSection />
      </section>
      <section id="s-cashflow">
        <table>
          <tbody>
            <tr id="cf-user">
              <Cell cell={{ value: 120, basis: 'USER', note: '利用者指定' } as any} interpolated />
              <Cell cell={{ value: 80, basis: 'ESTIMATE', note: '推計' } as any} />
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
