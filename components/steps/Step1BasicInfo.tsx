// ✅ ファイル: /components/Step1BasicInfo.tsx
'use client';
import { useStrategyStore } from '../../store/strategyStore';
export default function Step1BasicInfo() {
  const {
    companyName, foundationYear, location, employees,
    industry, businessContent, customerSegment,
    setCompanyName, setFoundationYear, setLocation, setEmployees,
    setIndustry, setBusinessContent, setCustomerSegment,
  } = useStrategyStore();

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">STEP1：基本情報の入力</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><label className="block">会社名</label><input className="w-full border p-2" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
        <div><label className="block">設立年</label><input className="w-full border p-2" value={foundationYear} onChange={(e) => setFoundationYear(e.target.value)} /></div>
        <div><label className="block">所在地</label><input className="w-full border p-2" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        <div><label className="block">従業員数</label><input className="w-full border p-2" value={employees} onChange={(e) => setEmployees(e.target.value)} /></div>
        <div><label className="block">業種</label><input className="w-full border p-2" value={industry} onChange={(e) => setIndustry(e.target.value)} /></div>
        <div><label className="block">事業内容</label><input className="w-full border p-2" value={businessContent} onChange={(e) => setBusinessContent(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="block">主要顧客層</label><input className="w-full border p-2" value={customerSegment} onChange={(e) => setCustomerSegment(e.target.value)} /></div>
      </div>
    </div>
  );
}
