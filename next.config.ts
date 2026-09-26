import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ['@libsql/client'],
  // Deployed functions use the libSQL web client (db/index.ts); the native
  // SQLite binaries are only for local file databases, so keep them out.
  outputFileTracingExcludes: {
    '*': [
      './node_modules/@libsql/linux-*/**',
      './node_modules/@libsql/darwin-*/**',
      './node_modules/@libsql/win32-*/**',
      './node_modules/libsql/**',
    ],
  },
  experimental: {
    // Vercel restores the previous deployment's build cache. With Turbopack's
    // filesystem cache on, a branch's first build served stale globals.css
    // under a chunk name another deployment had already published to the
    // shared immutable asset store, so the page got the wrong styles. Compile
    // from source every time; the build is under a minute either way.
    turbopackFileSystemCacheForBuild: false,
  },
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
