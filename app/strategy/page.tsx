// /app/strategy/page.tsx
// 旧URL互換：/strategy → /stage1 へリダイレクト
import { redirect } from 'next/navigation';

export default function StrategyPage() {
  redirect('/stage1');
}
