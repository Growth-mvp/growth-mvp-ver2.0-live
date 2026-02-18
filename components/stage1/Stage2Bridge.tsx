// /components/stage1/Stage2Bridge.tsx
'use client';

import { useRouter } from 'next/navigation';

export default function Stage2Bridge({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();

  return (
    <section className="pt-8 border-t">
      <button
        className={`px-6 py-3 rounded font-medium transition ${
          disabled
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-black text-white hover:bg-gray-800'
        }`}
        onClick={() => !disabled && router.push('/stage2')}
        disabled={disabled}
      >
        この分析をもとに、経営戦略を考える
      </button>
    </section>
  );
}
