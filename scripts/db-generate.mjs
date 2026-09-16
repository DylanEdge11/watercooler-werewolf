// Drizzle Kit's bundled tsx helper calls os.userInfo() on platforms without
// process.geteuid(). On some Windows hosts that native lookup fails with
// uv_os_get_passwd/ENOMEM before the schema is even read. A stable, local
// non-privileged identity is sufficient for tsx's temporary directory name.
if (typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 1,
  });
}

process.argv = [process.argv[0], 'drizzle-kit', 'generate', ...process.argv.slice(2)];
await import('../node_modules/drizzle-kit/bin.cjs');
