import { buildPlanExportDocument, normalizeDisplayName } from './planExportDocument';

const BANK_HEADING = '経営改善・事業計画書';
const ch = (code: number) => String.fromCharCode(code);
const ZWSP = ch(0x200b);
const BOM = ch(0xfeff);
const WORD_JOINER = ch(0x2060);
const SOFT_HYPHEN = ch(0x00ad);
const IDEOGRAPHIC_SPACE = ch(0x3000);
const NBSP = ch(0x00a0);
const IVS_1 = ch(0xfe00);
const TAKA_KANJI = ch(0x9ad9);
const COMPAT_SAKI = ch(0xfa11);

describe('表示用の会社名は社名の文字を変えない', () => {
  it.each([
    ['通常の社名', '株式会社丹青社'],
    ['全角英数', 'ＧＳ株式会社'],
    ['囲み文字の株式会社', '㈱丹青社'],
    ['互換漢字', `${COMPAT_SAKI}野株式会社`],
    ['異体字セレクタ付きの漢字', `株式会社${TAKA_KANJI}${IVS_1}野`],
    ['社名内の連続した空白', '株式会社  丹青社'],
  ])('%s はそのまま', (_, name) => {
    expect(normalizeDisplayName(name)).toBe(name);
  });
});

describe('表示上の問題になる文字だけを処理する', () => {
  it('特殊な空白を通常の空白にそろえる', () => {
    expect(normalizeDisplayName(`株式会社${IDEOGRAPHIC_SPACE}丹青社`)).toBe('株式会社 丹青社');
    expect(normalizeDisplayName(`株式会社${NBSP}丹青社`)).toBe('株式会社 丹青社');
  });

  it('見えない文字を取り除く', () => {
    expect(normalizeDisplayName(`株式会社${ZWSP}丹青社`)).toBe('株式会社丹青社');
    expect(normalizeDisplayName(`株式会社${BOM}丹青社`)).toBe('株式会社丹青社');
    expect(normalizeDisplayName(`株式会社${WORD_JOINER}丹青社`)).toBe('株式会社丹青社');
    expect(normalizeDisplayName(`株式会社${SOFT_HYPHEN}丹青社`)).toBe('株式会社丹青社');
  });

  it('前後の空白と見えない文字を整える', () => {
    expect(normalizeDisplayName(`${ZWSP} 株式会社丹青社 ${BOM}`)).toBe('株式会社丹青社');
  });
});

describe('タイトル', () => {
  it('正規化した名前を見出しと組み合わせる', () => {
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: `株式会社${IDEOGRAPHIC_SPACE}丹青社${ZWSP} `,
      generatedAt: '2026-11-07T00:00:00.000Z',
      markdown: '',
    });
    expect(doc.title).toBe(`株式会社 丹青社 ${BANK_HEADING}`);
  });

  it('社名がなければ見出しだけにする', () => {
    const doc = buildPlanExportDocument({
      audience: 'bank',
      companyName: null,
      generatedAt: '2026-11-07T00:00:00.000Z',
      markdown: '',
    });
    expect(doc.title).toBe(BANK_HEADING);
  });
});
