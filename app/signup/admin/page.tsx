// /app/signup/admin/page.tsx
import 'server-only';
import { redirect } from 'next/navigation';

export default function LegacySignupAdmin() {
  // 互換のため /signup/admin → /signup-admin に301相当で飛ばす
  redirect('/signup-admin');
}
