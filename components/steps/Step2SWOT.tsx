// components/steps/Step2SWOT.tsx
"use client";

import { useStrategyStore } from "@/store/strategyStore";

export default function Step2SWOT() {
  const {
    strength,
    weakness,
    opportunity,
    threat,
    setStrength,
    setWeakness,
    setOpportunity,
    setThreat
  } = useStrategyStore();

  return (
    <div className="space-y-6">
      <div>
        <label className="block font-medium">強み (Strength)</label>
        <textarea
          value={strength}
          onChange={(e) => setStrength(e.target.value)}
          className="w-full border p-2 rounded"
        />
      </div>
      <div>
        <label className="block font-medium">弱み (Weakness)</label>
        <textarea
          value={weakness}
          onChange={(e) => setWeakness(e.target.value)}
          className="w-full border p-2 rounded"
        />
      </div>
      <div>
        <label className="block font-medium">機会 (Opportunity)</label>
        <textarea
          value={opportunity}
          onChange={(e) => setOpportunity(e.target.value)}
          className="w-full border p-2 rounded"
        />
      </div>
      <div>
        <label className="block font-medium">脅威 (Threat)</label>
        <textarea
          value={threat}
          onChange={(e) => setThreat(e.target.value)}
          className="w-full border p-2 rounded"
        />
      </div>
    </div>
  );
}
