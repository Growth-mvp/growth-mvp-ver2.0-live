// /app/signup/page.tsx  ← 旧フロー、削除予定のためリダイレクト
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  // /signup は旧フロー（非推奨化済み）→ /login へリダイレクト
  redirect('/login');
}
