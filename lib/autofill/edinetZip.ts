/* EDINETの構造化データ（CSV のzip）を読む。zip は外部ライブラリを使わず、中央ディレクトリから展開する。
 * CSV は UTF-16LE（BOM付き）のタブ区切り。 */
import { inflateRawSync } from 'node:zlib';

export type ZipEntry = { name: string; data: Buffer };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function readZipEntries(zip: Buffer): ZipEntry[] {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd--;
  if (eocd < 0) throw new Error('zip_eocd_not_found');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== CENTRAL_SIGNATURE) throw new Error('zip_central_invalid');
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (zip.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error('zip_local_invalid');
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`zip_method_unsupported_${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function decodeEdinetText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = t;
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8');
}

export type CsvRow = { elementId: string; label: string; contextId: string; relativePeriod: string; scope: string; periodType: string; unitId: string; unit: string; value: string };

export function parseEdinetCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split('\t').map((v) => v.replace(/^"|"$/g, ''));
    if (c.length < 9) continue;
    rows.push({ elementId: c[0], label: c[1], contextId: c[2], relativePeriod: c[3], scope: c[4], periodType: c[5], unitId: c[6], unit: c[7], value: c[8] });
  }
  return rows;
}
