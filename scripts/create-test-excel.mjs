import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '../test-files');

// Ensure output directory exists
mkdirSync(outputDir, { recursive: true });

/**
 * Create test Excel files in stages:
 * 1. Empty standard format
 * 2. With company PL (revenue + operating income only)
 * 3. With company BS
 * 4. With segment PL
 * 5. With segment BS
 */

// Common sheet structure
const SHEETS = {
  INPUT_GUIDE: '入力ガイド',
  COMPANY_PL: '全社PL',
  COMPANY_BS: '全社BS',
  SEGMENT_PL: '事業別PL',
  SEGMENT_BS: '事業別BS',
};

const YEARS = ['2022年度', '2023年度', '2024年度'];

// Create input guide sheet content
function createInputGuideData() {
  return [
    ['GROWTH_SHIFT 財務データ標準フォーマット'],
    [''],
    ['このファイルの使用方法：'],
    ['- 各シートに対応する決算書データを入力してください'],
    ['- 年度列の形式：YYYY年度（例：2022年度）'],
    ['- 数値は整数または小数で入力（カンマなし）'],
    ['- 空白セルは無視されます'],
    [''],
    ['シート一覧：'],
    ['- 全社PL: 連結P&L（損益計算書）'],
    ['- 全社BS: 連結貸借対照表（Balance Sheet）'],
    ['- 事業別PL: 事業部別P&L'],
    ['- 事業別BS: 事業部別貸借対照表'],
  ];
}

// Create company PL sheet with all field labels
function createCompanyPLData(includeValues = false) {
  const headers = ['項目', ...YEARS];
  const items = [
    '売上高',
    '売上原価',
    '売上総利益',
    '販管費',
    '営業利益',
    '減価償却費',
    '支払利息',
    '法人税等',
    '当期純利益',
  ];

  const rows = [headers];

  if (!includeValues) {
    for (const item of items) {
      rows.push([item, '', '', '']);
    }
  } else {
    const values = {
      '売上高': [1000, 1200, 1400],
      '売上原価': [600, 720, 840],
      '売上総利益': [400, 480, 560],
      '販管費': [200, 240, 280],
      '営業利益': [200, 240, 280],
      '減価償却費': [100, 100, 100],
      '支払利息': [20, 20, 20],
      '法人税等': [50, 60, 70],
      '当期純利益': [130, 160, 190],
    };
    for (const item of items) {
      const itemValues = values[item] || ['', '', ''];
      rows.push([item, ...itemValues]);
    }
  }

  return rows;
}

// Create company BS sheet with all field labels
function createCompanyBSData(includeValues = false) {
  const headers = ['項目', ...YEARS];
  const items = [
    '現預金',
    '売掛金',
    '棚卸資産',
    '買掛金',
    '固定資産',
    '総資産',
    '有利子負債',
    '純資産',
    '純資産合計',
  ];

  const rows = [headers];

  if (!includeValues) {
    for (const item of items) {
      rows.push([item, '', '', '']);
    }
  } else {
    const values = {
      '現預金': [100, 120, 150],
      '売掛金': [200, 240, 280],
      '棚卸資産': [150, 180, 210],
      '買掛金': [200, 240, 280],
      '固定資産': [1500, 1600, 1700],
      '総資産': [2150, 2380, 2640],
      '有利子負債': [800, 800, 800],
      '純資産': [1000, 1200, 1400],
      '純資産合計': [1350, 1580, 1840],
    };
    for (const item of items) {
      const itemValues = values[item] || ['', '', ''];
      rows.push([item, ...itemValues]);
    }
  }

  return rows;
}

// Create segment PL sheet with all field labels
function createSegmentPLData(includeValues = false) {
  const headers = ['事業部名', '項目', ...YEARS];
  const segments = ['事業部A', '事業部B'];
  const items = ['売上高', '営業利益'];

  const rows = [headers];

  if (!includeValues) {
    for (const seg of segments) {
      for (const item of items) {
        rows.push([seg, item, '', '', '']);
      }
    }
  } else {
    const values = {
      'A_売上高': [500, 600, 700],
      'A_営業利益': [100, 120, 140],
      'B_売上高': [500, 600, 700],
      'B_営業利益': [100, 120, 140],
    };
    for (const seg of segments) {
      for (const item of items) {
        const key = `${seg.replace('事業部', '')}_${item}`;
        const itemValues = values[key] || ['', '', ''];
        rows.push([seg, item, ...itemValues]);
      }
    }
  }

  return rows;
}

// Create segment BS sheet with all field labels
function createSegmentBSData(includeValues = false) {
  const headers = ['事業部名', '項目', ...YEARS];
  const segments = ['事業部A', '事業部B'];
  const items = ['総資産', '有利子負債'];

  const rows = [headers];

  if (!includeValues) {
    for (const seg of segments) {
      for (const item of items) {
        rows.push([seg, item, '', '', '']);
      }
    }
  } else {
    const values = {
      'A_総資産': [1000, 1200, 1400],
      'A_有利子負債': [400, 400, 400],
      'B_総資産': [1150, 1180, 1240],
      'B_有利子負債': [400, 400, 400],
    };
    for (const seg of segments) {
      for (const item of items) {
        const key = `${seg.replace('事業部', '')}_${item}`;
        const itemValues = values[key] || ['', '', ''];
        rows.push([seg, item, ...itemValues]);
      }
    }
  }

  return rows;
}

// Create a workbook with specified sheets
function createWorkbook(options) {
  const wb = XLSX.utils.book_new();

  // Always add input guide
  const guideSheet = XLSX.utils.aoa_to_sheet(createInputGuideData());
  XLSX.utils.book_append_sheet(wb, guideSheet, SHEETS.INPUT_GUIDE);

  if (options.includeCompanyPL) {
    const plSheet = XLSX.utils.aoa_to_sheet(
      createCompanyPLData(options.includeCompanyPLValues)
    );
    XLSX.utils.book_append_sheet(wb, plSheet, SHEETS.COMPANY_PL);
  }

  if (options.includeCompanyBS) {
    const bsSheet = XLSX.utils.aoa_to_sheet(
      createCompanyBSData(options.includeCompanyBSValues)
    );
    XLSX.utils.book_append_sheet(wb, bsSheet, SHEETS.COMPANY_BS);
  }

  if (options.includeSegmentPL) {
    const segPlSheet = XLSX.utils.aoa_to_sheet(
      createSegmentPLData(options.includeSegmentPLValues)
    );
    XLSX.utils.book_append_sheet(wb, segPlSheet, SHEETS.SEGMENT_PL);
  }

  if (options.includeSegmentBS) {
    const segBsSheet = XLSX.utils.aoa_to_sheet(
      createSegmentBSData(options.includeSegmentBSValues)
    );
    XLSX.utils.book_append_sheet(wb, segBsSheet, SHEETS.SEGMENT_BS);
  }

  return wb;
}

// Generate all test files
const testFiles = [
  {
    name: 'test-01-empty-format.xlsx',
    description: 'Empty standard format (input guide only)',
    options: {
      includeCompanyPL: false,
      includeCompanyBS: false,
      includeSegmentPL: false,
      includeSegmentBS: false,
    },
  },
  {
    name: 'test-02-company-pl-only.xlsx',
    description: 'Company PL (revenue + operating income only)',
    options: {
      includeCompanyPL: true,
      includeCompanyPLValues: true,
      includeCompanyBS: false,
      includeSegmentPL: false,
      includeSegmentBS: false,
    },
  },
  {
    name: 'test-03-company-pl-bs.xlsx',
    description: 'Company PL + BS',
    options: {
      includeCompanyPL: true,
      includeCompanyPLValues: true,
      includeCompanyBS: true,
      includeCompanyBSValues: true,
      includeSegmentPL: false,
      includeSegmentBS: false,
    },
  },
  {
    name: 'test-04-company-pl-bs-segment-pl.xlsx',
    description: 'Company PL + BS + Segment PL',
    options: {
      includeCompanyPL: true,
      includeCompanyPLValues: true,
      includeCompanyBS: true,
      includeCompanyBSValues: true,
      includeSegmentPL: true,
      includeSegmentPLValues: true,
      includeSegmentBS: false,
    },
  },
  {
    name: 'test-05-all-sheets.xlsx',
    description: 'Complete: Company PL + BS + Segment PL + BS',
    options: {
      includeCompanyPL: true,
      includeCompanyPLValues: true,
      includeCompanyBS: true,
      includeCompanyBSValues: true,
      includeSegmentPL: true,
      includeSegmentPLValues: true,
      includeSegmentBS: true,
      includeSegmentBSValues: true,
    },
  },
];

console.log(`Creating ${testFiles.length} test Excel files in ${outputDir}\n`);

for (const testFile of testFiles) {
  const wb = createWorkbook(testFile.options);
  const filePath = path.join(outputDir, testFile.name);

  try {
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    writeFileSync(filePath, buffer);
    console.log(`✓ Created: ${testFile.name}`);
    console.log(`  Description: ${testFile.description}`);
    console.log(`  Path: ${filePath}\n`);
  } catch (err) {
    console.error(`✗ Failed to create ${testFile.name}: ${err.message}`);
  }
}

console.log('Test files created successfully!');
