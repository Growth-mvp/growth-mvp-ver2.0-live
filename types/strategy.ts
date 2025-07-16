// types/strategy.ts

export type OKR = {
  objective: string;
  keyResults: string[];
  owner?: string; // 👈 担当者（オプションとして定義）
};

export type Project = {
  name: string;
  description: string;
  okrs: OKR[];
};

export type Department = {
  id?: number;
  name: string;
  strategy: string;
  projects: Project[];
};
