import { swotBullets, swotItems } from './swotPrompt';

describe('確定 SWOT の項目化', () => {
  it('改行で区切られた1行を1項目とし、読点・句点では分けない', () => {
    expect(swotItems('金属缶の需要が増える、ただし価格は下がる。\n樹脂容器が普及する')).toEqual([
      '金属缶の需要が増える、ただし価格は下がる。',
      '樹脂容器が普及する',
    ]);
  });

  it('空行と空白だけの行は捨て、キャリッジリターンは取り除く', () => {
    expect(swotItems('  機会A  \r\n\n  \n機会B\r')).toEqual(['機会A', '機会B']);
  });

  it('文字列でない値は項目なし', () => {
    expect(swotItems(undefined)).toEqual([]);
    expect(swotItems(12345)).toEqual([]);
  });
});

describe('確定 SWOT の本文（上限つき）', () => {
  it('上限内なら全項目を残し、省略の表示を付けない', () => {
    const r = swotBullets('機会A\n機会B\n機会C', 1000);
    expect(r).toEqual({ text: '機会A ・ 機会B ・ 機会C', included: 3, omitted: 0 });
  });

  it('4件目以降を3件で切らない（上限は文字数だけ）', () => {
    const items = Array.from({ length: 12 }, (_, i) => `機会${i + 1}の内容です。`);
    const r = swotBullets(items.join('\n'), 1000);
    expect(r.included).toBe(12);
    expect(r.omitted).toBe(0);
    expect(r.text).toContain('機会12の内容です。');
  });

  it('文字数の上限を超えた分は、入った件数と省略件数を返し、本文にも明記する', () => {
    const items = Array.from({ length: 5 }, (_, i) => `${'あ'.repeat(40)}${i + 1}`);
    const r = swotBullets(items.join('\n'), 100);
    expect(r.included).toBe(2);
    expect(r.omitted).toBe(3);
    expect(r.text).toContain('ほか3件は文字数上限のため省略');
    expect(r.text).not.toContain(items[2]);
  });

  it('1項目が上限より長くても、その項目は途中で切らず、最低1件は残す', () => {
    const long = 'あ'.repeat(300);
    const r = swotBullets(`${long}\n短い機会`, 100);
    expect(r.included).toBe(1);
    expect(r.text.startsWith(long)).toBe(true);
    expect(r.omitted).toBe(1);
  });

  it('空の入力は空の本文と 0 件を返す', () => {
    expect(swotBullets('', 100)).toEqual({ text: '', included: 0, omitted: 0 });
  });
});
