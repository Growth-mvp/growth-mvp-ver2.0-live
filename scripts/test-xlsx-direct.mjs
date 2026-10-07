/**
 * Direct test of xlsx library with test Excel files
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFilesDir = path.join(__dirname, '../test-files');

console.log('='.repeat(80));
console.log('XLSX LIBRARY DIRECT TEST');
console.log('='.repeat(80));

const testFiles = [
  'test-01-empty-format.xlsx',
  'test-02-company-pl-only.xlsx',
  'test-03-company-pl-bs.xlsx',
  'test-04-company-pl-bs-segment-pl.xlsx',
  'test-05-all-sheets.xlsx',
];

for (const fileName of testFiles) {
  const filePath = path.join(testFilesDir, fileName);
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`Testing: ${fileName}`);
  console.log(`─`.repeat(80));

  try {
    // Read file
    const buffer = readFileSync(filePath);
    console.log(`✓ File read: ${buffer.length} bytes`);

    // Parse with XLSX
    console.log(`\nCalling XLSX.read()...`);
    const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 50001 });
    console.log(`✓ XLSX.read() successful`);
    console.log(`  Sheet names: ${workbook.SheetNames.join(', ')}`);
    console.log(`  Sheet count: ${workbook.SheetNames.length}`);

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      console.log(`\n  Sheet: "${sheetName}"`);
      console.log(`    Ref: ${sheet['!ref'] || '(none)'}`);
      console.log(`    FullRef: ${sheet['!fullref'] || '(none)'}`);

      try {
        const jsonData = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null,
        });
        console.log(`    ✓ Converted to JSON array`);
        console.log(`      Rows: ${jsonData.length}`);
        if (jsonData.length > 0) {
          console.log(`      First row (${(jsonData[0] || []).length} cols): ${JSON.stringify((jsonData[0] || []).slice(0, 3))}`);
        }
      } catch (jsonErr) {
        console.error(`    ✗ JSON conversion failed: ${jsonErr.message}`);
      }
    }

    console.log(`\n✓ ${fileName} - PASSED`);
  } catch (err) {
    console.error(`✗ ${fileName} - FAILED`);
    console.error(`  Error: ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1, 4);
      console.error(`  Stack:\n    ${stackLines.join('\n    ')}`);
    }
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log('TEST COMPLETED');
console.log('='.repeat(80));
