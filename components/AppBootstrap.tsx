// 例：/components/AppBootstrap.tsx（あれば）
'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { supabase } from '@/utils/supabase/client';
// import { ensureStrategyId } from '@/utils/strategyBootstrap';

function isPublicPath(path: string) {
  return (
    path === '/login' ||
    path.startsWith('/signup') ||   // /signup, /signup-admin を含む
    path.startsWith('/403')
  );
}

export default function AppBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      // 公開ページでは何もしない
      if (isPublicPath(pathname)) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session?.user?.id) return;

      // 認証済みかつ非公開ページのみ初期化実行
      // await ensureStrategyId(data.session.user.id);
    })();
  }, [pathname]);

  return null;
}
