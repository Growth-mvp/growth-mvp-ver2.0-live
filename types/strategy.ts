// types/strategy.ts

export type OKR = {
  objective: string;
  keyResults: string[];
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
