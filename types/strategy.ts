// OKR（Objective & Key Results）の型
export type OKR = {
  objective: string;
  keyResults: string[];
  owner?: string; // 担当者（例: メンバー名やメールアドレス）
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

// 深掘り質問1ステップ分の型（段階的な質問対応構造）
export type AnswerStep = {
  stepNumber: number;  // ステップ番号（1から順に）
  question: string;    // 問いの本文
  reason: string;      // なぜこの問いが重要か（AIによる説明）
  answer: string;      // ユーザーの回答（空文字で初期化可能）
};

// 章ごとの掘り下げ質問構造（例：answers2 に格納）
export type ChapterAnswers = {
  chapterIndex: number;    // 章インデックス（0から開始）
  chapterTitle: string;    // 章タイトル（例: 現状の危機や背景）
  steps: AnswerStep[];     // その章に属する質問と回答のステップ群
};

// 最終ストーリーの1章ごとの構造（storyChapters / finalStory）
export type ChapterStory = {
  title: string;           // 章タイトル（例：現状の危機）
  body: string;            // その章の本文（生成済みストーリー）
};

//
// 🎯 Supabase保存・読み込み用の純粋なデータ型（副作用のない構造）
//
export type StrategyData = {
  companyName: string;
  foundationYear: string;
  location: string;
  industry: string;
  revenue: string;
  employees: string;
  businessContent: string;
  customerSegment: string;

  questions: string[];
  reasons: string[];
  questions2: string[];
  reasons2: string[];

  thought: string;
  mission: string;
  vision: string;
  value: string;

  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  csvFinanceData: any[];

  story: string | ChapterStory[];
  finalStory: ChapterStory[];
  answers: string[];
  answers2: ChapterAnswers[];

  strategySummary: string;
  editableCascadeResult: Department[];

  notification: string;
  role: 'admin' | 'manager' | 'member'; // ← ✅ 修正済み: Union型で安全に保持
};

//
// 🎯 Zustandストア用の拡張型（setter 関数などを含む）
//
export interface StrategyState extends StrategyData {
  // Setter群（例）必要に応じて追加可能
  setCompanyName: (v: string) => void;
  setFoundationYear: (v: string) => void;
  setLocation: (v: string) => void;
  setIndustry: (v: string) => void;
  setRevenue: (v: string) => void;
  setEmployees: (v: string) => void;
  setBusinessContent: (v: string) => void;
  setCustomerSegment: (v: string) => void;

  setThought: (v: string) => void;
  setMission: (v: string) => void;
  setVision: (v: string) => void;
  setValue: (v: string) => void;

  setStrength: (v: string) => void;
  setWeakness: (v: string) => void;
  setOpportunity: (v: string) => void;
  setThreat: (v: string) => void;

  setCsvFinanceData: (v: any[]) => void;

  setStory: (v: string | ChapterStory[]) => void;
  setFinalStory: (v: ChapterStory[]) => void;
  setAnswers: (v: string[]) => void;
  setAnswers2: (v: ChapterAnswers[]) => void;

  setStrategySummary: (v: string) => void;
  setEditableCascadeResult: (v: Department[]) => void;

  setNotification: (v: string) => void;
  setRole: (v: 'admin' | 'manager' | 'member') => void;

  // 保存・読み込み・削除処理
  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => void;
}
