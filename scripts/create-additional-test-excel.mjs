import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '../test-files');

mkdirSync(outputDir, { recursive: true });

console.log('Creating additional test files with edge cases...\n');

// Test file with empty rows/columns
function createFileWithEmptyFields() {
  const wb = XLSX.utils.book_new();

  // PL with empty cells
  const plData = [
    ['項目', '2022年度', '2023年度', '2024年度'],
    ['売上高', 1000, '', 1400],  // Empty cell
    ['売上原価', 600, 720, ''],   // Empty cell
    ['', 400, 480, 560],           // Empty item name
    ['販管費', 200, 240, 280],
    ['営業利益', null, 240, 280],  // null value
  ];

  const plSheet = XLSX.utils.aoa_to_sheet(plData);
  XLSX.utils.book_append_sheet(wb, plSheet, '全社PL');

  // BS with sparse data
  const bsData = [
    ['項目', '2022年度', '2023年度', '2024年度'],
    ['現預金', 100, '', ''],
    ['売掛金', '', 240, ''],
    ['総資産', '', '', 1400],
  ];

  const bsSheet = XLSX.utils.aoa_to_sheet(bsData);
  XLSX.utils.book_append_sheet(wb, bsSheet, '全社BS');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path.join(outputDir, 'test-06-with-empty-cells.xlsx'), buffer);
  console.log('✓ Created: test-06-with-empty-cells.xlsx');
}

// Test file with non-standard sheet names but correct structure
function createFileWithNonStandardNames() {
  const wb = XLSX.utils.book_new();

  // Sheet with alternative naming
  const plData = [
    ['項目', '2022年度', '2023年度'],
    ['売上高', 1000, 1200],
    ['営業利益', 200, 240],
  ];

  const plSheet = XLSX.utils.aoa_to_sheet(plData);
  XLSX.utils.book_append_sheet(wb, plSheet, 'CompanyPL');  // English name instead of 全社PL

  const bsSheet = XLSX.utils.aoa_to_sheet([
    ['項目', '2022年度', '2023年度'],
    ['総資産', 1000, 1200],
  ]);
  XLSX.utils.book_append_sheet(wb, bsSheet, 'CompanyBS');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path.join(outputDir, 'test-07-alternative-sheet-names.xlsx'), buffer);
  console.log('✓ Created: test-07-alternative-sheet-names.xlsx');
}

// Test file with many empty sheets
function createFileWithManySheets() {
  const wb = XLSX.utils.book_new();

  // Add 5 sheets, but only some with data
  for (let i = 0; i < 5; i++) {
    const data = i === 0 || i === 2 ? [
      ['項目', '2022年度'],
      ['売上高', 1000 * (i + 1)],
    ] : [
      ['空のシート'],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, sheet, `Sheet${i + 1}`);
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path.join(outputDir, 'test-08-many-sheets.xlsx'), buffer);
  console.log('✓ Created: test-08-many-sheets.xlsx');
}

// Main segment test with more detail
function createDetailedSegmentFile() {
  const wb = XLSX.utils.book_new();

  // PL with 3 segments
  const plData = [
    ['事業部名', '項目', '2022年度', '2023年度'],
    ['事業部A', '売上高', 500, 600],
    ['事業部A', '営業利益', 100, 120],
    ['事業部B', '売上高', 300, 360],
    ['事業部B', '営業利益', 60, 72],
    ['事業部C', '売上高', 200, 240],
    ['事業部C', '営業利益', 40, 48],
  ];

  const plSheet = XLSX.utils.aoa_to_sheet(plData);
  XLSX.utils.book_append_sheet(wb, plSheet, '事業別PL');

  // BS for segments
  const bsData = [
    ['事業部名', '項目', '2022年度', '2023年度'],
    ['事業部A', '総資産', 500, 600],
    ['事業部B', '総資産', 300, 360],
    ['事業部C', '総資産', 200, 240],
  ];

  const bsSheet = XLSX.utils.aoa_to_sheet(bsData);
  XLSX.utils.book_append_sheet(wb, bsSheet, '事業別BS');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path.join(outputDir, 'test-09-three-segments.xlsx'), buffer);
  console.log('✓ Created: test-09-three-segments.xlsx');
}

try {
  createFileWithEmptyFields();
  createFileWithNonStandardNames();
  createFileWithManySheets();
  createDetailedSegmentFile();
  console.log('\n✓ All additional test files created successfully!');
} catch (err) {
  console.error('Error creating test files:', err.message);
  process.exit(1);
}
