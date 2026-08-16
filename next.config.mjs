/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle Playwright Core into the server function. Keep only the large Chromium
  // binary package external so Vercel traces it as a runtime dependency.
  serverExternalPackages: ['@sparticuz/chromium'],
};

export default nextConfig;
