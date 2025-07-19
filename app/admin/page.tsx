'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function AdminPage() {
  const [strategies, setStrategies] = useState<any[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await supabase.from('strategy_data').select('*');
      if (!error) setStrategies(data || []);
    };
    fetchData();
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">📊 戦略データ管理画面</h1>
      <table className="w-full text-left border border-gray-200 rounded-lg shadow-sm">
        <thead className="bg-gray-100 text-sm text-gray-700">
          <tr>
            <th className="p-3">会社名</th>
            <th className="p-3">業種</th>
            <th className="p-3">従業員数</th>
            <th className="p-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s) => (
            <tr key={s.id} className="border-t text-sm">
              <td className="p-3">{s.companyName}</td>
              <td className="p-3">{s.industry}</td>
              <td className="p-3">{s.employees}</td>
              <td className="p-3">
                <Link
                  href={`/admin/edit/${s.id}`}
                  className="text-blue-600 hover:underline"
                >
                  ✏️ 編集
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
