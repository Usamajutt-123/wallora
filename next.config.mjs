/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sandboxed preview iframes must be able to reach /_next HMR and dev
  // resources during local testing. Dev-only — ignored in production.
  allowedDevOrigins: ['*.e2b.app', '*.arena.site'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: '**.kodnextech.com' },
      { protocol: 'https', hostname: '**.nexwall.app' },
      { protocol: 'https', hostname: '**.nexwallcdn.com' },
      { protocol: 'https', hostname: 'w.wallhaven.cc' },
      { protocol: 'https', hostname: 'th.wallhaven.cc' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'i.ibb.co' },
    ],
  },
  experimental: {
    optimizePackageImports: ['@supabase/supabase-js'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; form-action 'self'" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
      // Admin pages & APIs must never be cached by a browser/proxy/CDN —
      // when the iframe token fallback (?sk=) is enabled, a cached copy could
      // expose the session token in logs/history. (Audit v6.1 — finding M2.)
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/api/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
