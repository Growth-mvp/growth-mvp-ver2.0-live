import type { OperationProposal } from './instruction';

export type ProposalScreenState = {
  companyId: string | null;
  strategyId: string | null;
  pathname: string;
  dirty: boolean;
};

export type ProposalBlock = { message: string; discard: boolean };

export function proposalRequiredRole(proposal: OperationProposal): 'admin' | 'manager' {
  return proposal.kind === 'stage2.ceoIntent' ? 'admin' : 'manager';
}

/** 承認の直前に、入力案の対象（会社・戦略・画面）と未保存の変更を確認する。対象が変わった入力案は破棄する */
export function proposalBlockReason(proposal: OperationProposal, state: ProposalScreenState): ProposalBlock | null {
  if (state.companyId !== proposal.companyId || state.strategyId !== proposal.strategyId) {
    return { message: '企業が切り替わったため、入力案を破棄しました。', discard: true };
  }
  if (state.pathname !== proposal.pathname) {
    return { message: '画面が変わったため、入力案を破棄しました。', discard: true };
  }
  if (state.dirty) {
    return {
      message: 'ほかに未保存の変更があるため、保存しません。画面左下の「全体保存」で保存してから、もう一度承認してください。',
      discard: false,
    };
  }
  return null;
}

/** 入力案を作った後に、保存済みの値が変わっていないか。変わっていれば保存せず、作り直しを求める */
export function proposalStaleReason(
  proposal: OperationProposal,
  current: { ceoIntent?: string; revenueYen?: number | null; stage3Answer?: string; stage4Version?: number },
): ProposalBlock | null {
  if (proposal.kind === 'stage2.ceoIntent') {
    return (current.ceoIntent ?? '') === proposal.before
      ? null
      : { message: '入力案を作った後に「経営者の思い」が変わったため、保存しません。もう一度指示してください。', discard: true };
  }
  if (proposal.kind === 'stage3.question') {
    return (current.stage3Answer ?? '') === proposal.before
      ? null
      : { message: `入力案を作った後に${proposal.departmentName}の${proposal.stepNumber}番目の回答が変わったため、保存しません。もう一度指示してください。`, discard: true };
  }
  if (proposal.kind === 'stage4.plan') {
    return current.stage4Version === proposal.expectedVersion
      ? null
      : { message: '実行計画書がほかで更新されたため、保存しません。計画書を開き直して、もう一度指示してください。', discard: true };
  }
  return (current.revenueYen ?? null) === proposal.beforeYen
    ? null
    : { message: `入力案を作った後に${proposal.year}年度の売上高が変わったため、保存しません。もう一度指示してください。`, discard: true };
}
