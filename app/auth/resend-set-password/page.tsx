// /app/auth/resend-set-password/page.tsx
// 旧フロー（招待リンク再送）→ /login へリダイレクト
import 'server-only';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ResendSetPasswordPage() {
  // /auth/resend-set-password は旧フロー → /login へリダイレクト
  redirect('/login');
}
