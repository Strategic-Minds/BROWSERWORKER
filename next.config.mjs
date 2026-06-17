import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {
    root: fileURLToPath(new URL('.', import.meta.url))
  }
};

export default nextConfig;
