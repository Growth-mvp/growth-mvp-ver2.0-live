import { deflateRawSync } from 'node:zlib';
import { decodeEdinetText, parseEdinetCsv, readZipEntries } from './edinetZip';

function makeZip(files: Array<{ name: string; data: Buffer; deflate: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cdir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdir, eocd]);
}

describe('EDINETの構造化データ（zip・CSV）の読み取り', () => {
  it('圧縮（deflate）と無圧縮の両方のエントリを取り出す', () => {
    const zip = makeZip([
      { name: 'XBRL_TO_CSV/a.csv', data: Buffer.from('hello', 'utf8'), deflate: true },
      { name: 'XBRL_TO_CSV/b.csv', data: Buffer.from('world', 'utf8'), deflate: false },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => [e.name, e.data.toString('utf8')])).toEqual([
      ['XBRL_TO_CSV/a.csv', 'hello'],
      ['XBRL_TO_CSV/b.csv', 'world'],
    ]);
  });

  it('壊れた zip は、例外にする（黙って空を返さない）', () => {
    expect(() => readZipEntries(Buffer.from('not a zip'))).toThrow('zip_eocd_not_found');
  });

  it('UTF-16LE（BOM付き）のCSVを、タブ区切りの行に直す', () => {
    const text = '"要素ID"\t"項目名"\t"コンテキストID"\t"相対年度"\t"連結・個別"\t"期間・時点"\t"ユニットID"\t"単位"\t"値"\r\n"jppfs_cor:NetSales"\t"売上高"\t"CurrentYearDuration"\t"当期"\t"連結"\t"期間"\t"JPY"\t"円"\t"123"\r\n';
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    const rows = parseEdinetCsv(decodeEdinetText(buf));
    expect(rows).toEqual([
      { elementId: 'jppfs_cor:NetSales', label: '売上高', contextId: 'CurrentYearDuration', relativePeriod: '当期', scope: '連結', periodType: '期間', unitId: 'JPY', unit: '円', value: '123' },
    ]);
  });
});
