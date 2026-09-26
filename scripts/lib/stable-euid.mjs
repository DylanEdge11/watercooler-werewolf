// tsx (and Drizzle Kit's bundled copy) names its temporary directory with
// os.userInfo() when process.geteuid is absent, as on Windows, and on some
// hosts that native lookup fails (uv_os_get_passwd/ENOMEM). A stable,
// non-privileged identity is enough for a local script. Import this first.
if (typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 1,
  });
}
