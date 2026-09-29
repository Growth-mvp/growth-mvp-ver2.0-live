#!/usr/bin/env node

/**
 * Test script for operation parser
 * Usage: node scripts/test-operation-parser.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

/**
 * Load and parse the operation guide
 */
function loadOperationGuide() {
  const filePath = path.join(rootDir, 'OPERATION_GUIDE_FINAL.md');
  const content = fs.readFileSync(filePath, 'utf-8');
  return content;
}

/**
 * Extract screen sections (H2 headings)
 */
function extractScreenSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentSection = null;
  let sectionStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect H2 headings (## format)
    const h2Match = line.match(/^## (\d+)\. (.+?)(?:\s+\|\s+.+)?$/);
    if (h2Match) {
      if (currentSection) {
        sections.push(currentSection);
      }

      const screenNumber = parseInt(h2Match[1]);
      const screenName = h2Match[2].trim();

      // Extract path
      let screenPath = '/';
      let pathLineOffset = 1;
      while (i + pathLineOffset < lines.length) {
        const nextLine = lines[i + pathLineOffset];
        if (nextLine.includes('**パス:**')) {
          const pathMatch = nextLine.match(/`([^`]+)`/);
          if (pathMatch) {
            screenPath = pathMatch[1];
          }
          break;
        }
        if (nextLine.startsWith('## ') || nextLine.startsWith('# ')) {
          break;
        }
        pathLineOffset++;
      }

      currentSection = {
        screenNumber,
        screenName,
        screenPath,
        startLine: i,
        endLine: i,
      };
      sectionStartLine = i;
    }
  }

  if (currentSection) {
    currentSection.endLine = lines.length;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract operations from a section
 */
function extractOperationsFromSection(section, lines) {
  const operations = [];
  const sectionLines = lines.slice(section.startLine, section.endLine);

  let currentOp = null;

  for (let i = 0; i < sectionLines.length; i++) {
    const line = sectionLines[i];

    // Detect operation headers
    const h3Match = line.match(/^### (.+?)(?:\s*\(|$)/);
    const bulletMatch = line.match(/^(\d+)\.\s+\*?\*?(.+?)(?:\*?\*|\s*[(:【\(])/);

    if (h3Match || bulletMatch) {
      if (currentOp) {
        operations.push(currentOp);
      }

      const opName = h3Match ? h3Match[1].trim() : (bulletMatch[2] || bulletMatch[1]).trim();
      currentOp = {
        screen: section.screenName,
        screenPath: section.screenPath,
        operationName: opName,
        line: section.startLine + i + 1,
      };
    }
  }

  if (currentOp) {
    operations.push(currentOp);
  }

  return operations;
}

/**
 * Main test
 */
function main() {
  console.log('🔍 Loading OPERATION_GUIDE_FINAL.md...');
  const content = loadOperationGuide();
  const lines = content.split('\n');

  console.log(`✓ Loaded ${lines.length} lines\n`);

  console.log('📊 Extracting screen sections...');
  const sections = extractScreenSections(content);
  console.log(`✓ Found ${sections.length} screens:\n`);

  let totalOperations = 0;

  for (const section of sections) {
    console.log(`   [${section.screenNumber}] ${section.screenName} (${section.screenPath})`);

    const operations = extractOperationsFromSection(section, lines);
    totalOperations += operations.length;

    for (const op of operations) {
      console.log(`       • ${op.operationName}`);
    }
  }

  console.log(`\n📈 Statistics:`);
  console.log(`   Total screens: ${sections.length}`);
  console.log(`   Total operations: ${totalOperations}`);
  console.log(`   Average per screen: ${(totalOperations / sections.length).toFixed(1)}`);

  console.log('\n✅ Parser test completed successfully!');
}

main();
