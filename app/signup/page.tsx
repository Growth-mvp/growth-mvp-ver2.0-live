'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function SignupPage() {
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'manager' | 'member'>('member');
  const [department, setDepartment] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  const handleSignup = async () => {
    setErrorMessage('');

    if (!companyName || !name || !email || !password) {
      setErrorMessage('会社名・名前・メールアドレス・パスワードは必須です');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('パスワードは6文字以上で入力してください');
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error?.status === 422) {
      setErrorMessage('このメールアドレスはすでに登録されています。ログイン画面からお進みください。');
      return;
    }

    if (error || !data.user?.id) {
      setErrorMessage('登録失敗: ' + (error?.message || '不明なエラー'));
      return;
    }

    // Supabase users テーブルへ登録
    const insertResult = await supabase.from('users').insert({
      id: data.user.id,
      name,
      email: data.user.email,
      role,
      department: role !== 'admin' ? department : '',
      company_name: companyName,
    });

    if (insertResult.error) {
      setErrorMessage('ユーザー情報の保存に失敗しました: ' + insertResult.error.message);
      return;
    }

    alert('✅ 登録に成功しました。ログインしてください');
    router.push('/login');
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">新規ユーザー登録</h2>

      {errorMessage && (
        <div className="text-sm text-red-600 mb-2">{errorMessage}</div>
      )}

      <input
        type="text"
        placeholder="会社名"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        className="border p-2 w-full mb-2 rounded"
      />

      <input
        type="text"
        placeholder="名前（例：山田太郎）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border p-2 w-full mb-2 rounded"
      />

      <input
        type="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2 w-full mb-2 rounded"
      />

      <input
        type="password"
        placeholder="パスワード（6文字以上）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border p-2 w-full mb-2 rounded"
      />

      <select
        value={role}
        onChange={(e) => setRole(e.target.value as any)}
        className="border p-2 w-full mb-2 rounded"
      >
        <option value="admin">経営者（admin）</option>
        <option value="manager">部長（manager）</option>
        <option value="member">社員（member）</option>
      </select>

      {role !== 'admin' && (
        <input
          type="text"
          placeholder="所属部門"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="border p-2 w-full mb-4 rounded"
        />
      )}

      <button
        onClick={handleSignup}
        className="bg-green-600 text-white px-4 py-2 rounded w-full"
      >
        登録する
      </button>

      <p className="mt-4 text-sm text-center">
        すでにアカウントをお持ちですか？{' '}
        <a href="/login" className="text-blue-600 underline">
          ログインはこちら
        </a>
      </p>
    </div>
  );
}
