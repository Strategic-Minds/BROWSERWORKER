/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
  experimental: {},
};
export default nextConfig;
