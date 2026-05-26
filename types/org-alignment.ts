export type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

export type VisibilityMode = 'anonymous' | 'manager_only' | 'named';

export type OrgAlignmentStatus =
  | 'draft'
  | 'generated'
  | 'alignment_requested'
  | 'in_alignment'
  | 'closed';

export type OrgAlignmentIssueType =
  | '部門間連携のズレ'
  | '経営と現場の認識のズレ'
  | '戦略と実行計画のズレ'
  | '実行計画と評価制度のズレ'
  | '役割責任のズレ'
  | '優先順位のズレ'
  | '意思決定基準のズレ'
  | '情報共有のズレ'
  | '挑戦と失敗許容のズレ'
  | 'ツール・施策への不信感'
  | 'その他';

export type CompanyRecognitionMode = 'strategy_based' | 'needs_confirmation';

export type OrgAlignmentResult = {
  title: string;
  inputSummary: string;
  issueType: OrgAlignmentIssueType;
  participantRecognitionHypothesis: string;
  companyRecognitionMode: CompanyRecognitionMode;
  companyRecognitionTitle: string;
  companyRecognition: string;
  alignmentPoints: string[];
  recommendedNextAction: {
    title: string;
    detail: string;
  };
  riskLevel: 'low' | 'medium' | 'high';
  riskReason: string;
};
