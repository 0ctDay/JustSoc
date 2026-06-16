const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: path.resolve(__dirname),
  },

  webpack(config) {
    config.cache = false;
    config.resolve = config.resolve ?? {};
    config.resolve.cache = false;
    config.resolve.symlinks = false;
    config.resolveLoader = config.resolveLoader ?? {};
    config.resolveLoader.cache = false;
    config.resolveLoader.symlinks = false;
    return config;
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/overview',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
