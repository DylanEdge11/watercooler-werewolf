import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ['@libsql/client'],
  async headers() {
    return [
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
