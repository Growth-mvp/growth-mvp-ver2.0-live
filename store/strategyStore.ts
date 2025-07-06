import { create } from "zustand";
import { supabase } from "@/lib/supabaseClient";

// 型定義
export interface OKR {
  objective: string;
  keyResults: string[];
}

export interface Project {
  name: string;
  description?: string;
  okrs?: OKR[];
}

export interface Department {
  name: string;
  projects: Project[];
}

export interface Strategy {
  summary: string;
}

interface StrategyStore {
  strategy: Strategy;
  departments: Department[];
  thought: string;
  industry: string;
  revenue: number;
  employees: number;
  revenueRange: string;
  employeeRange: string;
  mission: string;
  visionStatement: string;
  value: string;
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;
  story: string;

  setStrategy: (strategy: Strategy) => void;
  setDepartments: (departments: Department[]) => void;
  setThought: (thought: string) => void;
  setIndustry: (industry: string) => void;
  setRevenue: (revenue: number) => void;
  setEmployees: (employees: number) => void;
  setRevenueRange: (range: string) => void;
  setEmployeeRange: (range: string) => void;
  setMission: (mission: string) => void;
  setVisionStatement: (vision: string) => void;
  setValue: (value: string) => void;
  setStrength: (strength: string) => void;
  setWeakness: (weakness: string) => void;
  setOpportunity: (opportunity: string) => void;
  setThreat: (threat: string) => void;
  setStory: (story: string) => void;

  saveToSupabase: () => Promise<void>;
  loadLatestFromSupabase: () => Promise<void>;
  deleteAllFromSupabase: () => Promise<void>;
}

export const useStrategyStore = create<StrategyStore>((set) => ({
  strategy: { summary: "" },
  departments: [],
  thought: "",
  industry: "",
  revenue: 0,
  employees: 0,
  revenueRange: "",
  employeeRange: "",
  mission: "",
  visionStatement: "",
  value: "",
  strength: "",
  weakness: "",
  opportunity: "",
  threat: "",
  story: "",

  setStrategy: (strategy) => set({ strategy }),
  setDepartments: (departments) => set({ departments }),
  setThought: (thought) => set({ thought }),
  setIndustry: (industry) => set({ industry }),
  setRevenue: (revenue) => set({ revenue }),
  setEmployees: (employees) => set({ employees }),
  setRevenueRange: (range) => set({ revenueRange: range }),
  setEmployeeRange: (range) => set({ employeeRange: range }),
  setMission: (mission) => set({ mission }),
  setVisionStatement: (vision) => set({ visionStatement: vision }),
  setValue: (value) => set({ value }),
  setStrength: (strength) => set({ strength }),
  setWeakness: (weakness) => set({ weakness }),
  setOpportunity: (opportunity) => set({ opportunity }),
  setThreat: (threat) => set({ threat }),
  setStory: (story) => set({ story }),

  saveToSupabase: async () => {
    const state = useStrategyStore.getState();
    const { error } = await supabase.from("strategies").insert({
      strategy: state.strategy,
      departments: state.departments,
      story: state.story,
      basic_info: {
        thought: state.thought,
        industry: state.industry,
        revenue: state.revenue,
        employees: state.employees,
        revenueRange: state.revenueRange,
        employeeRange: state.employeeRange,
        mission: state.mission,
        visionStatement: state.visionStatement,
        value: state.value,
        strength: state.strength,
        weakness: state.weakness,
        opportunity: state.opportunity,
        threat: state.threat,
      },
    });

    if (error) {
      console.error("❌ Supabase保存エラー:", error);
    } else {
      console.log("✅ Supabaseに保存成功");
    }
  },

  loadLatestFromSupabase: async () => {
    const { data, error } = await supabase
      .from("strategies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("❌ Supabase読み込みエラー:", error);
      return;
    }

    if (data) {
      const info = data.basic_info || {};
      set({
        strategy: data.strategy || { summary: "" },
        departments: data.departments || [],
        story: data.story || "",
        thought: info.thought || "",
        industry: info.industry || "",
        revenue: info.revenue || 0,
        employees: info.employees || 0,
        revenueRange: info.revenueRange || "",
        employeeRange: info.employeeRange || "",
        mission: info.mission || "",
        visionStatement: info.visionStatement || info.vision || "",
        value: info.value || "",
        strength: info.strength || "",
        weakness: info.weakness || "",
        opportunity: info.opportunity || "",
        threat: info.threat || "",
      });
    }
  },

  deleteAllFromSupabase: async () => {
    const { error } = await supabase.from("strategies").delete().neq("id", "");
    if (error) console.error("❌ Supabase削除エラー:", error);
  },
}));
