function safeSegment(value: string, fallback: string): string {
  return (value.trim() || fallback).replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 80);
}

export function resolvePlaywrightArtifactPaths(parentRunId: string, invocationId: string) {
  const parent = safeSegment(parentRunId, 'local');
  const invocation = safeSegment(invocationId, `invocation-${process.pid}-${Date.now()}`);
  const relativePath = `${parent}/${invocation}`;
  return {
    outputDir: `test-results/${relativePath}`,
    reportDir: `playwright-report/${relativePath}`,
  };
}
