// /components/stage1/Stage2Bridge.tsx
'use client';

import { useRouter } from 'next/navigation';

export default function Stage2Bridge() {
  const router = useRouter();

  return (
    <section className="pt-8 border-t">
      <button
        className="bg-black text-white px-6 py-3 rounded"
        onClick={() => router.push('/stage2')}
      >
        この分析をもとに、経営戦略を考える
      </button>
    </section>
  );
}
