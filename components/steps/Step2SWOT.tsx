// ✅ ファイル: /components/Step2SWOT.tsx
'use client';
import { useStrategyStore } from  '../../store/strategyStore';

export default function Step2SWOT() {
  const { strength, weakness, opportunity, threat, setStrength, setWeakness, setOpportunity, setThreat } = useStrategyStore();
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">STEP2：SWOT分析</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div><label>強み</label><textarea className="w-full border p-2" rows={5} value={strength} onChange={(e) => setStrength(e.target.value)} /></div>
        <div><label>弱み</label><textarea className="w-full border p-2" rows={5} value={weakness} onChange={(e) => setWeakness(e.target.value)} /></div>
        <div><label>機会</label><textarea className="w-full border p-2" rows={5} value={opportunity} onChange={(e) => setOpportunity(e.target.value)} /></div>
        <div><label>脅威</label><textarea className="w-full border p-2" rows={5} value={threat} onChange={(e) => setThreat(e.target.value)} /></div>
      </div>
    </div>
  );
}