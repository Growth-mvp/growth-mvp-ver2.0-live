export default function ForbiddenPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-2xl font-semibold">403 Forbidden</h1>
        <p className="text-sm text-gray-600">
          このページにアクセスする権限がありません。
        </p>
        <a className="inline-flex items-center rounded border px-3 py-2 text-sm" href="/">
          トップへ戻る
        </a>
      </div>
    </div>
  );
}
