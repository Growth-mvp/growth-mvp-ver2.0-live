// STAGE3の保存構造（strategy_data の departments → projects）と同じ形の、読み取り確認用のモック。
// 架空の企業・部門・プロジェクトだけを使う。実在の企業・DB・保存データとは対応しない。
import type { MembershipRow, StrategyRow } from '@/lib/stage4/plan/projectResolver';
import type { SavedPlanRecord } from '@/lib/stage4/plan/readModel';
import growthPlan from './growth.json';

export const STAGE3_SNAPSHOT_MEMBERSHIPS: MembershipRow[] = [{ company_id: 'fict-co-a', role: 'member' }];

export const STAGE3_SNAPSHOT_STRATEGIES: Array<StrategyRow & Record<string, unknown>> = [
  {
    id: 'fict-strategy-a',
    company_id: 'fict-co-a',
    strength: '工場向けの計測器で、高い精度と長い稼働実績を持つ',
    weakness: '医療機関の業務や購買の流れを知る社員が少ない',
    opportunity: '院内の記録を自動化したいという医療機関の需要が増えている',
    threat: '医療機器としての規制対応に、時間と費用がかかる',
    departments: [
      {
        id: 'dept-sales',
        name: '営業部',
        mission: '既存顧客との関係を深め、継続的に売上を伸ばす',
        missionDescription: '保守契約の継続と、紹介による新規の獲得を両立する',
        strategy: '既存顧客の保守契約を守りながら、紹介経由の顧客を増やす',
        finalized: true,
        projects: [
          {
            id: 'fict-proj-renewal',
            title: '既存顧客の保守契約更新',
            role: 'REVENUE',
            hypothesis: { statement: '更新案内を早めると、解約が減る' },
            rationale: '解約の理由の多くは、更新時期の案内の遅れにある',
            planStatus: 'draft',
            okrs: [{ objective: '保守契約の更新率を高める', keyResults: [], owner: '鈴木一郎（仮）' }],
            okrsV2: [
              {
                id: 'kr-renew-1',
                label: '保守契約の継続率',
                target: 95,
                unit: '%',
                due: '2027-06',
                owner: '鈴木一郎（仮）',
                targetBasis: 'USER_CONFIRMED',
                targetAdoptedAt: '2026-10-01T00:00:00.000Z',
              },
              { id: 'kr-renew-2', label: '更新案内の到達率', target: 0, unit: '%', due: '2027-03', owner: null },
              {
                id: 'kr-renew-3',
                label: '更新時の値引き率',
                target: 3,
                unit: '%',
                due: '2027-05',
                owner: null,
                targetBasis: 'AI_PROVISIONAL',
              },
            ],
          },
          {
            id: 'fict-proj-referral-sales',
            title: '新規顧客開拓',
            role: 'REVENUE',
            rationale: '既存顧客からの紹介を増やす',
            okrs: [],
            kpis: ['紹介件数'],
            okrsV2: [],
          },
        ],
      },
      {
        id: 'dept-design',
        name: '設計部',
        mission: '点検の工程を標準化し、現場の作業時間を減らす',
        strategy: '点検の手順を共通化して、作業の差をなくす',
        finalized: true,
        projects: [
          {
            id: 'fict-proj-inspection',
            title: '点検工程の標準化',
            role: 'COST',
            rationale: '点検の手順が担当者によって違い、作業時間に差が出ている',
            okrs: [{ objective: '点検の作業時間を減らす', keyResults: [], owner: '佐藤（仮）' }],
            okrsV2: [
              {
                id: 'kr-insp-1',
                label: '点検の作業時間（時間/件）',
                target: 1.5,
                unit: '時間',
                due: '2027-04',
                owner: '佐藤（仮）',
                targetBasis: 'USER_CONFIRMED',
              },
            ],
          },
          {
            id: 'fict-proj-referral-design',
            title: '新規顧客開拓',
            role: 'FUTURE',
            okrsV2: [
              {
                id: 'kr-design-1',
                label: '設計提案の件数',
                target: 4,
                unit: '件',
                due: '2027-05',
                owner: null,
                targetBasis: 'AI_PROVISIONAL',
              },
            ],
          },
        ],
      },
      {
        id: 'dept-biz',
        name: '新規事業開発部',
        mission: '医療機関向けの計測ソリューションを、試験導入から育てる',
        strategy: '試験導入の結果を、製品仕様の見直しに反映する',
        finalized: true,
        projects: [
          {
            id: 'fict-proj-clinic-pilot',
            title: '医療機関向け計測ソリューションの試験導入',
            role: 'REVENUE',
            hypothesis: '試験導入を通じて、医療機関の計測・記録の負担を減らせる',
            rationale: '現場の記録作業の負担が、導入の判断を止めている',
            okrs: [
              {
                objective: '試験導入で、医療機関の計測・記録の負担を減らす',
                keyResults: [],
                owner: '中村美咲（仮）',
              },
            ],
            okrsV2: [
              {
                id: 'kr-clinic-1',
                label: '試験導入に合意した医療機関数',
                target: 5,
                unit: '件',
                due: '2027-09',
                owner: '中村美咲（仮）',
                targetBasis: 'USER_CONFIRMED',
              },
              {
                id: 'kr-clinic-2',
                label: '試験導入後に継続利用の意向を確認した医療機関数',
                target: 3,
                unit: '件',
                due: '2028-02',
                owner: null,
                targetBasis: 'USER_CONFIRMED',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'fict-strategy-b',
    company_id: 'fict-co-b',
    departments: [
      {
        id: 'dept-b-manufacturing',
        name: '製造部',
        mission: '他社の製造工程を改善する',
        strategy: '他社の工程の改善を進める',
        finalized: true,
        projects: [
          {
            id: 'fict-b-proj-1',
            title: '他社だけの案件',
            role: 'COST',
            okrsV2: [
              {
                id: 'kr-b-1',
                label: '他社の秘密のKPI',
                target: 99,
                unit: '件',
                due: '2027-01',
                owner: null,
                targetBasis: 'USER_CONFIRMED',
              },
            ],
          },
          {
            id: 'fict-b-proj-2',
            title: '新規顧客開拓',
            role: 'REVENUE',
            okrsV2: [
              {
                id: 'kr-b-2',
                label: '他社の新規KPI',
                target: 7,
                unit: '件',
                due: '2027-02',
                owner: null,
                targetBasis: 'USER_CONFIRMED',
              },
            ],
          },
        ],
      },
    ],
  },
];

// 保存済みの計画（モック）。同じ企業・戦略・プロジェクトのものだけが、そのプロジェクトに対応する。
export const STAGE3_SNAPSHOT_SAVED_PLANS: SavedPlanRecord[] = [
  {
    companyId: 'fict-co-a',
    strategyId: 'fict-strategy-a',
    projectKey: 'id:fict-proj-clinic-pilot',
    savedAt: '2026-10-20T09:00:00+09:00',
    kpiSnapshot: [
      { label: '試験導入に合意した医療機関数', target: 5 },
      { label: '試験導入後に継続利用の意向を確認した医療機関数', target: 3 },
    ],
    plan: growthPlan,
  },
];

export const STAGE3_SNAPSHOT_COMPANY_LABELS: Record<string, string> = {
  'fict-co-a': '架空精密計測株式会社（評価用）',
  'fict-co-b': '架空食品加工株式会社（評価用）',
};
