import { buildWebSearchStatusBlock } from './status';

describe('外部WEB検索の状態の説明', () => {
  it('機能が無効なら、無効であることを示し、接続していないと断定させない', () => {
    const b = buildWebSearchStatusBlock({ enabled: false, status: null });
    expect(b).toContain('現在オフになっています');
    expect(b).toContain('「接続していない」と断定せず');
  });

  it('有効でこの質問を検索していないときは、その事実と指示の方法を示す', () => {
    const b = buildWebSearchStatusBlock({ enabled: true, status: null });
    expect(b).toContain('外部WEB検索の機能は有効です');
    expect(b).toContain('この質問では外部WEB検索を実行していません');
    expect(b).toContain('「WEB検索して」');
  });

  it('検索に成功したときは、結果を渡したことを示す', () => {
    const b = buildWebSearchStatusBlock({ enabled: true, status: 'completed' });
    expect(b).toContain('この回答では外部WEB検索を実行し');
    expect(b).not.toContain('試みましたが');
  });

  it.each(['no_results', 'timeout', 'rate_limited', 'failed', 'skipped_no_scope'] as const)(
    '検索を試みたが得られなかった（%s）ときは、理由の記載を参照させる',
    (status) => {
      const b = buildWebSearchStatusBlock({ enabled: true, status });
      expect(b).toContain('外部WEB検索を試みましたが、外部情報を得られませんでした');
      expect(b).toContain('理由は下の【外部情報】');
    }
  );
});
