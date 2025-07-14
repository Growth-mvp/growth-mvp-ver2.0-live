'use client';

import { useState } from 'react';
import Papa from 'papaparse';
import { useStrategyStore } from '@/store/strategyStore';
import { createClient } from '@supabase/supabase-js';
import StepLayout from '@/components/StepLayout';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

        const { error } = await supabase.from('finance_data').insert({
          company_name: companyName || '未入力',
          data,
        });

        if (error) {
          console.error(error);
          setError('❌ Supabaseへの保存に失敗しました。');
        } else {
          setMessage('✅ 保存に成功しました。');
        }
        setUploading(false);
      },
      error: () => {
        setError('❌ CSVの解析に失敗しました。');
        setUploading(false);
      },
    });
  };

  return (
    <StepLayout step={3} totalSteps={5} title="財務データのアップロード">
      <div className="space-y-4">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={uploading}
          className="border px-4 py-2 rounded shadow-sm cursor-pointer text-sm"
        />
        {message && <p className="text-green-600">{message}</p>}
        {error && <p className="text-red-600">{error}</p>}
        {parsedData.length > 0 && (
          <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded border">
            ✅ {parsedData.length}件の財務データを読み込みました。
          </div>
        )}
      </div>
    </StepLayout>
  );
}
