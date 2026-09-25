// Direct test of candidateBuilder logic
// This tests the core functions without HTTP

// Manually test the regex patterns
const segTests = [
  '全社PL',
  '全社BS',
  '全社',
  '事業別PL',
  '金属缶製造販売事業',
  'Consolidated PL',
];

const companyPattern = /全社|連結|合算|会社|company|consolidated/i;
const segmentPattern = /事業別|事業部|segment/i;

console.log('=== SCOPE DETECTION TEST ===\n');

for (const seg of segTests) {
  const companyMatch = companyPattern.test(seg);
  const segmentMatch = segmentPattern.test(seg);

  let result = 'UNKNOWN';
  if (companyMatch) {
    result = 'COMPANY';
  } else if (segmentMatch) {
    result = 'SEGMENT';
  } else {
    result = 'DEFAULT→SEGMENT';
  }

  console.log(`"${seg}"`);
  console.log(`  Company regex: ${companyMatch ? '✓ MATCH' : '✗ no match'}`);
  console.log(`  Segment regex: ${segmentMatch ? '✓ MATCH' : '✗ no match'}`);
  console.log(`  Result: ${result}\n`);
}

// Test PL field matching
console.log('=== PL FIELD MATCHING TEST ===\n');

const plPatterns = {
  revenue: [/売上高/i, /売上/i, /revenue/i, /sales/i, /net\s*sales/i],
  grossProfit: [/売上総利益/i, /粗利/i, /gross\s*profit/i],
  cogs: [/売上原価/i, /原価/i, /cost\s*of\s*(goods\s*)?sold/i, /cogs/i],
  sga: [/販管費/i, /販売費及び一般管理費/i, /sg&?a/i, /operating\s*expenses/i],
  operatingIncome: [/営業利益/i, /operating\s*(income|profit)/i],
  depreciation: [/減価償却/i, /depreciation/i],
  interest: [/支払利息/i, /interest\s*expense/i],
  tax: [/法人税等?/i, /income\s*tax/i, /税金/i],
  netIncome: [/当期純利益/i, /純利益/i, /net\s*(income|profit)/i],
};

const itemNames = [
  '売上高',
  '売上原価',
  '販管費',
  '営業利益',
];

function matchField(text, patterns) {
  for (const [field, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(text)) {
        return field;
      }
    }
  }
  return null;
}

for (const itemName of itemNames) {
  const matched = matchField(itemName, plPatterns);
  console.log(`"${itemName}" → ${matched || 'NO MATCH'}`);
}

// Test BS field matching
console.log('\n=== BS FIELD MATCHING TEST ===\n');

const bsPatterns = {
  cash: [/現金?及び?預金?/i, /現預金/i, /cash/i],
  ar: [/売掛金/i, /受取手形/i, /売上債権/i, /accounts?\s*receivable/i, /a\/r/i],
  inventory: [/棚卸資産/i, /商品/i, /製品/i, /inventory/i, /inventories/i],
  ap: [/買掛金/i, /支払手形/i, /仕入債務/i, /accounts?\s*payable/i, /a\/p/i],
  fixedAssets: [/固定資産/i, /有形固定資産/i, /fixed\s*assets/i, /property/i],
  totalAssets: [/総資産/i, /資産合計/i, /total\s*assets/i],
  interestBearingDebt: [/有利子負債/i, /借入金/i, /社債/i, /interest.bearing\s*debt/i],
  equity: [/純資産/i, /株主資本/i, /自己資本/i, /(shareholders'?|stockholders'?)\s*equity/i],
  netAssets: [/純資産合計/i, /net\s*assets/i],
};

const bsItemNames = [
  '現金及び預金',
  '売上債権',
  '棚卸資産',
  '固定資産',
  '総資産',
];

for (const itemName of bsItemNames) {
  const matched = matchField(itemName, bsPatterns);
  console.log(`"${itemName}" → ${matched || 'NO MATCH'}`);
}

console.log('\n=== SEGMENT NAME COLUMN DETECTION TEST ===\n');

const headers = ['事業部名', '項目名', '2026年度', '2025年度'];
const segmentNamePattern = /事業部名|事業名|セグメント名|segment|division/i;

const segmentNameColumn = headers.find((h) => segmentNamePattern.test(h));
console.log(`Headers: ${JSON.stringify(headers)}`);
console.log(`Segment name column: "${segmentNameColumn || '(NOT FOUND)'}"`);
