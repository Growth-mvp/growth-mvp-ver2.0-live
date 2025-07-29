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
  stepNumber: number;   // ステップ番号（1から順に）
  question: string;     // 問いの本文
  reason: string;       // なぜこの問いが重要か（AIによる説明）
  answer: string;       // ユーザーの回答（空文字で初期化可能）
};

// 章ごとの掘り下げ質問構造（例：answers2 に格納）
export type ChapterAnswers = {
  chapterIndex: number;     // ✅ 章インデックス（0から開始）
  chapterTitle: string;     // 章タイトル（例: 現状の危機や背景）
  steps: AnswerStep[];      // その章に属する質問と回答のステップ群
};

// 最終ストーリーの1章ごとの構造（storyChapters / finalStory）
export type ChapterStory = {
  title: string;            // 章タイトル（例：現状の危機）
  body: string;             // その章の本文（生成済みストーリー）
};
