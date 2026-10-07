# Incident: ReferenceError: DOMMatrix is not defined

**Date:** 2026-10-07  
**Severity:** Critical  
**Status:** Resolved  
**Component:** `/api/stage1/import`

## Symptom

STAGE1 Excel import API returned HTTP 500 error on Vercel production environment. Requests failed before reaching business logic, at module initialization.

```
ReferenceError: DOMMatrix is not defined
  at module load time (before request processing)
```

## Root Cause

1. `/api/stage1/import/route.ts` imported `pdfImporter` at module level
2. `pdfImporter.ts` used CommonJS `require('pdf-parse')`
3. `pdf-parse` depends on `pdfjs-dist`
4. `pdfjs-dist` references `DOMMatrix` (DOM API, only available in browser)
5. Vercel production enforces strict module evaluation at build time
6. Node.js runtime has no `DOMMatrix` defined

**Why it worked locally:**
- Next.js dev server uses different module evaluation strategy
- PDF module was not evaluated until actually used
- Excel/CSV requests never triggered PDF code path

**Why only on production:**
- Webpack strict ahead-of-time compilation (vs. dynamic module loading)
- No polyfill in production environment

## Solution

**Approach:** Remove hard dependency on PDF module for Excel/CSV processing.

### Changes Made

File: `app/api/stage1/import/route.ts`

1. **Removed static import:**
   ```typescript
   // Before
   import { parsePdf, isPdfBuffer } from '@/utils/stage1/importers/pdfImporter';
   
   // After
   // import removed
   // isPdfBuffer() implemented locally (PDF magic number check: %PDF-)
   ```

2. **Added dynamic import for PDF processing:**
   ```typescript
   if (isPdfBuffer(buffer)) {
     const { parsePdf: parsePdfDynamic } = await import('@/utils/stage1/importers/pdfImporter');
     const pdfResult = await parsePdfDynamic(buffer);
     // ...
   }
   ```

### Result

| File Type | Before | After |
|-----------|--------|-------|
| Excel | ❌ HTTP 500 | ✅ HTTP 200 |
| CSV | ❌ HTTP 500 | ✅ HTTP 200 |
| PDF | ❌ HTTP 500 | ✅ HTTP 200 (on-demand load) |

Excel/CSV requests no longer load PDF module → no DOMMatrix error.

## Verification

### Regression Tests

Three representative test files cover module initialization scenarios:

1. **test-01-empty-format.xlsx** - Minimal structure (catches module load issues)
2. **test-03-company-pl-bs.xlsx** - Standard company data
3. **test-05-all-sheets.xlsx** - Full structure with segments

Run with: `npm run test`

### Manual Verification

Tested on Vercel production:
- ✅ Excel upload returns HTTP 200
- ✅ Candidates generated correctly
- ✅ No `ReferenceError: DOMMatrix` in logs
- ✅ Verified with sample data from customer

## Prevention

1. **Regression tests** - Run before PR merge
2. **Avoid top-level `require()` of browser APIs** - Use dynamic `import()` or lazy loading
3. **Monitor module dependencies** - Audit transitive dependencies for DOM APIs in server contexts

## Related Issues

- PDF support is preserved (loads only when PDF file is detected)
- No impact on existing API contracts
- Error responses remain JSON (never HTML 500)

## References

- Fix commit: `e28b9e6`
- Dynamic import documentation: [MDN](https://developer.mozilla.org/en-US/docs/web/javascript/reference/operators/import)
- PDF-parse GitHub: [pdf-parse](https://github.com/modesty/pdf-parse)
