// OKRの型
export type OKR = {
  objective: string;
  keyResults: string[];
  owner?: string; // 👈 担当者（オプションとして定義）
};

// プロジェクトの型
export type Project = {
  name: string;
  description: string;
  okrs: OKR[];
};

// 部門の型
export type Department = {
  id?: number;
  name: string;
  strategy: string;
  projects: Project[];
};

// 深掘り質問（ストーリー掘り下げ用）の型
export type DeepQuestion = {
  chapter: string;     // 該当章（例："現状の危機"）
  question: string;    // 質問文
  reason: string;      // 質問の意図・背景
  answer: string;      // 回答内容
};
