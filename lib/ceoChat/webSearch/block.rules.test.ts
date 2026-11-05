import { buildExternalInfoBlock } from './block';

describe('回答規則（質問の市場を優先し、無関係な市場を根拠にしない）', () => {
  const block = buildExternalInfoBlock({
    status: 'completed',
    facts: [{ text: '金属缶の出荷は横ばいだった。', sources: [{ title: 'T', url: 'https://example.com/a' }], period: '2025年', publishedOn: null, kind: 'annual' }],
    confirmedOn: '2026-11-05',
    categoryLabels: ['金属缶・金属容器'],
  });

  it('質問で指定された事業・市場を中心に回答し、無関係な他事業の情報を根拠にしないよう指示する', () => {
    expect(block).toContain('質問で指定された事業・市場の情報を中心に回答してください。');
    expect(block).toContain('無関係な他事業の市場情報を根拠として使用しないでください');
    expect(block).toContain('全社的な経営判断が必要な場合に限り、他事業の情報も利用できます。');
  });

  it('市場統計が質問と異なる場合の違い、直接の根拠がない場合の代用、競合情報の限界を明示するよう指示する', () => {
    expect(block).toContain('市場統計が質問対象の製品や用途と異なる場合は、その違いを明示してください。');
    expect(block).toContain('質問に対する直接の根拠がない場合は、関連する別市場のデータで代用して断定しないでください。');
    expect(block).toContain('競合企業の具体的な情報が得られなかった場合は、その限界を明示してください。');
  });

  it('既存の区分（自社・競合の識別、出典、対象期間）の規則は残す', () => {
    expect(block).toContain('自社に関する公開情報は、自社の現状を示す材料として扱い');
    expect(block).toContain('公表日・対象期間が「未確認」の情報には、日付を推測して補わないでください。');
    expect(block).toContain('出典を使った場合は、回答の末尾に「出典」として');
  });
});
