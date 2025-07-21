'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const { setUser } = useUserStore();
  const router = useRouter();

  const handleLogin = async () => {
    setErrorMessage('');

    if (!email || !password) {
      setErrorMessage('メールアドレスとパスワードを入力してください');
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      setErrorMessage('ログイン失敗: ' + (error?.message || '不明なエラー'));
      return;
    }

    // Supabaseのusersテーブルからロール・部門・名前を取得
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (userError || !userData) {
      setErrorMessage('ユーザ情報の取得に失敗しました: ' + userError?.message);
      return;
    }

    // ✅ API経由でCookieを設定（任意）
    await fetch('/api/set-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: data.user.id,
        user_role: userData.role,
      }),
    });

    // Zustandにユーザ情報を保存（name を含める）
    setUser({
      id: data.user.id,
      name: userData.name || '', // ✅ name を追加
      email: data.user.email || '',
      role: userData.role || 'member',
      department: userData.department || '',
    });

    // ✅ トップページまたは管理画面へ遷移
    router.push('/');
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">ログイン</h2>

      {errorMessage && (
        <div className="text-sm text-red-600 mb-3">{errorMessage}</div>
      )}

      <input
        type="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2 w-full mb-2 rounded"
      />
      <input
        type="password"
        placeholder="パスワード"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border p-2 w-full mb-4 rounded"
      />

      <button
        onClick={handleLogin}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full"
      >
        ログイン
      </button>

      <p className="mt-4 text-sm text-center">
        アカウントをお持ちでないですか？{' '}
        <a href="/signup" className="text-blue-500 underline">
          新規登録はこちら
        </a>
      </p>
    </div>
  );
}
