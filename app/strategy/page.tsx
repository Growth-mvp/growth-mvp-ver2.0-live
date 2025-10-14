// /app/strategy/page.tsx
import StrategyClient from '@/components/pages/StrategyClient';

export default function StrategyPage() {
  // ここは Server Component（'use client' を書かない）
  return <StrategyClient />;
}
