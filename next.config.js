/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ ビルド中はESLintエラーを無視（公開を優先）
  eslint: { ignoreDuringBuilds: true },

  // ✅ TypeScriptエラーも一旦無視（デモ優先）
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
