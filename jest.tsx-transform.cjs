const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    const result = transformSync(source, {
      loader: 'tsx',
      format: 'cjs',
      target: 'es2020',
      jsx: 'automatic',
      sourcefile: filename,
    });
    return { code: result.code };
  },
};
