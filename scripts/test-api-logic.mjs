/**
 * Direct test of stage1/import API logic without running the server
 * Tests parseExcel and buildCandidatesFromTable
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the actual implementation (use dynamic import for ESM compat)
const excelCsvImporterModule = await import('../utils/stage1/importers/excelCsvImporter.ts');
const parseExcel = excelCsvImporterModule.parseExcel;
const detectFileType = excelCsvImporterModule.detectFileType;

console.log('='.repeat(80));
console.log('STAGE1 IMPORT API LOGIC TEST');
console.log('='.repeat(80));

const testFilesDir = path.join(__dirname, '../test-files');
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
    console.log(`✓ File read successfully (${buffer.length} bytes)`);

    // Detect file type
    const fileType = detectFileType(buffer, fileName);
    console.log(`✓ File type detected: ${fileType}`);

    if (fileType !== 'excel') {
      console.error(`✗ Expected Excel file, got ${fileType}`);
      continue;
    }

    // Parse Excel
    console.log(`\nParsing Excel file...`);
    const tables = parseExcel(buffer);
    console.log(`✓ Excel parsed successfully`);
    console.log(`  Sheets found: ${tables.length}`);

    for (const table of tables) {
      console.log(`\n  Sheet: ${table.sheetName || '(unknown)'}`);
      console.log(`    Headers: ${table.headers.length}`);
      console.log(`      ${table.headers.slice(0, 5).join(', ')}${table.headers.length > 5 ? '...' : ''}`);
      console.log(`    Rows: ${table.rows.length}`);
      if (table.rows.length > 0) {
        const firstRow = table.rows[0];
        console.log(`      First row keys: ${Object.keys(firstRow).slice(0, 5).join(', ')}`);
      }
    }

    console.log(`\n✓ ${fileName} - SUCCESS`);
  } catch (err) {
    console.error(`✗ ${fileName} - FAILED`);
    console.error(`\nError Details:`);
    console.error(`  Type: ${err instanceof Error ? err.constructor.name : typeof err}`);
    console.error(`  Message: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.error(`  Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    if ((err as any).cause) {
      console.error(`  Cause: ${(err as any).cause}`);
    }
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log('TEST COMPLETED');
console.log('='.repeat(80));
