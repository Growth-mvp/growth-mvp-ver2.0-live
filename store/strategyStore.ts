import { create } from 'zustand';
import { saveStrategyData, loadStrategyData, deleteStrategyData } from '../utils/supabase';

export interface Department {
  id: number;
  name: string;
  projects: string[];
}

export interface CascadeResult {
  department: string;
  projects: {
    name: string;
    okrs: string[];
  }[];
}

export interface StrategyState {
  // 基本情報
  companyName: string;
  foundationYear: string;
  location: string;
  industry: string;
  revenue: string;
  employees: string;
  businessContent: string;
  customerSegment: string;

  // SWOT
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  // MVV
  mission: string;
  vision: string;
  value: string;

  // 部門・カスケード結果
  departments: Department[];
  cascadeResult: CascadeResult[];

  // CSV財務データ
  csvFinanceData: any[];

  // 通知
  notification: string;

  // Setter
  setCompanyName: (v: string) => void;
  setFoundationYear: (v: string) => void;
  setLocation: (v: string) => void;
  setIndustry: (v: string) => void;
  setRevenue: (v: string) => void;
  setEmployees: (v: string) => void;
  setBusinessContent: (v: string) => void;
  setCustomerSegment: (v: string) => void;

  setStrength: (v: string) => void;
  setWeakness: (v: string) => void;
  setOpportunity: (v: string) => void;
  setThreat: (v: string) => void;

  setMission: (v: string) => void;
  setVision: (v: string) => void;
  setValue: (v: string) => void;

  setDepartments: (v: Department[]) => void;
  setCascadeResult: (v: CascadeResult[]) => void;
  setCsvFinanceData: (data: any[]) => void;

  setNotification: (v: string) => void;

  // Supabase連携
  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export const useStrategyStore = create<StrategyState>((set, get) => ({
  // 初期値
  companyName: '',
  foundationYear: '',
  location: '',
  industry: '',
  revenue: '',
  employees: '',
  businessContent: '',
  customerSegment: '',

  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',

  mission: '',
  vision: '',
  value: '',

  departments: [],
  cascadeResult: [],

  csvFinanceData: [],

  notification: '',

  // Setter
  setCompanyName: (v) => set({ companyName: v }),
  setFoundationYear: (v) => set({ foundationYear: v }),
  setLocation: (v) => set({ location: v }),
  setIndustry: (v) => set({ industry: v }),
  setRevenue: (v) => set({ revenue: v }),
  setEmployees: (v) => set({ employees: v }),
  setBusinessContent: (v) => set({ businessContent: v }),
  setCustomerSegment: (v) => set({ customerSegment: v }),

  setStrength: (v) => set({ strength: v }),
  setWeakness: (v) => set({ weakness: v }),
  setOpportunity: (v) => set({ opportunity: v }),
  setThreat: (v) => set({ threat: v }),

  setMission: (v) => set({ mission: v }),
  setVision: (v) => set({ vision: v }),
  setValue: (v) => set({ value: v }),

  setDepartments: (v) => set({ departments: v }),
  setCascadeResult: (v) => set({ cascadeResult: v }),
  setCsvFinanceData: (data) => set({ csvFinanceData: data }),

  setNotification: (v) => set({ notification: v }),

  saveToSupabase: async () => {
    const state = get();
    const { error } = await saveStrategyData(state);
    if (!error) set({ notification: '✅ 保存に成功しました' });
  },

  loadFromSupabase: async () => {
    const { data, error } = await loadStrategyData();
    if (!error && data) set(data);
  },

  clearAllData: async () => {
    const { error } = await deleteStrategyData();
    if (!error) {
      set({
        companyName: '',
        foundationYear: '',
        location: '',
        industry: '',
        revenue: '',
        employees: '',
        businessContent: '',
        customerSegment: '',
        strength: '',
        weakness: '',
        opportunity: '',
        threat: '',
        mission: '',
        vision: '',
        value: '',
        departments: [],
        cascadeResult: [],
        csvFinanceData: [],
        notification: '',
      });
    }
  },
}));
