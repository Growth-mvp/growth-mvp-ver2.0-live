'use client'

import { useState } from 'react'

export default function AdminPage() {
  const [formData, setFormData] = useState({
    philosophy: '',
    mission: '',
    message: '',
    midTermPlan: '',
    currentPolicy: '',
    valuePrinciples: '',
    departmentRoles: '',
    faq: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSave = () => {
    // TODO: API連携処理（仮）
    console.log('保存データ:', formData)
    alert('保存しました（仮）')
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">経営ナレッジ入力（管理者専用）</h1>
      <p className="text-sm text-gray-600">
        経営理念や方針、中計、FAQなど、AIに共有する情報をここに入力します。
      </p>

      {[
        { label: '経営理念・パーパス', name: 'philosophy' },
        { label: '社長の信念・想い・創業エピソード', name: 'mission' },
        { label: '社長メッセージ（社内報など）', name: 'message' },
        { label: '中期経営計画（3〜5年）', name: 'midTermPlan' },
        { label: '今期の経営方針・重点施策', name: 'currentPolicy' },
        { label: 'バリュー・行動指針・価値観', name: 'valuePrinciples' },
        { label: '部門ごとの役割やKPI', name: 'departmentRoles' },
        { label: '想定される社員の質問と回答', name: 'faq' },
      ].map(({ label, name }) => (
        <div key={name}>
          <label className="block font-semibold mb-1">{label}</label>
          <textarea
            name={name}
            className="w-full border p-2 rounded"
            rows={4}
            value={formData[name as keyof typeof formData]}
            onChange={handleChange}
          />
        </div>
      ))}

      <button
        onClick={handleSave}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        保存する
      </button>
    </div>
  )
}
