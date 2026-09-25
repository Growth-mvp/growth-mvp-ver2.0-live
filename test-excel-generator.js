const XLSX = require('xlsx');
const path = require('path');

// Create a workbook with multiple sheets
const workbook = XLSX.utils.book_new();

// Sheet 1: 全社PL (Company PL)
const plData = [
  ['項目名', '2026年度', '2025年度', '2024年度', '2023年度', '2022年度'],
  ['売上高', 10000000, 9500000, 9000000, 8500000, 8000000],
  ['売上原価', 6000000, 5700000, 5400000, 5100000, 4800000],
  ['販管費', 2000000, 1900000, 1800000, 1700000, 1600000],
  ['営業利益', 2000000, 1900000, 1800000, 1700000, 1600000],
];
const plSheet = XLSX.utils.aoa_to_sheet(plData);
XLSX.utils.book_append_sheet(workbook, plSheet, '全社PL');

// Sheet 2: 全社BS (Company BS)
const bsData = [
  ['項目名', '2026年度', '2025年度', '2024年度', '2023年度', '2022年度'],
  ['現金及び預金', 5000000, 4800000, 4600000, 4400000, 4200000],
  ['売上債権', 2000000, 1900000, 1800000, 1700000, 1600000],
  ['棚卸資産', 3000000, 2900000, 2800000, 2700000, 2600000],
  ['固定資産', 15000000, 14500000, 14000000, 13500000, 13000000],
  ['総資産', 25000000, 24100000, 23200000, 22300000, 21400000],
];
const bsSheet = XLSX.utils.aoa_to_sheet(bsData);
XLSX.utils.book_append_sheet(workbook, bsSheet, '全社BS');

// Sheet 3: 事業別PL (Segment PL)
const segmentPlData = [
  ['事業部名', '項目名', '2026年度', '2025年度', '2024年度', '2023年度', '2022年度'],
  ['金属缶製造販売事業', '売上高', 6000000, 5700000, 5400000, 5100000, 4800000],
  ['金属缶製造販売事業', '売上原価', 3600000, 3420000, 3240000, 3060000, 2880000],
  ['金属缶製造販売事業', '販管費', 1000000, 950000, 900000, 850000, 800000],
  ['金属缶製造販売事業', '営業利益', 1400000, 1330000, 1260000, 1190000, 1120000],
  ['不動産賃貸事業', '売上高', 4000000, 3800000, 3600000, 3400000, 3200000],
  ['不動産賃貸事業', '売上原価', 2400000, 2280000, 2160000, 2040000, 1920000],
  ['不動産賃貸事業', '販管費', 1000000, 950000, 900000, 850000, 800000],
  ['不動産賃貸事業', '営業利益', 600000, 570000, 540000, 510000, 480000],
];
const segmentPlSheet = XLSX.utils.aoa_to_sheet(segmentPlData);
XLSX.utils.book_append_sheet(workbook, segmentPlSheet, '事業別PL');

// Write to file
const outputPath = path.join(__dirname, 'test-financial-data.xlsx');
XLSX.writeFile(workbook, outputPath);
console.log(`✓ Test Excel file created: ${outputPath}`);
console.log('Sheets: 全社PL, 全社BS, 事業別PL');
