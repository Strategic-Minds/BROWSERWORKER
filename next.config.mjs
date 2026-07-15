import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  serverExternalPackages: [
    'playwright-core',
  ],

  outputFileTracingIncludes: {
    '/api/health/deep': [
      './node_modules/playwright-core/**/*',
      './node_modules/.cache/ms-playwright/**/*',
    ],
    '/api/run': [
      './node_modules/playwright-core/**/*',
      './node_modules/.cache/ms-playwright/**/*',
    ],
  },
};

export default nextConfig;
