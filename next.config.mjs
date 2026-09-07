/** @type {import('next').NextConfig} */
const nextConfig = {
  // E2E (Playwright) corre un segundo `next dev` en paralelo con el dev del
  // usuario; un distDir propio evita contención de locks sobre .next/.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['192.168.1.2'],
  serverExternalPackages: ['better-sqlite3'],
}
export default nextConfig
