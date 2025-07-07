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
  // 状態
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

  // Setter関数
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

  // Supabase関連
  saveBasicInfoToSupabase: () => Promise<void>;
  saveCascadeToSupabase: () => Promise<void>;
  saveStoryToSupabase: () => Promise<void>;
  loadLatestFromSupabase: () => Promise<void>;
  deleteAllFromSupabase: () => Promise<void>;
}

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  // 状態の初期値
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

  // Setter関数
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

  // 基本情報だけ保存（初期段階）
  saveBasicInfoToSupabase: async () => {
    const state = get();
    const { error } = await supabase.from("strategies").insert({
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

    if (error) console.error("❌ 基本情報保存エラー:", error);
    else console.log("✅ 基本情報をSupabaseに保存");
  },

  // 戦略カスケードのみ保存（部門含む）
  saveCascadeToSupabase: async () => {
    const { strategy, departments } = get();
    const { error } = await supabase.from("strategies").insert({
      strategy,
      departments,
    });

    if (error) console.error("❌ カスケード保存エラー:", error);
    else console.log("✅ カスケードをSupabaseに保存");
  },

  // ストーリーだけ保存
  saveStoryToSupabase: async () => {
    const { story } = get();
    const { error } = await supabase.from("strategies").insert({
      story,
    });

    if (error) console.error("❌ ストーリー保存エラー:", error);
    else console.log("✅ ストーリーをSupabaseに保存");
  },

  // 最新のレコードをロード
  loadLatestFromSupabase: async () => {
    const { data, error } = await supabase
      .from("strategies")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      console.error("❌ 読み込みエラー:", error);
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

  // 全件削除
  deleteAllFromSupabase: async () => {
    const { error } = await supabase.from("strategies").delete().neq("id", "");
    if (error) console.error("❌ 削除エラー:", error);
    else console.log("✅ Supabase全削除完了");
  },
}));
