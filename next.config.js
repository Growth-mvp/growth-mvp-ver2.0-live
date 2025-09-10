// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      { source: '/register', destination: '/signup', permanent: true },
      
    ];
  },
};

module.exports = nextConfig;
