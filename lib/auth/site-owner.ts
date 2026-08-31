export function normalizedEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function isConfiguredSiteOwner(request: Request, configuredOwnerEmail: string | undefined): boolean {
  const expected = normalizedEmail(configuredOwnerEmail);
  const authenticated = normalizedEmail(request.headers.get('oai-authenticated-user-email'));
  return expected.length > 0 && authenticated === expected;
}
