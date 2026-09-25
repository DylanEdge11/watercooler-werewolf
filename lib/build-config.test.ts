import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('production build configuration', () => {
  // Vercel restores the previous deployment's build cache, and Turbopack's
  // filesystem cache then produced stale globals.css output under a name
  // another deployment had already published as an immutable asset.
  it('compiles every build from source instead of the saved Turbopack cache', () => {
    expect(nextConfig.experimental?.turbopackFileSystemCacheForBuild).toBe(false);
  });
});
