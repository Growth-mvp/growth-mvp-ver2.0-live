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

// 掘り下げ質問ステップ（1問）の型
export type AnswerStep = {
  question: string;
  reason: string;
  answer: string;
};

// 章ごとの掘り下げ質問セット
export type ChapterAnswers = {
  chapterTitle: string;       // 例: "現状の危機や背景"
  steps: AnswerStep[];        // 例: 3問など
};

// 最終ストーリーの1章分の型
export type ChapterStory = {
  title: string;
  body: string;
};

// ✅ 不要な旧型は削除（または非推奨化）
// ❌ 以下は今後使わないため削除またはコメントアウトしてOK
// export type QuestionItem = {...}
// export type DeepQuestion = {...}
