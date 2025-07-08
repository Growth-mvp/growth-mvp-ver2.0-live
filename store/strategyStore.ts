// ✅ ファイル: /store/strategyStore.ts
import { create } from 'zustand';

interface StrategyState {
  // Step1
  companyName: string;
  foundationYear: string;
  location: string;
  employees: string;
  industry: string;
  businessContent: string;
  customerSegment: string;

  setCompanyName: (value: string) => void;
  setFoundationYear: (value: string) => void;
  setLocation: (value: string) => void;
  setEmployees: (value: string) => void;
  setIndustry: (value: string) => void;
  setBusinessContent: (value: string) => void;
  setCustomerSegment: (value: string) => void;

  // Step2
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  setStrength: (value: string) => void;
  setWeakness: (value: string) => void;
  setOpportunity: (value: string) => void;
  setThreat: (value: string) => void;

  // Step3
  financeData: any[];
  setFinanceData: (data: any[]) => void;

  // Step4
  mission: string;
  vision: string;
  value: string;

  setMission: (value: string) => void;
  setVision: (value: string) => void;
  setValue: (value: string) => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  companyName: '',
  foundationYear: '',
  location: '',
  employees: '',
  industry: '',
  businessContent: '',
  customerSegment: '',

  setCompanyName: (value) => set({ companyName: value }),
  setFoundationYear: (value) => set({ foundationYear: value }),
  setLocation: (value) => set({ location: value }),
  setEmployees: (value) => set({ employees: value }),
  setIndustry: (value) => set({ industry: value }),
  setBusinessContent: (value) => set({ businessContent: value }),
  setCustomerSegment: (value) => set({ customerSegment: value }),

  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',

  setStrength: (value) => set({ strength: value }),
  setWeakness: (value) => set({ weakness: value }),
  setOpportunity: (value) => set({ opportunity: value }),
  setThreat: (value) => set({ threat: value }),

  financeData: [],
  setFinanceData: (data) => set({ financeData: data }),

  mission: '',
  vision: '',
  value: '',

  setMission: (value) => set({ mission: value }),
  setVision: (value) => set({ vision: value }),
  setValue: (value) => set({ value: value }),
}));