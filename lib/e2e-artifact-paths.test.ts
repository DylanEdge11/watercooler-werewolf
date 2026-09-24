import { describe, expect, it } from 'vitest';
import { resolvePlaywrightArtifactPaths } from '../e2e/artifact-paths';

describe('Playwright artifact locations', () => {
  it('keeps first and last invocation reports under one parent run without collisions', () => {
    const parentRunId = 'preview-qa-20260923-101500';
    const first = resolvePlaywrightArtifactPaths(parentRunId, '01-chromium-smoke');
    const last = resolvePlaywrightArtifactPaths(parentRunId, '05-setup-navigation');

    expect(first.outputDir).toBe('test-results/preview-qa-20260923-101500/01-chromium-smoke');
    expect(last.outputDir).toBe('test-results/preview-qa-20260923-101500/05-setup-navigation');
    expect(first.reportDir).toBe('playwright-report/preview-qa-20260923-101500/01-chromium-smoke');
    expect(last.reportDir).toBe('playwright-report/preview-qa-20260923-101500/05-setup-navigation');
    expect(first.outputDir).not.toBe(last.outputDir);
    expect(first.reportDir).not.toBe(last.reportDir);
  });
});
