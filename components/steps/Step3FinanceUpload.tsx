// ✅ ファイル: /components/Step3FinanceUpload.tsx
'use client';
import { useState } from 'react';
import Papa from 'papaparse';
import { useStrategyStore } from '../../store/strategyStore';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function Step3FinanceUpload() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [parsedData, setParsedData] = useState<any[]>([]);
  const { companyName, setFinanceData } = useStrategyStore();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result: Papa.ParseResult<any>) => {
        const data = result.data;
        setParsedData(data);
        setFinanceData(data);
        const { error } = await supabase.from('finance_data').insert({ company_name: companyName || '未入力', data });
        if (error) setError('Supabaseへの保存に失敗しました。');
        else setMessage('保存に成功しました。');
        setUploading(false);
      },
      error: (err) => {
        setError('CSV解析に失敗しました。');
        setUploading(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">STEP3：財務データのアップロード</h2>
      <input type="file" accept=".csv" onChange={handleFileUpload} disabled={uploading} className="border p-2" />
      {message && <p className="text-green-600">{message}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
