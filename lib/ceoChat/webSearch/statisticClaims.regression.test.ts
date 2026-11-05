import { buildExternalInfoBlock } from './block';
import { buildSearchInstructions, type CeoFact } from './search';
import { resolveCeoWebSearch } from './index';
import {
  buildStatClaimNotice,
  checkStatisticClaims,
  productScopesIn,
} from './statisticScope';

const SOURCE = { title: '統計資料', url: 'https://example.com/stat' };
const fact = (over: Partial<CeoFact>): CeoFact => ({
  text: '',
  sources: [SOURCE],
  period: null,
  publishedOn: null,
  kind: null,
  ...over,
});
const kinds = (r: ReturnType<typeof checkStatisticClaims>) => r.findings.map((f) => `${f.kind}:${f.value}`);

describe('問題1: 工業会・団体名に含まれる製品名を統計の対象製品と誤認しない', () => {
  it('ドラム缶工業会の集計は、ドラム缶・200L缶として扱わない（集計に含まれる200L缶・ペール缶だけを拾う）', () => {
    const text = '日本の2024年（暦年）のドラム缶工業会集計では、200L缶・ペール缶・中小型缶の合計出荷は29,754千本';
    expect(productScopesIn(text)).toEqual(['200L缶', 'ペール缶']);
  });

  it('団体名だけに製品名がある事実は、製品区分を持たない', () => {
    expect(productScopesIn('ドラム缶工業会の発表によると、出荷は横ばいだった')).toEqual([]);
    expect(productScopesIn('美術缶協会の会員調査では出荷は増えた')).toEqual([]);
  });

  it('既存の正しい検出は維持する（製品名そのものの記述、団体名の後の製品名）', () => {
    expect(productScopesIn('ドラム缶の出荷は2.6%減')).toEqual(['ドラム缶']);
    expect(productScopesIn('18L缶の出荷は増えた')).toEqual(['18L缶']);
    expect(productScopesIn('ドラム缶工業会の集計で、18L缶は増えた')).toEqual(['18L缶']);
    expect(productScopesIn('200L缶とペール缶')).toEqual(['200L缶', 'ペール缶']);
  });
});

describe('問題2: 出典にない合計・前年比・増減方向を生成させない（回答規則）', () => {
  const block = buildExternalInfoBlock({
    status: 'completed',
    facts: [fact({ text: '200L缶の出荷は2.6%減', period: '2025年', kind: 'annual' })],
    confirmedOn: '2026-11-05',
  });

  it('出典にない複数製品の合計・平均・前年比を書かない規則を含む', () => {
    expect(block).toContain('出典にない複数の製品・用途の合計値や、出典にない平均値・前年比を計算して書かないでください。');
  });

  it('増減方向を出典どおりに書き、複数区分の増減を一つの方向にまとめない規則を含む', () => {
    expect(block).toContain('増加・減少の方向は出典の記述どおりに書き、反対の表現にしないでください。');
    expect(block).toContain('複数の区分の増減を、一つの方向にまとめないでください。');
  });

  it('合計値を含む事実には、個別製品の値として扱わない注記を付ける', () => {
    const b = buildExternalInfoBlock({
      status: 'completed',
      facts: [fact({ text: '200L缶・ペール缶の合計出荷は28,742千本', period: '2025年', kind: 'annual' })],
      confirmedOn: '2026-11-05',
    });
    expect(b).toContain('複数区分の合計値のため、個別の製品の値として扱わない');
  });

  it('検索指示は、範囲の広い統計に特定の市場ラベルを付けないよう指示する', () => {
    expect(buildSearchInstructions(new Date('2026-11-05T00:00:00Z'))).toContain(
      '包装・容器全体など範囲の広い統計に、特定の市場ラベルを付けないでください。'
    );
  });
});

describe('問題3: 回答後の数値検証（対象期間・製品区分・指標・増減方向・出典）', () => {
  it('2025年1〜10月の累計を「2025年通年」と書いた回答を検出する', () => {
    const facts = [fact({ text: '200L缶の出荷は2.6%減', period: '2025年1月〜10月', kind: 'annual' })];
    const r = checkStatisticClaims('2025年通年では、200L缶の出荷は2.6%減でした。', facts);
    expect(kinds(r)).toEqual(['period:2.6%']);
  });

  it('2025年1〜10月の累計を正しく部分期間として書いた回答は検出しない', () => {
    const facts = [fact({ text: '200L缶の出荷は2.6%減', period: '2025年1月〜10月', kind: 'annual' })];
    const r = checkStatisticClaims('2025年1月〜10月の200L缶の出荷は2.6%減でした。', facts);
    expect(r.findings).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('部分期間の数値について「通年とは比較できない」と否定して書いた文は、誤検出しない', () => {
    const facts = [fact({ text: '200L缶の出荷は3.1%増', period: '2026年1〜6月', kind: 'flash' })];
    const r = checkStatisticClaims(
      '2026年1〜6月の200L缶は前年同期比3.1%増ですが、2025年通年の数値とは直接比較できません。',
      facts
    );
    expect(r.findings).toEqual([]);
  });

  it('2025年9月の単月を「2025年の年間出荷」と書いた回答を検出する', () => {
    const facts = [fact({ text: '金属缶の出荷は3.0%増', period: '2025年9月', kind: 'flash' })];
    const r = checkStatisticClaims('2025年の年間出荷は3.0%増でした。', facts);
    expect(kinds(r)).toEqual(['period:3.0%']);
  });

  it('2025年9月の単月を正しく単月として書いた回答は検出しない', () => {
    const facts = [fact({ text: '金属缶の出荷は3.0%増', period: '2025年9月', kind: 'flash' })];
    expect(checkStatisticClaims('2025年9月の出荷は3.0%増でした。', facts).findings).toEqual([]);
  });

  it('増減方向が出典と反対の回答を検出する', () => {
    const facts = [fact({ text: '化学向けが1.8％増', period: '2024年', kind: 'annual' })];
    expect(kinds(checkStatisticClaims('化学向けは1.8%減でした。', facts))).toEqual(['direction:1.8%']);
    expect(checkStatisticClaims('化学向けは1.8%増でした。', facts).findings).toEqual([]);
  });

  it('出典にない合計値・前年比を検出する（数値として書かれた場合）', () => {
    const facts = [
      fact({ text: '200L缶は12,256千本', period: '2025年1月〜12月', kind: 'annual' }),
      fact({ text: 'ペール缶は16,486千本', period: '2025年1月〜12月', kind: 'annual' }),
    ];
    expect(kinds(checkStatisticClaims('合計では28,742千本になります。', facts))).toEqual(['unsourced:28,742千本']);
    expect(kinds(checkStatisticClaims('前年比4.5%増となりました。', facts))).toEqual(['unsourced:4.5%']);
  });

  it('製品区分が出典と異なる、または出典に区分がない数値を検出する', () => {
    const facts = [fact({ text: '出荷は2.6%減', period: '2025年1月〜12月', kind: 'annual' })];
    expect(kinds(checkStatisticClaims('200L缶の出荷は2.6%減です。', facts))).toEqual(['product:2.6%']);

    const tagged = [fact({ text: '18L缶の出荷は2.6%減', period: '2025年1月〜12月', kind: 'annual' })];
    expect(kinds(checkStatisticClaims('200L缶の出荷は2.6%減です。', tagged))).toEqual(['product:2.6%']);
  });

  it('統計指標（出荷と売上など）が出典と異なる数値を検出する', () => {
    const facts = [fact({ text: '売上は2.6%減', period: '2025年1月〜12月', kind: 'annual' })];
    expect(kinds(checkStatisticClaims('出荷は2.6%減でした。', facts))).toEqual(['indicator:2.6%']);
  });

  it('社内データ・会話履歴にだけある数値を、外部統計として書いた場合に検出する', () => {
    const facts = [fact({ text: '別の数値は1.0%増', period: null })];
    const internal = ['金属缶事業の売上は7.5%減'];
    expect(kinds(checkStatisticClaims('業界統計では7.5%減となっています。', facts, internal))).toEqual([
      'internal:7.5%',
    ]);
    expect(checkStatisticClaims('社内の金属缶売上は7.5%減です。', facts, internal).findings).toEqual([]);
  });

  it('対象期間や方向が読めず照合できない数値は、断定として注記しない（誤って削除もしない）', () => {
    const facts = [fact({ text: '出荷は2.6%', period: '2025年1月〜12月', kind: 'annual' })];
    const r = checkStatisticClaims('出荷は2.6%減でした。', facts);
    expect(r.findings).toEqual([]);
    expect(r.unverifiable).toBe(1);
  });

  it('URLのパーセントエンコード（%E3%81…）を数値として扱わない', () => {
    const facts = [fact({ text: '200L缶は12,256千本', period: '2025年1月〜12月', kind: 'annual' })];
    const r = checkStatisticClaims(
      '出典: https://www.jsda.gr.jp/wp/uploads/%E3%81%B2%E3%81%B3%E3%81%8D90_20250207-2.pdf',
      facts
    );
    expect(r).toEqual({ checked: 0, unverifiable: 0, findings: [] });
  });

  it('本文の要約に数値が無くても、出典の見出しに同じ数値があれば根拠として認める', () => {
    const facts = [
      fact({
        text: '18L缶は2026年4〜9月の出荷が前年同期比で増加しました',
        period: '2026年4〜9月',
        kind: 'other',
        sources: [{ title: '18リットル缶　4―9月1.6％増　出荷、塗料のみ減少', url: 'https://example.com/a' }],
      }),
      fact({ text: '別の統計は1.6％減でした', period: '2025年1月〜12月', kind: 'annual' }),
    ];
    const r = checkStatisticClaims('2026年4〜9月の18L缶は前年同期比1.6％増でした。', facts);
    expect(r.findings).toEqual([]);
  });

  it('外部事実が無い場合は検証しない（回答を変えない）', () => {
    const r = checkStatisticClaims('2025年通年では2.6%減です。', []);
    expect(r).toEqual({ checked: 0, unverifiable: 0, findings: [] });
    expect(buildStatClaimNotice(r.findings)).toBe('');
  });

  it('注記は数値と理由だけを示し、回答本文を引用しない', () => {
    const notice = buildStatClaimNotice([{ kind: 'period', value: '2.6%' }, { kind: 'unsourced', value: '28,742千本' }]);
    expect(notice).toContain('【数値の確認】');
    expect(notice).toContain('2.6%（対象期間が出典と異なる');
    expect(notice).toContain('28,742千本（出典にない数値）');
    expect(notice).not.toContain('2025年通年では');
  });
});

describe('問題3の結線: 検索結果から検証までを固定データで通す', () => {
  const STRATEGY: any = {
    companyName: '日本製罐株式会社',
    industry: 'manufacturing',
    businessContent: '',
    businessSegments: [{ id: 's', name: '金属缶事業', summary: '金属缶', mainProductsServices: ['金属缶'], keyCustomers: [], revenue: 900 }],
  };
  const QUESTION = '金属缶市場の最新動向を教えてください。';

  const mockClient = (text: string) =>
    ({
      responses: {
        create: jest.fn(async () => ({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text,
                  annotations: [{ type: 'url_citation', url: SOURCE.url, title: SOURCE.title, end_index: text.length - 1 }],
                },
              ],
            },
          ],
        })),
      },
    }) as any;

  it('2025年1〜10月の累計（モック）を通年と書いた回答は、期間の注記を付ける対象になる', async () => {
    const line =
      '金属缶の出荷は2.6%減 ｜ 対象期間: 2025年1月〜10月 ｜ 公表日: 2025-12-01 ｜ 種別: 年間統計';
    const web = await resolveCeoWebSearch({
      enabled: true,
      question: QUESTION,
      strategy: STRATEGY,
      client: mockClient(line),
    });
    expect(web.facts).toHaveLength(1);
    const r = checkStatisticClaims('2025年通年で、金属缶の出荷は2.6%減でした。', web.facts);
    expect(r.findings.map((f) => f.kind)).toEqual(['period']);
  });

  it('2025年9月の単月（モック）を年間と書いた回答は、期間の注記を付ける対象になる', async () => {
    const line = '金属缶の出荷は3.0%増 ｜ 対象期間: 2025年9月 ｜ 公表日: 2025-10-15 ｜ 種別: 月次速報';
    const web = await resolveCeoWebSearch({
      enabled: true,
      question: QUESTION,
      strategy: STRATEGY,
      client: mockClient(line),
    });
    const r = checkStatisticClaims('2025年の年間出荷は3.0%増でした。', web.facts);
    expect(r.findings.map((f) => f.kind)).toEqual(['period']);
  });
});
