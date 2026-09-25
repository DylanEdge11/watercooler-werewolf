import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ['@libsql/client'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // No other site may frame these pages (clickjacking protection).
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Vary', value: 'Cookie, Origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
