'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface ParticipantInputProps {
  participants: string[];
  onAdd: (name: string) => void;
  onRemove: (index: number) => void;
  onStart: () => void;
}

export default function ParticipantInput({ participants, onAdd, onRemove, onStart }: ParticipantInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAdd(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  };

  const canStart = participants.length >= 1;

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* 入力フォーム */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">参加者名を入力</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="下の名前をひらがなで入力してください（例：たろう）"
            className="flex-1 px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
          />
          <button
            onClick={handleAdd}
            className="px-6 py-3 bg-orange-500 text-white font-medium rounded-lg hover:bg-orange-600 active:scale-95 transition"
          >
            追加
          </button>
        </div>
      </div>

      {/* 参加者リスト */}
      {participants.length > 0 && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">参加者 ({participants.length}人)</label>
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
            {participants.map((participant, index) => (
              <div
                key={index}
                className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-gray-200"
              >
                <span className="text-gray-800 font-medium">{participant}</span>
                <button
                  onClick={() => onRemove(index)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 推奨案内 */}
      {participants.length === 1 && (
        <p className="text-sm text-orange-600 bg-orange-50 rounded-lg px-4 py-3">
          2人以上の参加をおすすめします
        </p>
      )}

      {/* 開始ボタン */}
      <button
        onClick={onStart}
        disabled={!canStart}
        className={[
          'w-full py-4 font-bold text-lg rounded-lg transition-all duration-200',
          canStart
            ? 'bg-orange-500 text-white hover:bg-orange-600 active:scale-95 shadow-md'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-60',
        ].join(' ')}
      >
        はじめる
      </button>
    </div>
  );
}
