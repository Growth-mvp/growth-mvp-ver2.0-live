/* AI経営コンサルタントの自律伴走：次の一歩（操作・進行）を、保存済みデータから決定的に判定する。
 * AIは使わない（経営上の助言は companionMilestones が節目で別に扱う）。
 * 取得できていない情報は判定しない（呼び出し側で ready=false にする）。 */

import { getOperation } from '@/lib/operationKnowledge/lookup';

export type CompanionRole = 'admin' | 'manager' | 'member';

export type CompanionSnapshot = {
  ready: boolean;
  companyId: string;
  strategyId: string;
  role: CompanionRole | null;
  currentPath: string;
  dirty: boolean;
  companyNameEntered: boolean;
  financeEntered: boolean;
  issueCount: number;
  stage2Started: boolean;
  stage2Generated: boolean;
  stage2Confirmed: boolean;
  departmentCount: number;
  projectCount: number;
  stage4Started: boolean;
};

export type CompanionAction = {
  kind: 'progress' | 'advice';
  key: string;
  title: string;
  message: string;
  href: string;
  linkLabel: string;
  canEdit: boolean;
  steps: string[];
  body?: string;
  status?: 'loading' | 'ready';
  /** 経営点検：初期表示の要約（会話形式） */
  summary?: string;
  /** 経営点検：「経営点検の詳細を見る」で開く全文 */
  detail?: string;
  /** 経営点検：点検日時（常に表示する） */
  checkedLabel?: string;
};

const EDIT_ROLES: ReadonlySet<CompanionRole> = new Set(['admin', 'manager']);

type ProgressStep = {
  id: string;
  title: string;
  message: string;
  href: string;
  linkLabel: string;
  operationId: string;
};

function stepsOf(operationId: string): string[] {
  return getOperation(operationId)?.steps.map((s) => s) ?? [];
}

function pickStep(s: CompanionSnapshot): ProgressStep | null {
  if (s.dirty) {
    return {
      id: 'SAVE_PENDING',
      title: '未保存の変更があります',
      message: '保存されていない変更は、まだ次の一歩の判定に反映していません。保存してから、次の一歩を確認してください。',
      href: s.currentPath || '/',
      linkLabel: '保存の状態を確認する',
      operationId: 'common.manual-save',
    };
  }
  if (!s.companyNameEntered) {
    return {
      id: 'ENTER_COMPANY_NAME',
      title: '次は会社の基本情報を入力しましょう',
      message: '会社名が未入力のため、分析の対象がまだ決まっていません。STAGE1の「① 企業情報・事業内容」で会社名を入れると、次の分析に進めます。',
      href: '/stage1',
      linkLabel: 'STAGE1を開く',
      operationId: 'stage1.company-name',
    };
  }
  if (!s.financeEntered) {
    return {
      id: 'ENTER_FINANCE',
      title: '財務データを入れると、現状分析が始まります',
      message: 'STAGE1の財務データがまだ入っていないため、企業価値の分析と論点の作成に進めません。AI経営コンサルタントのチャット欄から決算資料（PDF・Excel・CSV）を添付すると、STAGE1の候補欄で確認して反映できます。手入力は「② 財務データ（読込・手入力）」の全社財務データの表で行えます。',
      href: '/stage1',
      linkLabel: 'STAGE1の財務データを開く',
      operationId: 'common.attach-documents',
    };
  }
  if (s.issueCount === 0) {
    return {
      id: 'ADD_ISSUE',
      title: '論点を1件作りましょう',
      message: '財務データは入力済みです。STAGE2（経営戦略）へ進む前に、「② 論点整理」で経営課題を1件以上作る必要があります。',
      href: '/stage1',
      linkLabel: 'STAGE1の論点整理を開く',
      operationId: 'stage1.add-issue',
    };
  }
  if (!s.stage2Started) {
    return {
      id: 'GO_STAGE2',
      title: 'STAGE2（経営戦略）へ進めます',
      message: `論点が${s.issueCount}件そろいました。STAGE1の「この分析をもとに、経営戦略を考える」で、論点を持ってSTAGE2へ進めます。`,
      href: '/stage1',
      linkLabel: 'STAGE1でSTAGE2へ進む',
      operationId: 'stage1.go-to-stage2',
    };
  }
  if (!s.stage2Generated) {
    return {
      id: 'STAGE2_GENERATE',
      title: '経営戦略を生成しましょう',
      message: 'STAGE2の戦略議論の回答をもとに、経営戦略（最終ストーリー）を生成します。生成した内容は、確定するまで部門の戦略に反映されません。',
      href: '/stage2',
      linkLabel: 'STAGE2を開く',
      operationId: 'stage2.generate-final',
    };
  }
  if (!s.stage2Confirmed) {
    return {
      id: 'STAGE2_CONFIRM',
      title: '経営戦略を確定しましょう',
      message: '経営戦略が生成されています。内容を確かめて確定すると、STAGE3（部門の戦略）へ引き渡されます。確定するまでは、部門の戦略は変わりません。',
      href: '/stage2',
      linkLabel: 'STAGE2で確定する',
      operationId: 'stage2.commit-final-strategy',
    };
  }
  if (s.departmentCount === 0) {
    return {
      id: 'STAGE3_ADD_DEPARTMENT',
      title: '事業・部門を追加しましょう',
      message: '全社戦略が確定しました。各部門の戦略を作るには、まず事業・部門を追加します。',
      href: '/cascade',
      linkLabel: 'STAGE3を開く',
      operationId: 'stage3.add-department',
    };
  }
  if (s.projectCount === 0) {
    return {
      id: 'STAGE3_PROJECT',
      title: '部門の戦略書を作りましょう',
      message: '部門の戦略書（たたき台）を作り、重点プロジェクトを選ぶと、STAGE4（実行計画）へ進めます。',
      href: '/cascade',
      linkLabel: 'STAGE3を開く',
      operationId: 'stage3.generate-department-draft',
    };
  }
  if (!s.stage4Started) {
    return {
      id: 'STAGE4_PLAN',
      title: '実行計画を作りましょう',
      message: '重点プロジェクトが選ばれています。STAGE4で実行計画（目指す状態・KPI・担当）を作ると、実行を始められます。',
      href: '/okr',
      linkLabel: 'STAGE4を開く',
      operationId: 'stage4.generate-plan',
    };
  }
  return null;
}

export function judgeCompanion(s: CompanionSnapshot): CompanionAction | null {
  if (!s.ready || !s.companyId || !s.strategyId || !s.role) return null;
  const step = pickStep(s);
  if (!step) return null;
  const canEdit = EDIT_ROLES.has(s.role);
  return {
    kind: 'progress',
    key: `${step.id}:${s.companyId}:${s.strategyId}`,
    title: step.title,
    message: canEdit || step.id === 'SAVE_PENDING' ? step.message : `${step.message}（編集は管理者・管理職が行います）`,
    href: step.href,
    linkLabel: step.linkLabel,
    canEdit,
    steps: stepsOf(step.operationId),
  };
}
