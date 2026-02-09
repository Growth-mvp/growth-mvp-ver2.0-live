/**
 * __tests__/shapeSnapshot.ts
 * Shape snapshot helper for asserting response structure
 */

/**
 * Extract shape from an object (recursively)
 * Preserves keys and array structure, but removes values
 */
function extractShape(obj: any, depth = 0, maxDepth = 5): any {
  if (depth > maxDepth) return typeof obj;
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';

  const type = typeof obj;

  if (type !== 'object') {
    return type;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    // Sample first element's shape for arrays
    return [extractShape(obj[0], depth + 1, maxDepth)];
  }

  const shape: Record<string, any> = {};
  const keys = Object.keys(obj);

  for (const key of keys) {
    shape[key] = extractShape(obj[key], depth + 1, maxDepth);
  }

  return shape;
}

/**
 * Compare two shapes deeply
 */
function shapesMatch(shape1: any, shape2: any): boolean {
  if (shape1 === shape2) return true;
  if (typeof shape1 !== typeof shape2) return false;

  if (Array.isArray(shape1) && Array.isArray(shape2)) {
    if (shape1.length === 0 && shape2.length === 0) return true;
    if (shape1.length > 0 && shape2.length > 0) {
      return shapesMatch(shape1[0], shape2[0]);
    }
    return false;
  }

  if (typeof shape1 === 'object' && typeof shape2 === 'object' && shape1 !== null && shape2 !== null) {
    const keys1 = Object.keys(shape1).sort();
    const keys2 = Object.keys(shape2).sort();

    if (keys1.join(',') !== keys2.join(',')) {
      return false;
    }

    for (const key of keys1) {
      if (!shapesMatch(shape1[key], shape2[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

/**
 * Assert that two objects have the same shape
 * @param actual - The actual response
 * @param expected - The expected shape reference
 * @throws {Error} if shapes don't match
 */
export function assertSameShape(actual: any, expected: any): void {
  const actualShape = extractShape(actual);
  const expectedShape = extractShape(expected);

  if (!shapesMatch(actualShape, expectedShape)) {
    throw new Error(
      `Shape mismatch!\n` +
      `Expected: ${JSON.stringify(expectedShape, null, 2)}\n` +
      `Actual: ${JSON.stringify(actualShape, null, 2)}`
    );
  }
}

/**
 * Create a shape snapshot from a response
 */
export function createShapeSnapshot(response: any): any {
  return extractShape(response);
}
