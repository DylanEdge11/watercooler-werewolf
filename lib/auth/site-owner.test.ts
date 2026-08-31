import { describe, expect, it } from 'vitest';
import { isConfiguredSiteOwner } from './site-owner';

describe('primary moderator owner verification', () => {
  it('accepts only the configured authenticated Sites owner email', () => {
    const request = new Request('https://example.test/api/moderators/bootstrap', {
      headers: { 'oai-authenticated-user-email': ' Owner@Example.Test ' },
    });
    expect(isConfiguredSiteOwner(request, 'owner@example.test')).toBe(true);
    expect(isConfiguredSiteOwner(request, 'someone-else@example.test')).toBe(false);
  });

  it('fails closed when the platform identity or owner configuration is absent', () => {
    const anonymous = new Request('https://example.test/api/moderators/bootstrap');
    expect(isConfiguredSiteOwner(anonymous, 'owner@example.test')).toBe(false);
    expect(isConfiguredSiteOwner(anonymous, undefined)).toBe(false);
  });
});
